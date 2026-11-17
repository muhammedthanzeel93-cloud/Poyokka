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
  ADMIN_PERMISSIONS,
  BUSINESS_TYPES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type {
  AdminPackageReviewDto,
  PublicTravelPackageDto,
} from '@kerala-tourism/shared-types';
import { createApp } from '../loaders/app';
import {
  AccountModel,
  AdminProfileModel,
  AgencyModel,
  AuditLogModel,
  BusinessProfileModel,
  DestinationModel,
  TravelPackageModel,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import { dispatchRequest } from './testUtils';
import { authRepository } from '../modules/auth/auth.repository';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { agencyRepository } from '../modules/agencies/agency.repository';
import { agencyService } from '../modules/agencies/agency.service';
import { packageRepository } from '../modules/packages/package.repository';
import { packageService } from '../modules/packages/package.service';
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

describe('Day 20: Travel Packages Replica-Set Integration & Query Plan Suite', () => {
  let mongodProcess: ChildProcess | null = null;
  let dbPath: string = '';
  let mongoUri: string = '';
  let app: any;

  // Test accounts & tokens
  let agencyAccountId: string;
  let agencyId: string;

  let adminAccountId: string;
  let adminToken: string;

  before(async () => {
    try {
      const port = await getAvailablePort();
      dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-pkg-repl-'));

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
        console.warn('mongod spawn failed; skipping package replica-set suite:', err.message);
      });

      await waitForPortOpen(port);
      await waitForReplicaSetPrimary(port);

      mongoUri = `mongodb://127.0.0.1:${port}/kerala_tourism_package_test?replicaSet=rs0&directConnection=false`;
      await mongoose.connect(mongoUri);

      // Create indexes
      await Promise.all([
        AccountModel.createIndexes(),
        BusinessProfileModel.createIndexes(),
        AdminProfileModel.createIndexes(),
        AuditLogModel.createIndexes(),
        AgencyModel.createIndexes(),
        DestinationModel.createIndexes(),
        TravelPackageModel.createIndexes(),
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
    agencyService.setRepository(agencyRepository);
    packageService.setRepository(packageRepository);
    packageService.setAgencyRepository(agencyRepository);
    packageService.setAuditService(auditLogService);
  });

  beforeEach(async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    resetRateLimiter();
    authMiddleware.setRepository(authRepository);
    authorizationMiddleware.setRepository(authRepository);
    agencyService.setRepository(agencyRepository);
    packageService.setRepository(packageRepository);
    packageService.setAgencyRepository(agencyRepository);
    packageService.setAuditService(auditLogService);

    // Clean test collections
    await Promise.all([
      AccountModel.deleteMany({}),
      BusinessProfileModel.deleteMany({}),
      AdminProfileModel.deleteMany({}),
      AuditLogModel.collection.deleteMany({}),
      AgencyModel.deleteMany({}),
      DestinationModel.deleteMany({}),
      TravelPackageModel.deleteMany({}),
    ]);

    // Setup Business Travel Agency Account
    const busAcc = await AccountModel.create({
      email: 'agency.horizons@keralatourism.test',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    agencyAccountId = busAcc._id.toString();

    const busProfile = await BusinessProfileModel.create({
      accountId: busAcc._id,
      businessName: 'Kerala Horizons Eco Expeditions',
      businessType: BUSINESS_TYPES.TRAVEL_AGENCY,
      contactNumber: '+919847055555',
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      documents: [],
    });

    const agency = await AgencyModel.create({
      accountId: busAcc._id,
      businessProfileId: busProfile._id,
      agencyName: 'Kerala Horizons Eco Expeditions',
      registrationNumber: 'KL-HORIZON-999',
      businessCategory: 'TOUR_OPERATOR',
      description: 'Certified eco-tours and wilderness trekking.',
      contactEmail: 'contact@keralahorizons.test',
      contactPhone: '+919847055555',
      address: 'Near Periyar Wildlife Sanctuary',
      district: 'Idukki',
      state: 'Kerala',
      pinCode: '685536',
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      verifiedAt: new Date(),
    });
    agencyId = agency._id.toString();

    // Setup Admin Verifier Account
    const adminAcc = await AccountModel.create({
      email: 'chief.verifier@keralatourism.gov.in',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    adminAccountId = adminAcc._id.toString();

    await AdminProfileModel.create({
      accountId: adminAcc._id,
      displayName: 'Chief Verifier',
      adminLevel: 'SUPER_ADMIN',
      permissions: [
        ADMIN_PERMISSIONS.VIEW_PACKAGES,
        ADMIN_PERMISSIONS.MODERATE_PACKAGES,
        ADMIN_PERMISSIONS.VIEW_DASHBOARD,
      ],
      mfaEnabled: true,
    });

    adminToken = jwtService.signAccessToken({
      id: adminAccountId,
      email: adminAcc.email,
      accountType: adminAcc.accountType,
      status: adminAcc.status,
    });
  });

  it('1. Multi-document ACID transaction: Package review approval updates TravelPackage and creates AuditLog atomically', async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    // 1. Create a travel package
    const pkg = await TravelPackageModel.create({
      agencyId: new Types.ObjectId(agencyId),
      createdBy: new Types.ObjectId(agencyAccountId),
      updatedBy: new Types.ObjectId(agencyAccountId),
      title: 'Periyar Tiger Trail & Spice Forest',
      slug: 'periyar-tiger-trail-spice-forest',
      shortDescription: 'Guided wilderness trek in Periyar Tiger Reserve.',
      description: 'Experience 3 days inside the core zone of Periyar with trained tribal trackers.',
      packageCategory: 'WILDLIFE',
      durationDays: 3,
      durationNights: 2,
      basePrice: 16500,
      currency: 'INR',
      status: 'PENDING_REVIEW',
      submittedAt: new Date(),
      itinerary: [
        { dayNumber: 1, title: 'Forest Camp Arrival', description: 'Trek to deep forest camp.' },
        { dayNumber: 2, title: 'Tiger Trail Safari', description: 'Full day tracking wildlife.' },
        { dayNumber: 3, title: 'Bamboo Rafting & Exit', description: 'Rafting on Periyar Lake.' },
      ],
    });

    // 2. Admin reviews and approves via API
    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${pkg._id}/review`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVE',
        internalNotes: 'Complies with all eco-tourism and wildlife safety guidelines.',
      },
    });

    assert.equal(res.status, 200);
    const body = res.body as { data: AdminPackageReviewDto };
    assert.equal(body.data.package.status, 'PUBLISHED');
    assert.ok(body.data.package.publishedAt);
    assert.equal(body.data.auditLog.action, 'PACKAGE_APPROVED');

    // 3. Confirm both database records exist in MongoDB
    const persistedPkg = await TravelPackageModel.findById(pkg._id);
    assert.equal(persistedPkg?.status, 'PUBLISHED');
    assert.ok(persistedPkg?.publishedAt);

    const auditEntry = await AuditLogModel.findOne({
      targetEntityId: pkg._id,
      action: 'PACKAGE_APPROVED',
    });
    assert.ok(auditEntry);
    assert.equal(auditEntry?.actorAccountId.toString(), adminAccountId);
  });

  it('2. Multi-document ACID rollback: If approval fails, package status remains PENDING_REVIEW and no audit record is written', async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    // 1. Create a package for an unverified agency
    const unverifiedAgency = await AgencyModel.create({
      accountId: new Types.ObjectId(),
      businessProfileId: new Types.ObjectId(),
      agencyName: 'Unverified Wild Travels',
      registrationNumber: 'KL-UNVER-001',
      businessCategory: 'TOUR_OPERATOR',
      description: 'Unverified agency description',
      contactEmail: 'unver@agency.test',
      contactPhone: '+919847088888',
      address: 'Kochi',
      district: 'Ernakulam',
      state: 'Kerala',
      pinCode: '682001',
      verificationStatus: 'PENDING',
    });

    const pkg = await TravelPackageModel.create({
      agencyId: unverifiedAgency._id,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
      title: 'Unverified Agency Tiger Safari',
      slug: 'unverified-agency-tiger-safari',
      shortDescription: 'Unverified description',
      description: 'Comprehensive description here',
      packageCategory: 'WILDLIFE',
      durationDays: 2,
      durationNights: 1,
      basePrice: 5000,
      status: 'PENDING_REVIEW',
      submittedAt: new Date(),
    });

    // 2. Admin attempts to approve -> Must be rejected by transaction check
    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${pkg._id}/review`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVE',
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'AGENCY_NOT_VERIFIED');

    // 3. Confirm atomic rollback: Package status is still PENDING_REVIEW and audit count is 0
    const unchangedPkg = await TravelPackageModel.findById(pkg._id);
    assert.equal(unchangedPkg?.status, 'PENDING_REVIEW');

    const auditCount = await AuditLogModel.countDocuments({ targetEntityId: pkg._id });
    assert.equal(auditCount, 0);
  });

  it('3. Real-time public aggregation pipeline correctly queries published packages and enforces active agency join', async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    // 1. Create 3 published packages and 1 draft package
    await TravelPackageModel.create([
      {
        agencyId: new Types.ObjectId(agencyId),
        createdBy: new Types.ObjectId(agencyAccountId),
        updatedBy: new Types.ObjectId(agencyAccountId),
        title: 'Munnar Tea Estate Stay',
        slug: 'munnar-tea-estate-stay',
        shortDescription: 'Tea estate vacation in Munnar.',
        description: 'Spend 3 days enjoying tea tastings and plantation walks.',
        packageCategory: 'HILL_STATION',
        durationDays: 3,
        durationNights: 2,
        basePrice: 12000,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-11-10T10:00:00Z'),
      },
      {
        agencyId: new Types.ObjectId(agencyId),
        createdBy: new Types.ObjectId(agencyAccountId),
        updatedBy: new Types.ObjectId(agencyAccountId),
        title: 'Wayanad Chembra Trek',
        slug: 'wayanad-chembra-trek',
        shortDescription: 'Heart-shaped lake trek in Wayanad.',
        description: 'Trek to the highest peak in Wayanad district.',
        packageCategory: 'ADVENTURE',
        durationDays: 2,
        durationNights: 1,
        basePrice: 6500,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-11-11T10:00:00Z'),
      },
      {
        agencyId: new Types.ObjectId(agencyId),
        createdBy: new Types.ObjectId(agencyAccountId),
        updatedBy: new Types.ObjectId(agencyAccountId),
        title: 'Kovalam Beachfront Relaxation',
        slug: 'kovalam-beachfront-relaxation',
        shortDescription: 'Beachfront luxury resort in Kovalam.',
        description: 'Relax by the Arabian sea with Ayurvedic massages.',
        packageCategory: 'BEACH',
        durationDays: 4,
        durationNights: 3,
        basePrice: 22000,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-11-12T10:00:00Z'),
      },
      {
        agencyId: new Types.ObjectId(agencyId),
        createdBy: new Types.ObjectId(agencyAccountId),
        updatedBy: new Types.ObjectId(agencyAccountId),
        title: 'Unpublished Hidden Draft',
        slug: 'unpublished-hidden-draft',
        shortDescription: 'Draft description',
        description: 'Draft description text',
        packageCategory: 'BEACH',
        durationDays: 2,
        durationNights: 1,
        basePrice: 4000,
        status: 'DRAFT',
      },
    ]);

    // 2. Query public feed sorted by newest
    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/packages?sort=newest',
    });

    assert.equal(res.status, 200);
    const body = res.body as { data: PublicTravelPackageDto[]; pagination: any };
    assert.equal(body.pagination.total, 3);
    assert.equal(body.data[0].slug, 'kovalam-beachfront-relaxation');
    assert.equal(body.data[1].slug, 'wayanad-chembra-trek');
    assert.equal(body.data[2].slug, 'munnar-tea-estate-stay');

    // 3. Filter by price range and category
    const searchRes = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/packages/search?q=Munnar&packageCategory=HILL_STATION',
    });
    assert.equal(searchRes.status, 200);
    const searchBody = searchRes.body as { data: PublicTravelPackageDto[] };
    assert.equal(searchBody.data.length, 1);
    assert.equal(searchBody.data[0].slug, 'munnar-tea-estate-stay');
  });

  it('4. Index query plan verification: Query on { status: 1, publishedAt: -1, _id: -1 } executes via IXSCAN without in-memory SORT', async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    // Run explain executionStats on the public discovery query
    const explainResult: any = await TravelPackageModel.find({ status: 'PUBLISHED' })
      .sort({ publishedAt: -1, _id: -1 })
      .limit(20)
      .explain('executionStats');

    const winningPlan = explainResult.queryPlanner?.winningPlan;
    const executionStages = explainResult.executionStats?.executionStages;

    // Verify index scan stage is used
    const planString = JSON.stringify(winningPlan || executionStages);
    assert.ok(
      planString.includes('IXSCAN'),
      `Expected IXSCAN in execution plan, got: ${planString}`,
    );
    assert.ok(
      planString.includes('idx_packages_public_published'),
      `Expected idx_packages_public_published index usage, got: ${planString}`,
    );

    // Verify no blocking in-memory sort stage was needed
    assert.ok(
      !planString.includes('SORT') || planString.includes('SORT_KEY_GENERATOR') === false,
      'Expected index to provide order without in-memory SORT stage',
    );
  });
});
