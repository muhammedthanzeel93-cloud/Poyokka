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
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import {
  AccountModel,
  BusinessProfileModel,
  PropertyModel,
  RoomTypeModel,
  RoomInventoryModel,
  BookingModel,
  InventoryHoldModel,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import { dispatchRequest as rawDispatchRequest } from './testUtils';

const dispatchRequest = (
  appInstance: any,
  method: string,
  url: string,
  options: { token?: string; headers?: Record<string, string>; body?: unknown } = {},
) => {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  return rawDispatchRequest<any>(appInstance, {
    method,
    url,
    headers,
    body: options.body,
  });
};
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { authRepository } from '../modules/auth/auth.repository';
import { propertyRepository } from '../modules/properties/property.repository';
import { roomRepository } from '../modules/rooms/room.repository';
import { bookingsRepository } from '../modules/bookings/bookings.repository';
import { bookingsService } from '../modules/bookings/bookings.service';
import { bookingHoldExpiryService } from '../modules/bookings/booking-expiry.service';
import { getTodayInKolkata, parseCalendarDate } from '../modules/bookings/bookings.validation';

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
  throw new Error(`Timed out waiting for port ${port} to open`);
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

describe('DAY 23 — Replica Set Integration Tests (ACID Transactions & High-Concurrency)', () => {
  let mongodProcess: ChildProcess | null = null;
  let mongoPort: number;
  let mongoUri: string;
  let dbPath: string;
  let app: any;

  // Identity
  const touristId = new Types.ObjectId();
  const touristEmail = 'tourist.replica@keralatourism.local';
  let touristToken: string;

  const competitorTouristId = new Types.ObjectId();
  const competitorEmail = 'competitor@keralatourism.local';
  let competitorToken: string;

  const merchantAccountId = new Types.ObjectId();
  const businessProfileId = new Types.ObjectId();
  const propertyId = new Types.ObjectId();
  const roomTypeId = new Types.ObjectId();

  const today = getTodayInKolkata();
  const [yearStr, monthStr, dayStr] = today.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);

  const checkInDate = new Date(Date.UTC(y, m - 1, d + 10)).toISOString().split('T')[0];
  const checkOutDate = new Date(Date.UTC(y, m - 1, d + 13)).toISOString().split('T')[0]; // 3 nights
  const stayDates = [
    new Date(Date.UTC(y, m - 1, d + 10)).toISOString().split('T')[0],
    new Date(Date.UTC(y, m - 1, d + 11)).toISOString().split('T')[0],
    new Date(Date.UTC(y, m - 1, d + 12)).toISOString().split('T')[0],
  ];

  before(async () => {
    mongoPort = await getAvailablePort();
    dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mongo-booking-replica-'));

    mongodProcess = spawn(
      'mongod',
      [
        '--replSet',
        'rs0',
        '--bind_ip',
        '127.0.0.1',
        '--port',
        mongoPort.toString(),
        '--dbpath',
        dbPath,
        '--logpath',
        path.join(dbPath, 'mongod.log'),
        '--noauth',
      ],
      { stdio: 'ignore' },
    );

    await waitForPortOpen(mongoPort, 30000);
    await waitForReplicaSetPrimary(mongoPort, 30000);

    mongoUri = `mongodb://127.0.0.1:${mongoPort}/kerala_tourism_booking_replica?replicaSet=rs0`;
    await mongoose.connect(mongoUri);

    // Ensure models use real connection
    authMiddleware.setRepository(authRepository);
    authorizationMiddleware.setRepository(authRepository);
    bookingsService.setRepository(bookingsRepository);
    bookingsService.setPropertyRepository(propertyRepository);
    bookingsService.setRoomRepository(roomRepository);
    bookingHoldExpiryService.setRepository(bookingsRepository);

    app = createApp();

    // Seed Tourist 1
    await AccountModel.create({
      _id: touristId,
      email: touristEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    touristToken = jwtService.signAccessToken({
      id: touristId.toString(),
      email: touristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // Seed Tourist 2 (Competitor)
    await AccountModel.create({
      _id: competitorTouristId,
      email: competitorEmail,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    competitorToken = jwtService.signAccessToken({
      id: competitorTouristId.toString(),
      email: competitorEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // Seed Merchant Account & Business Profile
    await AccountModel.create({
      _id: merchantAccountId,
      email: 'resort.host@keralatourism.local',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    await BusinessProfileModel.create({
      _id: businessProfileId,
      accountId: merchantAccountId,
      businessName: 'Munnar Mist Resorts',
      businessType: BUSINESS_TYPES.RESORT,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      contactNumber: '+919876543210',
    });

    // Seed Published Property
    await PropertyModel.create({
      _id: propertyId,
      businessProfileId,
      accountId: merchantAccountId,
      createdBy: merchantAccountId,
      updatedBy: merchantAccountId,
      name: 'Munnar Mist Haven',
      slug: 'munnar-mist-haven',
      propertyType: 'RESORT',
      shortDescription: 'Luxury hill resort',
      description: 'Stunning views of the tea hills.',
      address: 'Tea Estate Road',
      district: 'Idukki',
      city: 'Munnar',
      state: 'Kerala',
      postalCode: '685612',
      location: { type: 'Point', coordinates: [77.06, 10.088] },
      facilities: ['SWIMMING_POOL', 'WIFI'],
      status: PROPERTY_STATUSES.PUBLISHED,
      supportsHourly: false,
      supportsDaily: true,
      publishedAt: new Date(),
    });

    // Seed Active Room Type (Base Price 4000.00 INR = 400000 paise, Total Units: 1)
    await RoomTypeModel.create({
      _id: roomTypeId,
      propertyId,
      businessProfileId,
      accountId: merchantAccountId,
      name: 'Presidential Tea Villa',
      slug: 'presidential-tea-villa',
      roomCategory: ROOM_CATEGORIES.VILLA,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
      bedConfiguration: '1 King Bed',
      bedCount: 1,
      facilities: ['WIFI', 'AIR_CONDITIONING', 'BALCONY'],
      basePrice: 400000,
      currency: 'INR',
      pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT,
      status: ROOM_STATUSES.ACTIVE,
      totalUnits: 1,
    });

    // Create Indexes
    await Promise.all([
      BookingModel.init(),
      InventoryHoldModel.init(),
      RoomInventoryModel.init(),
    ]);
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongodProcess) {
      mongodProcess.kill();
      mongodProcess = null;
    }
    try {
      fs.rmSync(dbPath, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  beforeEach(async () => {
    resetRateLimiter();
    await BookingModel.deleteMany({});
    await InventoryHoldModel.deleteMany({});
    await RoomInventoryModel.deleteMany({});

    // Seed exactly 1 unit of inventory for each stay date
    for (const d of stayDates) {
      await RoomInventoryModel.create({
        propertyId,
        roomTypeId,
        businessProfileId,
        date: parseCalendarDate(d),
        totalUnits: 1,
        availableUnits: 1,
        blockedUnits: 0,
        maintenanceUnits: 0,
      });
    }
  });

  it('1. Executes ACID transaction to create hold across 3 nights in MongoDB replica set', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 201);
    const holdId = res.body.data.hold.id;
    const bookingId = res.body.data.booking.id;

    // Verify in real MongoDB
    const bookingDoc = await BookingModel.findById(bookingId).lean();
    assert.ok(bookingDoc);
    assert.equal(bookingDoc.status, BOOKING_STATUSES.AWAITING_PAYMENT);
    assert.equal(bookingDoc.priceSnapshot.totalPaise, 1200000); // 400000 * 3 = 1200000 paise (12000 INR)

    const holdDoc = await InventoryHoldModel.findById(holdId).lean();
    assert.ok(holdDoc);
    assert.equal(holdDoc.status, INVENTORY_HOLD_STATUSES.ACTIVE);

    // Verify available units in MongoDB is 0 across all stay dates
    for (const d of stayDates) {
      const inv = await RoomInventoryModel.findOne({
        roomTypeId,
        date: parseCalendarDate(d),
      }).lean();
      assert.equal(inv!.availableUnits, 0);
    }
  });

  it('2. High-Concurrency Race: Two concurrent tourists compete for last unit; exactly one succeeds', async () => {
    // Both tourists fire requests concurrently for the only available room
    const p1 = dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Tourist One',
          email: 'tourist1@example.com',
          phone: '+919876543210',
        },
      },
    });

    const p2 = dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: competitorToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Tourist Two',
          email: 'tourist2@example.com',
          phone: '+919876543211',
        },
      },
    });

    const [res1, res2] = await Promise.all([p1, p2]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [201, 409]);

    // Ensure available units in MongoDB is strictly 0 (never negative!)
    for (const d of stayDates) {
      const inv = await RoomInventoryModel.findOne({
        roomTypeId,
        date: parseCalendarDate(d),
      }).lean();
      assert.equal(inv!.availableUnits, 0);
    }

    // Exactly 1 active hold and 1 awaiting-payment booking exists
    const holdsCount = await InventoryHoldModel.countDocuments({ status: INVENTORY_HOLD_STATUSES.ACTIVE });
    assert.equal(holdsCount, 1);

    const bookingsCount = await BookingModel.countDocuments({ status: BOOKING_STATUSES.AWAITING_PAYMENT });
    assert.equal(bookingsCount, 1);
  });

  it('3. Atomically restores room inventory in MongoDB upon voluntary tourist release', async () => {
    const createRes = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });
    const holdId = createRes.body.data.hold.id;

    const delRes = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: touristToken,
    });
    assert.equal(delRes.status, 200);

    // Verify inventory restored in MongoDB (back to 1)
    for (const d of stayDates) {
      const inv = await RoomInventoryModel.findOne({
        roomTypeId,
        date: parseCalendarDate(d),
      }).lean();
      assert.equal(inv!.availableUnits, 1);
    }
  });

  it('4. Autonomous Expiry Worker transactionally expires overdue holds and restores MongoDB inventory', async () => {
    const createRes = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });
    const holdId = createRes.body.data.hold.id;

    // Fast-forward hold expiry in real MongoDB
    await InventoryHoldModel.updateOne(
      { _id: holdId },
      { $set: { expiresAt: new Date(Date.now() - 10000) } },
    );

    // Run expiry worker batch
    const result = await bookingHoldExpiryService.processExpiredHoldsBatch(50);
    assert.equal(result.scannedCount, 1);
    assert.equal(result.expiredCount, 1);
    assert.equal(result.restoredCount, 1);

    // Verify inventory restored to 1 in MongoDB
    for (const d of stayDates) {
      const inv = await RoomInventoryModel.findOne({
        roomTypeId,
        date: parseCalendarDate(d),
      }).lean();
      assert.equal(inv!.availableUnits, 1);
    }

    const holdDoc = await InventoryHoldModel.findById(holdId).lean();
    assert.equal(holdDoc!.status, INVENTORY_HOLD_STATUSES.EXPIRED);
  });

  it('5. Explains indexes on InventoryHoldModel and BookingModel (IXSCAN verification)', async () => {
    const holdExplain = await InventoryHoldModel.find({
      status: INVENTORY_HOLD_STATUSES.ACTIVE,
      expiresAt: { $lte: new Date() },
    }).explain('executionStats');

    const holdExplainStr = JSON.stringify(holdExplain);
    assert.ok(
      holdExplainStr.includes('IXSCAN'),
      'InventoryHold query should utilize compound index (status + expiresAt)',
    );

    const bookingExplain = await BookingModel.find({
      touristAccountId: touristId,
    })
      .sort({ createdAt: -1 })
      .explain('executionStats');

    const bookingExplainStr = JSON.stringify(bookingExplain);
    assert.ok(
      bookingExplainStr.includes('IXSCAN'),
      'Booking query should utilize compound index (touristAccountId + createdAt)',
    );
  });
});
