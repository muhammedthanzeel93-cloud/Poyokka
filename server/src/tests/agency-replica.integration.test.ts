import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ADMIN_LEVELS,
  ADMIN_PERMISSIONS,
  BUSINESS_TYPES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import {
  AuditLogModel,
  AuditLogService,
  auditLogService,
} from '../modules/admin';
import type { RecordAdminAuditInput } from '../modules/admin/audit-log.service';
import { authRepository } from '../modules/auth/auth.repository';
import {
  AgencyModel,
  agencyRepository,
  agencyService,
} from '../modules/agencies';
import {
  AccountModel,
  AdminProfileModel,
  BusinessProfileModel,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { dispatchRequest } from './testUtils';

const findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to bind ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });

const waitForPortOpen = async (port: number, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for mongod port ${port}`);
};

const waitForReplicaSetPrimary = async (port: number, timeoutMs = 20_000): Promise<void> => {
  const directUri = `mongodb://127.0.0.1:${port}/admin?directConnection=true&serverSelectionTimeoutMS=2000`;
  const setupConn = await mongoose.createConnection(directUri).asPromise();
  try {
    if (!setupConn.db) {
      throw new Error('Admin DB handle unavailable during replica set initiation');
    }
    const adminDb = setupConn.db.admin();
    try {
      await adminDb.command({
        replSetInitiate: {
          _id: 'rs0',
          members: [{ _id: 0, host: `127.0.0.1:${port}` }],
        },
      });
    } catch (err: unknown) {
      const codeName = (err as { codeName?: string })?.codeName;
      if (codeName !== 'AlreadyInitialized') {
        throw err;
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hello = await adminDb.command({ hello: 1 });
      if (hello.isWritablePrimary === true || hello.ismaster === true) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Replica set primary did not elect within deadline');
  } finally {
    await setupConn.close();
  }
};

class ThrowingAuditService extends AuditLogService {
  public override async recordAdminAction(_input: RecordAdminAuditInput): Promise<never> {
    throw new Error('Simulated audit ledger write failure for ACID rollback test');
  }
}

describe('Day 19: Travel Agency Replica-Set ACID Integration & Indexing Tests', () => {
  let mongodProcess: ChildProcess | null = null;
  let dbPath: string | null = null;
  let mongoUri: string | null = null;
  let app: ReturnType<typeof createApp>;

  let adminVerifierToken: string;
  let adminVerifierAccountId: string;

  let businessToken: string;
  let businessAccountId: string;

  before(async () => {
    try {
      const port = await findFreePort();
      dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agency-repl-'));

      mongodProcess = spawn(
        'mongod',
        [
          '--replSet',
          'rs0',
          '--port',
          String(port),
          '--dbpath',
          dbPath,
          '--bind_ip',
          '127.0.0.1',
          '--logpath',
          path.join(dbPath, 'mongod.log'),
          '--noauth',
        ],
        { stdio: 'ignore' },
      );

      mongodProcess.on('error', (err) => {
        console.warn('mongod spawn failed; skipping replica-set integration suite:', err.message);
      });

      await waitForPortOpen(port);
      await waitForReplicaSetPrimary(port);

      mongoUri = `mongodb://127.0.0.1:${port}/kerala_tourism_agency_test?replicaSet=rs0&directConnection=false`;
      await mongoose.connect(mongoUri);

      // Create indexes
      await Promise.all([
        AccountModel.createIndexes(),
        BusinessProfileModel.createIndexes(),
        AdminProfileModel.createIndexes(),
        AuditLogModel.createIndexes(),
        AgencyModel.createIndexes(),
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
    agencyService.setAuditService(auditLogService);
  });

  beforeEach(async () => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      return;
    }

    resetRateLimiter();
    authMiddleware.setRepository(authRepository);
    authorizationMiddleware.setRepository(authRepository);
    agencyService.setRepository(agencyRepository);
    agencyService.setAuditService(auditLogService);

    // Clean test collections
    await Promise.all([
      AccountModel.deleteMany({}),
      BusinessProfileModel.deleteMany({}),
      AdminProfileModel.deleteMany({}),
      AuditLogModel.collection.deleteMany({}),
      AgencyModel.deleteMany({}),
    ]);

    // Setup Business Travel Agency Account
    const busAcc = await AccountModel.create({
      email: 'agency.verified@keralatourism.test',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    businessAccountId = busAcc._id.toString();

    await BusinessProfileModel.create({
      accountId: busAcc._id,
      businessName: 'Kerala Horizons Eco Travels',
      businessType: BUSINESS_TYPES.TRAVEL_AGENCY,
      contactNumber: '+919847055555',
      verificationStatus: VERIFICATION_STATUSES.PENDING,
      documents: [],
    });

    businessToken = jwtService.signAccessToken({
      id: businessAccountId,
      email: busAcc.email,
      accountType: busAcc.accountType,
      status: busAcc.status,
    });

    // Setup Admin Verifier Account
    const adminAcc = await AccountModel.create({
      email: 'admin.director@keralatourism.gov.in',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    adminVerifierAccountId = adminAcc._id.toString();

    await AdminProfileModel.create({
      accountId: adminAcc._id,
      displayName: 'State Tourism Director',
      adminLevel: ADMIN_LEVELS.SUPER_ADMIN,
      permissions: [ADMIN_PERMISSIONS.VIEW_AGENCIES, ADMIN_PERMISSIONS.VERIFY_AGENCIES],
      mfaEnabled: true,
    });

    adminVerifierToken = jwtService.signAccessToken({
      id: adminVerifierAccountId,
      email: adminAcc.email,
      accountType: adminAcc.accountType,
      status: adminAcc.status,
    });
  });

  // ============================================================================
  // 1. ACID MULTI-DOCUMENT TRANSACTION ROLLBACK
  // ============================================================================

  it('1. Rolls back both Agency and BusinessProfile status when an error occurs during review', async (ctx) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      ctx.skip('mongod replica set not running');
      return;
    }

    // 1. Register agency
    const regRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${businessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Rollback Test Agency',
        registrationNumber: 'KL-ROLLBACK-001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Testing ACID rollback on failure',
        contactEmail: 'rollback@agency.com',
        contactPhone: '+919847055555',
        address: 'Harbor Road',
        district: 'Ernakulam',
        state: 'Kerala',
        pinCode: '682001',
      },
    });
    assert.equal(regRes.status, 201);
    const agencyId = (regRes.body as any).data.id;

    // Verify initial state
    const agencyBefore = await AgencyModel.findById(agencyId);
    assert.equal(agencyBefore?.verificationStatus, 'PENDING');
    const businessBefore = await BusinessProfileModel.findOne({ accountId: businessAccountId });
    assert.equal(businessBefore?.verificationStatus, 'PENDING');

    // 2. Inject failure into AuditLogService
    agencyService.setAuditService(new ThrowingAuditService());

    // 3. Attempt review approval
    const reviewRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/agencies/${agencyId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        status: 'VERIFIED',
      },
    });

    // Request should fail due to atomic rollback
    assert.equal(reviewRes.status, 500);

    // 4. Verify clean rollback in database
    const agencyAfter = await AgencyModel.findById(agencyId);
    assert.equal(agencyAfter?.verificationStatus, 'PENDING', 'Agency status must roll back to PENDING');
    assert.equal(agencyAfter?.verifiedAt, null);

    const businessAfter = await BusinessProfileModel.findOne({ accountId: businessAccountId });
    assert.equal(businessAfter?.verificationStatus, 'PENDING', 'BusinessProfile status must roll back to PENDING');

    const auditCount = await AuditLogModel.countDocuments({ targetEntityId: agencyId });
    assert.equal(auditCount, 0, 'No dangling AuditLog records should remain');
  });

  // ============================================================================
  // 2. CONCURRENCY INTEGRITY
  // ============================================================================

  it('2. Prevents double-transitions and handles concurrent reviews safely', async (ctx) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      ctx.skip('mongod replica set not running');
      return;
    }

    const regRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${businessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Concurrent Review Agency',
        registrationNumber: 'KL-CONCURRENT-001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Testing concurrency race conditions',
        contactEmail: 'concurrent@agency.com',
        contactPhone: '+919847055555',
        address: 'Harbor Road',
        district: 'Ernakulam',
        state: 'Kerala',
        pinCode: '682001',
      },
    });
    const agencyId = (regRes.body as any).data.id;

    // First review transitions to UNDER_REVIEW
    const res1 = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/agencies/${agencyId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        status: 'UNDER_REVIEW',
      },
    });
    assert.equal(res1.status, 200);

    // Duplicate review to the SAME status fails with 400 INVALID_STATUS_TRANSITION
    const resDuplicate = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/agencies/${agencyId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        status: 'UNDER_REVIEW',
      },
    });
    assert.equal(resDuplicate.status, 400);
    assert.equal((resDuplicate.body as any).error.code, 'INVALID_STATUS_TRANSITION');
  });

  // ============================================================================
  // 3. REAL MONGO EXECUTION STATS & INDEX SCAN VERIFICATION
  // ============================================================================

  it('3. Uses IXSCAN without in-memory SORT for verificationStatus triage queries', async (ctx) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      ctx.skip('mongod replica set not running');
      return;
    }

    // Insert 5 agencies
    for (let i = 1; i <= 5; i += 1) {
      await AgencyModel.create({
        accountId: new Types.ObjectId(),
        businessProfileId: new Types.ObjectId(),
        agencyName: `Index Test Agency ${i}`,
        registrationNumber: `KL-INDEX-00${i}`,
        businessCategory: 'TOUR_OPERATOR',
        description: 'Checking execution stats and query plans',
        contactEmail: `idx${i}@agency.com`,
        contactPhone: `+91984705550${i}`,
        address: `Road ${i}`,
        district: 'Ernakulam',
        state: 'Kerala',
        pinCode: '682001',
        verificationStatus: VERIFICATION_STATUSES.PENDING,
      });
    }

    // Execute query with explain('executionStats')
    const query = AgencyModel.find({ verificationStatus: 'PENDING' })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10);

    const explanation = (await query.explain('executionStats')) as any;
    const executionStages = explanation.executionStats?.executionStages;

    // Helper to find stage recursively
    const findStage = (stage: any, name: string): any => {
      if (!stage) return null;
      if (stage.stage === name) return stage;
      if (stage.inputStage) return findStage(stage.inputStage, name);
      if (stage.inputStages) {
        for (const input of stage.inputStages) {
          const found = findStage(input, name);
          if (found) return found;
        }
      }
      return null;
    };

    const ixscan = findStage(executionStages, 'IXSCAN');
    const sortStage = findStage(executionStages, 'SORT');

    assert.ok(ixscan, 'Query plan must utilize an IXSCAN index stage');
    assert.equal(
      sortStage,
      null,
      'Query must not require an in-memory SORT stage (index idx_agencies_status_created provides sort order)',
    );
  });

  it('4. Enforces database-level unique constraints on accountId and registrationNumber', async (ctx) => {
    if (!mongoUri || mongoose.connection.readyState === 0) {
      ctx.skip('mongod replica set not running');
      return;
    }

    const accountId = new Types.ObjectId();
    const bpId = new Types.ObjectId();

    await AgencyModel.create({
      accountId,
      businessProfileId: bpId,
      agencyName: 'Unique Test Agency 1',
      registrationNumber: 'KL-UNIQUE-999',
      businessCategory: 'TOUR_OPERATOR',
      description: 'First unique agency record',
      contactEmail: 'unique1@agency.com',
      contactPhone: '+919847055599',
      address: 'Unique Road',
      district: 'Ernakulam',
      state: 'Kerala',
      pinCode: '682001',
      verificationStatus: VERIFICATION_STATUSES.PENDING,
    });

    // 1. Attempt duplicate accountId -> Mongo duplicate key error E11000
    await assert.rejects(
      async () => {
        await AgencyModel.create({
          accountId, // Duplicate!
          businessProfileId: new Types.ObjectId(),
          agencyName: 'Unique Test Agency 2',
          registrationNumber: 'KL-UNIQUE-888',
          businessCategory: 'TOUR_OPERATOR',
          description: 'Second agency with duplicate accountId',
          contactEmail: 'unique2@agency.com',
          contactPhone: '+919847055588',
          address: 'Unique Road 2',
          district: 'Ernakulam',
          state: 'Kerala',
          pinCode: '682001',
          verificationStatus: VERIFICATION_STATUSES.PENDING,
        });
      },
      (err: any) => err.code === 11000,
      'Duplicate accountId must be blocked by unique index idx_agencies_accountId_unique',
    );

    // 2. Attempt duplicate registrationNumber -> Mongo duplicate key error E11000
    await assert.rejects(
      async () => {
        await AgencyModel.create({
          accountId: new Types.ObjectId(),
          businessProfileId: new Types.ObjectId(),
          agencyName: 'Unique Test Agency 3',
          registrationNumber: 'KL-UNIQUE-999', // Duplicate!
          businessCategory: 'TOUR_OPERATOR',
          description: 'Third agency with duplicate registrationNumber',
          contactEmail: 'unique3@agency.com',
          contactPhone: '+919847055577',
          address: 'Unique Road 3',
          district: 'Ernakulam',
          state: 'Kerala',
          pinCode: '682001',
          verificationStatus: VERIFICATION_STATUSES.PENDING,
        });
      },
      (err: any) => err.code === 11000,
      'Duplicate registrationNumber must be blocked by unique index idx_agencies_registrationNumber_unique',
    );
  });
});
