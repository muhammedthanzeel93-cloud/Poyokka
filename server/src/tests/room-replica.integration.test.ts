import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import mongoose, { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  BUSINESS_TYPES,
  PROPERTY_STATUSES,
  ROOM_CATEGORIES,
  ROOM_PRICING_UNITS,
  ROOM_STATUSES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type { RoomTypeDto } from '@kerala-tourism/shared-types';
import { createApp } from '../loaders/app';
import {
  AccountModel,
  AuditLogModel,
  BusinessProfileModel,
  PropertyModel,
  RoomInventoryModel,
  RoomTypeModel,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import { dispatchRequest } from './testUtils';
import { authRepository } from '../modules/auth/auth.repository';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { roomRepository } from '../modules/rooms/room.repository';
import { roomService } from '../modules/rooms/room.service';
import { auditLogService } from '../modules/admin/audit-log.service';

const getAvailablePort = async (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
};

const waitForPortOpen = async (port: number, timeoutMs: number = 30000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', (err) => {
          socket.destroy();
          reject(err);
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Timeout waiting for port ${port} to open`);
};

const waitForReplicaSetPrimary = async (port: number, timeoutMs: number = 30000): Promise<void> => {
  const directUri = `mongodb://127.0.0.1:${port}/admin?directConnection=true`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const conn = await mongoose.createConnection(directUri).asPromise();
      const adminDb = conn.db!.admin();
      try {
        const status = await adminDb.command({ replSetGetStatus: 1 });
        const hasPrimary = status.members?.some((m: { state: number }) => m.state === 1);
        if (hasPrimary) {
          await conn.close();
          return;
        }
      } catch {
        try {
          await adminDb.command({
            replSetInitiate: {
              _id: 'rs0',
              members: [{ _id: 0, host: `127.0.0.1:${port}` }],
            },
          });
        } catch {
          // Ignore if already initiated
        }
      }
      await conn.close();
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Timeout waiting for replica set to elect primary');
};

describe('Day 22: Room Inventory Replica-Set Integration, ACID & Query Plan Suite', () => {
  let mongodProcess: ChildProcess | null = null;
  let dbPath: string = '';
  let mongoUri: string = '';
  let app: any;

  // Test accounts & tokens
  let hotelAccountId: string;
  let hotelBusinessId: string;
  let hotelToken: string;

  let publishedPropertyId: string;

  before(async () => {
    try {
      const port = await getAvailablePort();
      dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-room-repl-'));

      mongodProcess = spawn(
        'mongod',
        [
          '--replSet',
          'rs0',
          '--bind_ip',
          '127.0.0.1',
          '--port',
          port.toString(),
          '--dbpath',
          dbPath,
          '--logpath',
          path.join(dbPath, 'mongod.log'),
          '--noauth',
        ],
        { stdio: 'ignore' },
      );

      mongodProcess.on('error', (err) => {
        console.warn('mongod spawn failed; skipping room replica-set suite:', err.message);
      });

      await waitForPortOpen(port);
      await waitForReplicaSetPrimary(port);

      mongoUri = `mongodb://127.0.0.1:${port}/kerala_tourism_room_test?replicaSet=rs0&directConnection=false`;
      await mongoose.connect(mongoUri);

      // Create indexes on all collections
      await Promise.all([
        AccountModel.createIndexes(),
        BusinessProfileModel.createIndexes(),
        PropertyModel.createIndexes(),
        RoomTypeModel.createIndexes(),
        RoomInventoryModel.createIndexes(),
        AuditLogModel.createIndexes(),
      ]);

      app = createApp();
    } catch (err: unknown) {
      console.warn('Skipping replica set suite (mongod not available or failed):', (err as Error)?.message);
    }
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongodProcess) {
      mongodProcess.kill('SIGINT');
      mongodProcess = null;
    }
    if (dbPath && fs.existsSync(dbPath)) {
      try {
        fs.rmSync(dbPath, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    authMiddleware.setRepository(authRepository);
    authorizationMiddleware.setRepository(authRepository);
    roomService.setRepository(roomRepository);
    roomService.setAuditService(auditLogService);
  });

  beforeEach(async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    resetRateLimiter();
    authMiddleware.setRepository(authRepository);
    authorizationMiddleware.setRepository(authRepository);
    roomService.setRepository(roomRepository);
    roomService.setAuditService(auditLogService);

    // Clean test collections
    await Promise.all([
      AccountModel.deleteMany({}),
      BusinessProfileModel.deleteMany({}),
      PropertyModel.deleteMany({}),
      RoomTypeModel.deleteMany({}),
      RoomInventoryModel.deleteMany({}),
      AuditLogModel.collection.deleteMany({}),
    ]);

    // Seed Verified Hotel Account & Profile
    const hotelAcc = await AccountModel.create({
      email: 'host@leelakovalam.com',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
      isEmailVerified: true,
      failedLoginAttempts: 0,
    });
    hotelAccountId = hotelAcc._id.toString();

    const hotelBiz = await BusinessProfileModel.create({
      accountId: hotelAcc._id,
      businessName: 'The Leela Kovalam',
      businessType: BUSINESS_TYPES.RESORT,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      contactNumber: '+919847111111',
    });
    hotelBusinessId = hotelBiz._id.toString();

    hotelToken = jwtService.signAccessToken({
      id: hotelAccountId,
      email: 'host@leelakovalam.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // Seed Published Property
    const prop = await PropertyModel.create({
      businessProfileId: hotelBiz._id,
      accountId: hotelAcc._id,
      createdBy: hotelAcc._id,
      updatedBy: hotelAcc._id,
      name: 'The Leela Kovalam Beach Resort',
      slug: 'the-leela-kovalam-beach-resort',
      propertyType: 'RESORT',
      shortDescription: 'Cliff-top luxury resort',
      description: 'Stunning views of the Arabian Sea.',
      address: 'Kovalam Beach Road',
      district: 'Thiruvananthapuram',
      city: 'Thiruvananthapuram',
      state: 'Kerala',
      postalCode: '695527',
      location: { type: 'Point', coordinates: [76.9787, 8.4004] },
      facilities: ['SWIMMING_POOL', 'SPA', 'WIFI', 'BEACH_ACCESS'],
      coverMediaId: null,
      galleryMediaIds: [],
      status: PROPERTY_STATUSES.PUBLISHED,
      supportsHourly: false,
      supportsDaily: true,
      publishedAt: new Date(),
    });
    publishedPropertyId = prop._id.toString();
  });

  it('1. should enforce schema validator invariant (available + blocked + maintenance <= total)', async (t) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      t.skip('Replica set not available');
      return;
    }

    const room = await RoomTypeModel.create({
      propertyId: new Types.ObjectId(publishedPropertyId),
      businessProfileId: new Types.ObjectId(hotelBusinessId),
      accountId: new Types.ObjectId(hotelAccountId),
      name: 'Club Suite',
      slug: 'club-suite',
      roomCategory: ROOM_CATEGORIES.SUITE,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
      bedConfiguration: '1 King Bed',
      bedCount: 1,
      facilities: ['WIFI', 'AIR_CONDITIONING'],
      basePrice: 900000,
      currency: 'INR',
      pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT,
      status: ROOM_STATUSES.ACTIVE,
      totalUnits: 5,
    });

    // Attempt invalid direct insert violating totalUnits invariant
    let insertFailed = false;
    try {
      await RoomInventoryModel.create({
        propertyId: room.propertyId,
        roomTypeId: room._id,
        businessProfileId: room.businessProfileId,
        date: new Date('2026-12-01T00:00:00.000Z'),
        totalUnits: 5,
        availableUnits: 3,
        blockedUnits: 2,
        maintenanceUnits: 2, // 3 + 2 + 2 = 7 > 5!
      });
    } catch (err: any) {
      insertFailed = true;
      assert.match(err.message, /Available units plus blocked and maintenance units cannot exceed total units/);
    }

    assert.equal(insertFailed, true);
  });

  it('2. should enforce unique compound index { roomTypeId: 1, date: 1 }', async (t) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      t.skip('Replica set not available');
      return;
    }

    const room = await RoomTypeModel.create({
      propertyId: new Types.ObjectId(publishedPropertyId),
      businessProfileId: new Types.ObjectId(hotelBusinessId),
      accountId: new Types.ObjectId(hotelAccountId),
      name: 'Ocean View Room',
      slug: 'ocean-view-room',
      roomCategory: ROOM_CATEGORIES.DELUXE,
      maxAdults: 2,
      maxOccupancy: 2,
      bedConfiguration: '1 King Bed',
      bedCount: 1,
      facilities: ['WIFI'],
      basePrice: 600000,
      currency: 'INR',
      pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT,
      status: ROOM_STATUSES.ACTIVE,
      totalUnits: 10,
    });

    const targetDate = new Date('2026-12-05T00:00:00.000Z');

    await RoomInventoryModel.create({
      propertyId: room.propertyId,
      roomTypeId: room._id,
      businessProfileId: room.businessProfileId,
      date: targetDate,
      totalUnits: 10,
      availableUnits: 10,
      blockedUnits: 0,
      maintenanceUnits: 0,
    });

    // Second insert with same roomTypeId and date must throw E11000 duplicate key error
    let duplicateRejected = false;
    try {
      await RoomInventoryModel.create({
        propertyId: room.propertyId,
        roomTypeId: room._id,
        businessProfileId: room.businessProfileId,
        date: targetDate,
        totalUnits: 10,
        availableUnits: 10,
        blockedUnits: 0,
        maintenanceUnits: 0,
      });
    } catch (err: any) {
      duplicateRejected = true;
      assert.equal(err.code, 11000);
    }

    assert.equal(duplicateRejected, true);
  });

  it('3. should execute multi-document ACID inventory setup inside transaction', async (t) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      t.skip('Replica set not available');
      return;
    }

    // Create room via HTTP API
    const roomRes = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
      method: 'POST',
      url: `/api/v1/business/properties/${publishedPropertyId}/rooms`,
      headers: { authorization: `Bearer ${hotelToken}` },
      body: {
        name: 'Royal Pavilion Villa',
        roomCategory: ROOM_CATEGORIES.VILLA,
        maxAdults: 4,
        maxOccupancy: 4,
        bedConfiguration: '2 King Beds',
        bedCount: 2,
        basePrice: 2500000, // 25,000 INR
        totalUnits: 3,
      },
    });

    assert.equal(roomRes.status, 201);
    const roomId = roomRes.body.data.id;

    // Bulk setup 7 days of inventory via PUT
    const putRes = await dispatchRequest<{ success: boolean; data: { configuredDatesCount: number } }>(app, {
      method: 'PUT',
      url: `/api/v1/business/rooms/${roomId}/inventory`,
      headers: { authorization: `Bearer ${hotelToken}` },
      body: {
        startDate: '2026-12-01',
        endDate: '2026-12-07',
        totalUnits: 3,
        blockedUnits: 1,
        maintenanceUnits: 0,
      },
    });

    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.data.configuredDatesCount, 7);

    // Verify docs persisted in MongoDB
    const docs = await RoomInventoryModel.find({ roomTypeId: roomId }).sort({ date: 1 });
    assert.equal(docs.length, 7);
    for (const doc of docs) {
      assert.equal(doc.totalUnits, 3);
      assert.equal(doc.availableUnits, 2); // 3 - 1 - 0 = 2
      assert.equal(doc.blockedUnits, 1);
    }
  });

  it('4. should handle atomic conditional date-blocking with concurrency protection', async (t) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      t.skip('Replica set not available');
      return;
    }

    const roomRes = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
      method: 'POST',
      url: `/api/v1/business/properties/${publishedPropertyId}/rooms`,
      headers: { authorization: `Bearer ${hotelToken}` },
      body: {
        name: 'Concurrency Test Suite',
        roomCategory: ROOM_CATEGORIES.SUITE,
        maxAdults: 2,
        maxOccupancy: 2,
        bedConfiguration: '1 King Bed',
        bedCount: 1,
        basePrice: 700000,
        totalUnits: 5,
      },
    });
    const roomId = roomRes.body.data.id;

    // Seed 5 available units across 3 days
    await dispatchRequest(app, {
      method: 'PUT',
      url: `/api/v1/business/rooms/${roomId}/inventory`,
      headers: { authorization: `Bearer ${hotelToken}` },
      body: {
        startDate: '2026-12-10',
        endDate: '2026-12-12',
        totalUnits: 5,
        blockedUnits: 0,
        maintenanceUnits: 0,
      },
    });

    // Fire 2 concurrent block requests of 3 units each (Total 6 > 5 available)
    const [res1, res2] = await Promise.all([
      dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/block-dates`,
        headers: { authorization: `Bearer ${hotelToken}` },
        body: {
          startDate: '2026-12-10',
          endDate: '2026-12-12',
          unitsToBlock: 3,
          blockType: 'MAINTENANCE',
        },
      }),
      dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/block-dates`,
        headers: { authorization: `Bearer ${hotelToken}` },
        body: {
          startDate: '2026-12-10',
          endDate: '2026-12-12',
          unitsToBlock: 3,
          blockType: 'MAINTENANCE',
        },
      }),
    ]);

    // Exactly one must succeed (200) and one must be rejected (409 Conflict)
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409]);

    // Verify DB state: availableUnits must be exactly 2 (5 - 3 = 2), never negative
    const docs = await RoomInventoryModel.find({ roomTypeId: roomId });
    for (const doc of docs) {
      assert.equal(doc.availableUnits, 2);
      assert.equal(doc.maintenanceUnits, 3);
    }
  });

  it('5. should confirm index usage (IXSCAN) via explain executionStats', async (t) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      t.skip('Replica set not available');
      return;
    }

    const propObjId = new Types.ObjectId(publishedPropertyId);

    // 5.1 Query Room Types by Property and Status
    const roomExplain: any = await RoomTypeModel.find({
      propertyId: propObjId,
      status: ROOM_STATUSES.ACTIVE,
    })
      .explain('executionStats');

    const roomPlanStr = JSON.stringify(roomExplain);
    assert.ok(
      roomPlanStr.includes('IXSCAN') || roomPlanStr.includes('idx_room_types_property_status'),
      'Expected query to use index scan on room types',
    );

    // 5.2 Query Room Inventory by Range
    const dummyRoomId = new Types.ObjectId();
    const invExplain: any = await RoomInventoryModel.find({
      roomTypeId: dummyRoomId,
      date: { $gte: new Date('2026-12-01'), $lte: new Date('2026-12-31') },
    })
      .explain('executionStats');

    const invPlanStr = JSON.stringify(invExplain);
    assert.ok(
      invPlanStr.includes('IXSCAN') || invPlanStr.includes('idx_room_inventory_room_date'),
      'Expected query to use index scan on room inventory',
    );
  });
});
