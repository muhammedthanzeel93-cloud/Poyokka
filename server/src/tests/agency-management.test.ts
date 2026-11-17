import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ClientSession, Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ADMIN_LEVELS,
  ADMIN_PERMISSIONS,
  BUSINESS_TYPES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type {
  AccountStatus,
  AccountType,
  AdminLevel,
  AdminPermission,
  AgencyDocumentDto,
  AgencyDocumentType,
  AgencyDto,
  AuditLogEntryDto,
  VerificationStatus,
} from '@kerala-tourism/shared-types';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { authorizationController } from '../modules/authorization/authorization.controller';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import {
  AuditLogService,
  auditLogService,
  RecordAdminAuditInput,
} from '../modules/admin/audit-log.service';
import { AuthRepository } from '../modules/auth/auth.repository';
import {
  agencyRepository,
  AgencyRepository,
} from '../modules/agencies/agency.repository';
import { agencyService } from '../modules/agencies/agency.service';
import type {
  AgencyLean,
  AgencyDocumentLean,
  CreateAgencyPersistenceInput,
  UpdateAgencyPersistenceInput,
  PaginatedAgenciesResult,
} from '../modules/agencies/agency.types';
import type { AdminAgenciesQueryInput } from '../modules/agencies/agency.validation';
import {
  IAccountDocument,
  IAdminProfileDocument,
  IBusinessProfileDocument,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { dispatchRequest } from './testUtils';

// --- In-Memory Stores and Test Doubles ---

interface StoredAccount {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  accountType: AccountType;
  status: AccountStatus;
  displayName: string;
}

interface StoredBusinessProfile {
  _id: Types.ObjectId;
  accountId: Types.ObjectId;
  businessName: string;
  businessType: string;
  contactNumber: string;
  verificationStatus: VerificationStatus;
  documents: Array<{
    documentType: string;
    storageKey: string;
    originalFileName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: Date;
  }>;
}

interface StoredAdminProfile {
  _id: Types.ObjectId;
  accountId: Types.ObjectId;
  displayName: string;
  adminLevel: AdminLevel;
  permissions: AdminPermission[];
  mfaEnabled: boolean;
}

class InMemoryAuthStore {
  public accounts = new Map<string, StoredAccount>();
  public businessProfiles = new Map<string, StoredBusinessProfile>();
  public adminProfiles = new Map<string, StoredAdminProfile>();
}

class InMemoryAgencyStore {
  public agencies = new Map<string, AgencyLean>();
  public auditLogs: AuditLogEntryDto[] = [];
}

class TestAuthRepository extends AuthRepository {
  constructor(private readonly store: InMemoryAuthStore) {
    super();
  }

  public override async findAccountById(id: Types.ObjectId | string): Promise<IAccountDocument | null> {
    const acc = this.store.accounts.get(id.toString());
    if (!acc) return null;
    return {
      _id: acc._id,
      id: acc._id.toString(),
      email: acc.email,
      passwordHash: acc.passwordHash,
      accountType: acc.accountType,
      status: acc.status,
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    } as unknown as IAccountDocument;
  }

  public override async findAdminProfile(accountId: string | Types.ObjectId): Promise<IAdminProfileDocument | null> {
    const profile = this.store.adminProfiles.get(accountId.toString());
    if (!profile) return null;
    return {
      _id: profile._id,
      accountId: profile.accountId,
      displayName: profile.displayName,
      adminLevel: profile.adminLevel,
      permissions: profile.permissions,
      mfaEnabled: profile.mfaEnabled,
    } as unknown as IAdminProfileDocument;
  }

  public override async findBusinessProfile(accountId: string | Types.ObjectId): Promise<IBusinessProfileDocument | null> {
    const profile = this.store.businessProfiles.get(accountId.toString());
    if (!profile) return null;
    return profile as unknown as IBusinessProfileDocument;
  }

  public override async createTourPackage(data: any): Promise<any> {
    return {
      _id: new Types.ObjectId(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

class TestAgencyRepository extends AgencyRepository {
  constructor(
    private readonly agencyStore: InMemoryAgencyStore,
    private readonly authStore: InMemoryAuthStore,
  ) {
    super();
  }

  public override async withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
    return fn(undefined);
  }

  public override async findAgencyByAccountId(accountId: string | Types.ObjectId): Promise<AgencyLean | null> {
    for (const agency of this.agencyStore.agencies.values()) {
      if (agency.accountId.toString() === accountId.toString()) {
        return JSON.parse(JSON.stringify(agency));
      }
    }
    return null;
  }

  public override async findAgencyById(agencyId: string | Types.ObjectId): Promise<AgencyLean | null> {
    const agency = this.agencyStore.agencies.get(agencyId.toString());
    if (!agency) return null;
    return JSON.parse(JSON.stringify(agency));
  }

  public override async findAgencyByRegistrationNumber(registrationNumber: string): Promise<AgencyLean | null> {
    for (const agency of this.agencyStore.agencies.values()) {
      if (agency.registrationNumber.toLowerCase() === registrationNumber.trim().toLowerCase()) {
        return JSON.parse(JSON.stringify(agency));
      }
    }
    return null;
  }

  public override async createAgency(data: CreateAgencyPersistenceInput): Promise<AgencyLean> {
    const _id = new Types.ObjectId();
    const newAgency: AgencyLean = {
      _id,
      accountId: new Types.ObjectId(data.accountId.toString()),
      businessProfileId: new Types.ObjectId(data.businessProfileId.toString()),
      agencyName: data.agencyName,
      registrationNumber: data.registrationNumber.trim(),
      businessCategory: data.businessCategory,
      description: data.description,
      contactEmail: data.contactEmail.trim().toLowerCase(),
      contactPhone: data.contactPhone,
      website: data.website ?? null,
      address: data.address,
      district: data.district,
      state: data.state || 'Kerala',
      pinCode: data.pinCode,
      logoMediaId: data.logoMediaId ? new Types.ObjectId(data.logoMediaId.toString()) : null,
      verificationStatus: VERIFICATION_STATUSES.PENDING,
      reviewedBy: null,
      reviewedAt: null,
      verifiedAt: null,
      rejectionReason: null,
      documents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.agencyStore.agencies.set(_id.toString(), newAgency);
    return JSON.parse(JSON.stringify(newAgency));
  }

  public override async updateAgency(
    agencyId: string | Types.ObjectId,
    data: UpdateAgencyPersistenceInput,
  ): Promise<AgencyLean | null> {
    const agency = this.agencyStore.agencies.get(agencyId.toString());
    if (!agency) return null;

    if (data.agencyName !== undefined) agency.agencyName = data.agencyName;
    if (data.businessCategory !== undefined) agency.businessCategory = data.businessCategory;
    if (data.description !== undefined) agency.description = data.description;
    if (data.contactEmail !== undefined) agency.contactEmail = data.contactEmail.trim().toLowerCase();
    if (data.contactPhone !== undefined) agency.contactPhone = data.contactPhone;
    if (data.website !== undefined) agency.website = data.website;
    if (data.address !== undefined) agency.address = data.address;
    if (data.district !== undefined) agency.district = data.district;
    if (data.state !== undefined) agency.state = data.state;
    if (data.pinCode !== undefined) agency.pinCode = data.pinCode;
    if (data.logoMediaId !== undefined) {
      agency.logoMediaId = data.logoMediaId ? new Types.ObjectId(data.logoMediaId.toString()) : null;
    }
    agency.updatedAt = new Date();

    return JSON.parse(JSON.stringify(agency));
  }

  public override async addAgencyDocument(
    agencyId: string | Types.ObjectId,
    document: {
      documentType: AgencyDocumentType;
      originalFileName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
    },
  ): Promise<AgencyLean | null> {
    const agency = this.agencyStore.agencies.get(agencyId.toString());
    if (!agency) return null;

    const docId = new Types.ObjectId();
    const docLean: AgencyDocumentLean = {
      _id: docId,
      documentType: document.documentType,
      originalFileName: document.originalFileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      storageKey: document.storageKey,
      uploadedAt: new Date(),
    };
    agency.documents.push(docLean);
    agency.updatedAt = new Date();

    return JSON.parse(JSON.stringify(agency));
  }

  public override async removeAgencyDocument(
    agencyId: string | Types.ObjectId,
    documentId: string | Types.ObjectId,
  ): Promise<AgencyLean | null> {
    const agency = this.agencyStore.agencies.get(agencyId.toString());
    if (!agency) return null;

    agency.documents = agency.documents.filter(
      (d) => d._id.toString() !== documentId.toString(),
    );
    agency.updatedAt = new Date();

    return JSON.parse(JSON.stringify(agency));
  }

  public override async findAgenciesPaginated(
    filters: AdminAgenciesQueryInput,
  ): Promise<PaginatedAgenciesResult> {
    let list = Array.from(this.agencyStore.agencies.values());

    if (filters.verificationStatus) {
      list = list.filter((a) => a.verificationStatus === filters.verificationStatus);
    }
    if (filters.district) {
      list = list.filter((a) => a.district === filters.district);
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.agencyName.toLowerCase().includes(q) ||
          a.registrationNumber.toLowerCase().includes(q) ||
          a.contactEmail.toLowerCase().includes(q) ||
          a.contactPhone.toLowerCase().includes(q),
      );
    }

    const total = list.length;
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const start = (page - 1) * limit;
    const items = list.slice(start, start + limit);
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: JSON.parse(JSON.stringify(items)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  public override async transitionAgencyVerificationStatusAtomic(
    agencyId: string | Types.ObjectId,
    allowedCurrentStatuses: VerificationStatus[],
    targetStatus: VerificationStatus,
    updates: {
      verifiedAt?: Date | null;
      reviewedAt?: Date | null;
      rejectionReason?: string | null;
      reviewedBy?: Types.ObjectId | null;
    },
  ): Promise<AgencyLean | null> {
    const agency = this.agencyStore.agencies.get(agencyId.toString());
    if (!agency) return null;

    if (!allowedCurrentStatuses.includes(agency.verificationStatus)) {
      return null;
    }

    agency.verificationStatus = targetStatus;
    if (updates.verifiedAt !== undefined) agency.verifiedAt = updates.verifiedAt;
    if (updates.reviewedAt !== undefined) agency.reviewedAt = updates.reviewedAt;
    if (updates.rejectionReason !== undefined) agency.rejectionReason = updates.rejectionReason;
    if (updates.reviewedBy !== undefined) agency.reviewedBy = updates.reviewedBy;
    agency.updatedAt = new Date();

    return JSON.parse(JSON.stringify(agency));
  }

  public override async syncBusinessProfileVerificationStatus(
    accountId: string | Types.ObjectId,
    targetStatus: VerificationStatus,
  ): Promise<void> {
    const bp = this.authStore.businessProfiles.get(accountId.toString());
    if (bp) {
      bp.verificationStatus = targetStatus;
    }
  }

  public override async syncBusinessProfileDocument(
    accountId: string | Types.ObjectId,
    document: {
      documentType: string;
      storageKey: string;
      originalFileName: string;
      fileSize: number;
      mimeType: string;
      uploadedAt: Date;
    },
  ): Promise<void> {
    const bp = this.authStore.businessProfiles.get(accountId.toString());
    if (bp) {
      bp.documents.push(document);
    }
  }

  public override async removeBusinessProfileDocumentByStorageKey(
    accountId: string | Types.ObjectId,
    storageKey: string,
  ): Promise<void> {
    const bp = this.authStore.businessProfiles.get(accountId.toString());
    if (bp) {
      bp.documents = bp.documents.filter((d) => d.storageKey !== storageKey);
    }
  }

  public override async findBusinessProfileByAccountId(accountId: string | Types.ObjectId) {
    const bp = this.authStore.businessProfiles.get(accountId.toString());
    if (!bp) return null;
    return JSON.parse(JSON.stringify(bp));
  }
}

class TestAuditLogService extends AuditLogService {
  constructor(private readonly agencyStore: InMemoryAgencyStore) {
    super();
  }

  public override async recordAdminAction(input: RecordAdminAuditInput): Promise<AuditLogEntryDto> {
    const entry: AuditLogEntryDto = {
      id: new Types.ObjectId().toString(),
      actorAccountId: input.actorAccountId.toString(),
      actorAccountType: input.actorAccountType,
      actorAdminLevel: input.actorAdminLevel,
      action: input.action,
      targetEntityId: input.targetEntityId.toString(),
      targetEntityType: input.targetEntityType || 'AGENCY',
      reason: input.reason,
      beforeState: input.beforeState,
      afterState: input.afterState,
      ipAddress: null,
      userAgent: null,
      timestamp: new Date().toISOString(),
    };
    this.agencyStore.auditLogs.push(entry);
    return entry;
  }
}

// Sample binary file payloads with authentic magic bytes
const VALID_PDF_BASE64 = Buffer.from('%PDF-1.4\n%Test PDF binary content').toString('base64');
const VALID_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
const VALID_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]).toString('base64');
const VALID_WEBP_BASE64 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20,
]).toString('base64');
const DISGUISED_TEXT_BASE64 = Buffer.from('Plain text file masquerading as a PDF document').toString('base64');

describe('Day 19: Business Travel Agency Registration & Verification System', () => {
  let app: ReturnType<typeof createApp>;
  let authStore: InMemoryAuthStore;
  let agencyStore: InMemoryAgencyStore;
  let testAuthRepo: TestAuthRepository;
  let testAgencyRepo: TestAgencyRepository;
  let testAuditService: TestAuditLogService;

  // Stored identities
  let touristToken: string;
  let touristAccountId: string;

  let hotelBusinessToken: string;
  let hotelBusinessAccountId: string;

  let agencyBusinessToken: string;
  let agencyBusinessAccountId: string;

  let agencyBusiness2Token: string;
  let agencyBusiness2AccountId: string;

  let adminViewerToken: string;
  let adminViewerAccountId: string;

  let adminVerifierToken: string;
  let adminVerifierAccountId: string;

  const createAuthToken = (accountId: string, email: string, accountType: AccountType): string => {
    return jwtService.signAccessToken({
      id: accountId,
      email,
      accountType,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
  };

  beforeEach(() => {
    resetRateLimiter();
    authStore = new InMemoryAuthStore();
    agencyStore = new InMemoryAgencyStore();
    testAuthRepo = new TestAuthRepository(authStore);
    testAgencyRepo = new TestAgencyRepository(agencyStore, authStore);
    testAuditService = new TestAuditLogService(agencyStore);

    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);
    authorizationController.setRepository(testAuthRepo);
    agencyService.setRepository(testAgencyRepo);
    agencyService.setAuditService(testAuditService);

    app = createApp();

    // 1. Tourist Account
    const touristId = new Types.ObjectId();
    touristAccountId = touristId.toString();
    authStore.accounts.set(touristAccountId, {
      _id: touristId,
      email: 'tourist@example.com',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'Tourist Traveler',
    });
    touristToken = createAuthToken(touristAccountId, 'tourist@example.com', ACCOUNT_TYPES.TOURIST);

    // 2. Hotel Business Account (businessType: 'HOTEL')
    const hotelId = new Types.ObjectId();
    hotelBusinessAccountId = hotelId.toString();
    authStore.accounts.set(hotelBusinessAccountId, {
      _id: hotelId,
      email: 'hotel@example.com',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'Luxury Munnar Resort',
    });
    authStore.businessProfiles.set(hotelBusinessAccountId, {
      _id: new Types.ObjectId(),
      accountId: hotelId,
      businessName: 'Luxury Munnar Resort',
      businessType: BUSINESS_TYPES.HOTEL,
      contactNumber: '+919847011111',
      verificationStatus: VERIFICATION_STATUSES.PENDING,
      documents: [],
    });
    hotelBusinessToken = createAuthToken(hotelBusinessAccountId, 'hotel@example.com', ACCOUNT_TYPES.BUSINESS);

    // 3. Travel Agency Business Account 1 (businessType: 'TRAVEL_AGENCY')
    const agencyId = new Types.ObjectId();
    agencyBusinessAccountId = agencyId.toString();
    authStore.accounts.set(agencyBusinessAccountId, {
      _id: agencyId,
      email: 'agency1@example.com',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'Kerala Malabar Eco Tours',
    });
    authStore.businessProfiles.set(agencyBusinessAccountId, {
      _id: new Types.ObjectId(),
      accountId: agencyId,
      businessName: 'Kerala Malabar Eco Tours',
      businessType: BUSINESS_TYPES.TRAVEL_AGENCY,
      contactNumber: '+919847022222',
      verificationStatus: VERIFICATION_STATUSES.PENDING,
      documents: [],
    });
    agencyBusinessToken = createAuthToken(agencyBusinessAccountId, 'agency1@example.com', ACCOUNT_TYPES.BUSINESS);

    // 4. Travel Agency Business Account 2
    const agency2Id = new Types.ObjectId();
    agencyBusiness2AccountId = agency2Id.toString();
    authStore.accounts.set(agencyBusiness2AccountId, {
      _id: agency2Id,
      email: 'agency2@example.com',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'Wayanad Backwater Travels',
    });
    authStore.businessProfiles.set(agencyBusiness2AccountId, {
      _id: new Types.ObjectId(),
      accountId: agency2Id,
      businessName: 'Wayanad Backwater Travels',
      businessType: BUSINESS_TYPES.TRAVEL_AGENCY,
      contactNumber: '+919847033333',
      verificationStatus: VERIFICATION_STATUSES.PENDING,
      documents: [],
    });
    agencyBusiness2Token = createAuthToken(agencyBusiness2AccountId, 'agency2@example.com', ACCOUNT_TYPES.BUSINESS);

    // 5. Admin Viewer Account (VIEW_AGENCIES only)
    const adminViewerId = new Types.ObjectId();
    adminViewerAccountId = adminViewerId.toString();
    authStore.accounts.set(adminViewerAccountId, {
      _id: adminViewerId,
      email: 'admin.viewer@keralatourism.gov.in',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'Agency Inspector',
    });
    authStore.adminProfiles.set(adminViewerAccountId, {
      _id: new Types.ObjectId(),
      accountId: adminViewerId,
      displayName: 'Agency Inspector',
      adminLevel: ADMIN_LEVELS.DISTRICT_OFFICER,
      permissions: [ADMIN_PERMISSIONS.VIEW_AGENCIES],
      mfaEnabled: true,
    });
    adminViewerToken = createAuthToken(adminViewerAccountId, 'admin.viewer@keralatourism.gov.in', ACCOUNT_TYPES.ADMIN);

    // 6. Admin Verifier Account (VIEW_AGENCIES + VERIFY_AGENCIES)
    const adminVerifierId = new Types.ObjectId();
    adminVerifierAccountId = adminVerifierId.toString();
    authStore.accounts.set(adminVerifierAccountId, {
      _id: adminVerifierId,
      email: 'admin.verifier@keralatourism.gov.in',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'Director of Tourism',
    });
    authStore.adminProfiles.set(adminVerifierAccountId, {
      _id: new Types.ObjectId(),
      accountId: adminVerifierId,
      displayName: 'Director of Tourism',
      adminLevel: ADMIN_LEVELS.SUPER_ADMIN,
      permissions: [ADMIN_PERMISSIONS.VIEW_AGENCIES, ADMIN_PERMISSIONS.VERIFY_AGENCIES],
      mfaEnabled: true,
    });
    adminVerifierToken = createAuthToken(adminVerifierAccountId, 'admin.verifier@keralatourism.gov.in', ACCOUNT_TYPES.ADMIN);
  });

  after(() => {
    authMiddleware.setRepository(new AuthRepository());
    authorizationMiddleware.setRepository(new AuthRepository());
    authorizationController.setRepository(new AuthRepository());
    agencyService.setRepository(agencyRepository);
    agencyService.setAuditService(auditLogService);
  });

  // ============================================================================
  // 1. REGISTRATION & ELIGIBILITY ENFORCEMENT
  // ============================================================================

  it('1. Rejects non-business accounts attempting agency registration (Returns 403 FORBIDDEN_ACCOUNT_TYPE)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${touristToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Tourist Travel Corp',
        registrationNumber: 'KL-REG-1001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Valid description for tourism travel',
        contactEmail: 'tourist@corp.com',
        contactPhone: '+919847012345',
        address: 'Main Street 12',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'FORBIDDEN_ACCOUNT_TYPE');
  });

  it('2. Rejects businesses with businessType !== TRAVEL_AGENCY (Returns 400 INELIGIBLE_BUSINESS_TYPE)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${hotelBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Hotel masquerading as Agency',
        registrationNumber: 'KL-REG-2001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Hotel attempting to register an agency profile',
        contactEmail: 'hotel@resort.com',
        contactPhone: '+919847011111',
        address: 'Hill Top Road',
        district: 'Idukki',
        pinCode: '685612',
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'INELIGIBLE_BUSINESS_TYPE');
  });

  it('3. Successfully registers travel agency profile with PENDING verificationStatus (Returns 201)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Kerala Malabar Eco Tours',
        registrationNumber: 'KL-TOUR-2026-001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Eco-friendly backwater and hill station tours across Malabar and Wayanad.',
        contactEmail: 'contact@malabarecotours.com',
        contactPhone: '+919847022222',
        website: 'https://malabarecotours.com',
        address: '4th Floor, Tourism Complex, MG Road',
        district: 'Ernakulam',
        state: 'Kerala',
        pinCode: '682016',
      },
    });

    assert.equal(res.status, 201);
    const body = res.body as { success: boolean; data: AgencyDto };
    assert.equal(body.success, true);
    assert.equal(body.data.agencyName, 'Kerala Malabar Eco Tours');
    assert.equal(body.data.registrationNumber, 'KL-TOUR-2026-001');
    assert.equal(body.data.verificationStatus, 'PENDING');
    assert.equal(body.data.accountId, agencyBusinessAccountId);
    assert.equal(body.data.documentsCount, 0);
  });

  it('4. Rejects duplicate agency registration for the same business account (Returns 409 AGENCY_ALREADY_EXISTS)', async () => {
    // First registration succeeds
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Agency One',
        registrationNumber: 'KL-REG-3001',
        businessCategory: 'TRAVEL_AGENT',
        description: 'First agency profile registration',
        contactEmail: 'one@agency.com',
        contactPhone: '+919847022222',
        address: 'Beach Road',
        district: 'Kozhikode',
        pinCode: '673001',
      },
    });

    // Second registration for same account must fail
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Agency Two',
        registrationNumber: 'KL-REG-3002',
        businessCategory: 'TRAVEL_AGENT',
        description: 'Attempted second agency profile',
        contactEmail: 'two@agency.com',
        contactPhone: '+919847022222',
        address: 'Beach Road',
        district: 'Kozhikode',
        pinCode: '673001',
      },
    });

    assert.equal(res.status, 409);
    assert.equal((res.body as any).error.code, 'AGENCY_ALREADY_EXISTS');
  });

  it('5. Rejects duplicate registration number across different accounts (Returns 409 REGISTRATION_NUMBER_EXISTS)', async () => {
    // Agency 1 registers with reg number KL-REG-4001
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Original Agency',
        registrationNumber: 'KL-REG-4001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Original agency description',
        contactEmail: 'orig@agency.com',
        contactPhone: '+919847022222',
        address: 'Main St',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    // Agency 2 attempts to use same reg number KL-REG-4001
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusiness2Token}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Imposter Agency',
        registrationNumber: 'KL-REG-4001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Different agency with duplicate license',
        contactEmail: 'imposter@agency.com',
        contactPhone: '+919847033333',
        address: 'Other St',
        district: 'Wayanad',
        pinCode: '673121',
      },
    });

    assert.equal(res.status, 409);
    assert.equal((res.body as any).error.code, 'REGISTRATION_NUMBER_EXISTS');
  });

  // ============================================================================
  // 2. SELF-READ, UPDATE & BOLA / SCHEMA TAMPERING DEFENSE
  // ============================================================================

  it('6. Self-read retrieves authenticated agency profile (Returns 200)', async () => {
    const postRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Self Read Agency',
        registrationNumber: 'KL-REG-5001',
        businessCategory: 'ADVENTURE_TOURISM',
        description: 'Trekking and scuba adventures in Kerala',
        contactEmail: 'adventure@kerala.com',
        contactPhone: '+919847022222',
        address: 'Cliff Road, Varkala',
        district: 'Thiruvananthapuram',
        pinCode: '695141',
      },
    });
    if (postRes.status !== 201) {
      console.log('Test 6 POST failed:', postRes.status, JSON.stringify(postRes.body));
    }
    assert.equal(postRes.status, 201);

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = res.body as { success: boolean; data: AgencyDto };
    assert.equal(body.data.agencyName, 'Self Read Agency');
    assert.equal(body.data.district, 'Thiruvananthapuram');
  });

  it('7. Returns 404 AGENCY_NOT_FOUND when accessing profile before registering', async () => {
    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
      },
    });

    assert.equal(res.status, 404);
    assert.equal((res.body as any).error.code, 'AGENCY_NOT_FOUND');
  });

  it('8. Updates allowed fields and prevents tampering with verificationStatus or registrationNumber', async () => {
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Original Name Agency',
        registrationNumber: 'KL-REG-6001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Original agency description',
        contactEmail: 'contact@original.com',
        contactPhone: '+919847022222',
        address: 'Initial Address',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    // Valid update
    const updateRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        description: 'Updated description with expanded fleet and routes',
        contactPhone: '+919847099999',
        website: 'https://newsite.com',
      },
    });

    assert.equal(updateRes.status, 200);
    const updatedData = (updateRes.body as { data: AgencyDto }).data;
    assert.equal(updatedData.description, 'Updated description with expanded fleet and routes');
    assert.equal(updatedData.contactPhone, '+919847099999');

    // Attempting to inject verificationStatus or registrationNumber must be rejected by .strict()
    const tamperRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        verificationStatus: 'VERIFIED',
      },
    });

    assert.equal(tamperRes.status, 400);
    assert.equal((tamperRes.body as any).error.code, 'VALIDATION_ERROR');
  });

  // ============================================================================
  // 3. DOCUMENT VAULT SECURITY & FILE MAGIC BYTE VALIDATION
  // ============================================================================

  it('9. Rejects document exceeding 5MB limit (Returns 400 FILE_TOO_LARGE)', async () => {
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Doc Test Agency',
        registrationNumber: 'KL-REG-7001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency for document testing',
        contactEmail: 'doc@test.com',
        contactPhone: '+919847022222',
        address: 'Doc Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'GST_CERTIFICATE',
        originalFileName: 'huge_document.pdf',
        fileSize: 6 * 1024 * 1024, // 6 MB
        mimeType: 'application/pdf',
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('10. Rejects disallowed MIME types (Returns 400 VALIDATION_ERROR)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'GST_CERTIFICATE',
        originalFileName: 'archive.zip',
        fileSize: 1024,
        mimeType: 'application/zip',
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('11. Rejects disguised file with invalid binary magic bytes (Returns 400 INVALID_FILE_SIGNATURE)', async () => {
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Signature Agency',
        registrationNumber: 'KL-REG-8001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency testing signature verification',
        contactEmail: 'sig@agency.com',
        contactPhone: '+919847022222',
        address: 'Sig Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    // Sends text file disguised as application/pdf
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'GST_CERTIFICATE',
        originalFileName: 'fake_invoice.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        fileData: DISGUISED_TEXT_BASE64,
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'INVALID_FILE_SIGNATURE');
  });

  it('12. Accepts authentic PDF, JPEG, PNG, and WebP compliance files (Returns 201 without storageKey)', async () => {
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Valid Docs Agency',
        registrationNumber: 'KL-REG-9001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency testing valid file formats',
        contactEmail: 'val@agency.com',
        contactPhone: '+919847022222',
        address: 'Val Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    // 1. PDF
    const pdfRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'GST_CERTIFICATE',
        originalFileName: 'gst_cert.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        fileData: VALID_PDF_BASE64,
      },
    });
    assert.equal(pdfRes.status, 201);
    const pdfDoc = (pdfRes.body as { data: AgencyDocumentDto }).data;
    assert.equal(pdfDoc.documentType, 'GST_CERTIFICATE');
    assert.equal((pdfDoc as any).storageKey, undefined); // Zero leakage

    // 2. JPEG
    const jpegRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'PAN_CARD',
        originalFileName: 'pan_card.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        fileData: VALID_JPEG_BASE64,
      },
    });
    assert.equal(jpegRes.status, 201);

    // 3. PNG
    const pngRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'TRADE_LICENSE',
        originalFileName: 'trade_lic.png',
        fileSize: 1024,
        mimeType: 'image/png',
        fileData: VALID_PNG_BASE64,
      },
    });
    assert.equal(pngRes.status, 201);

    // 4. WebP
    const webpRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'TOURISM_DEPARTMENT_REGISTRATION',
        originalFileName: 'ktd_cert.webp',
        fileSize: 1024,
        mimeType: 'image/webp',
        fileData: VALID_WEBP_BASE64,
      },
    });
    assert.equal(webpRes.status, 201);

    // Verify documents count
    const profileRes = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
      },
    });
    assert.equal((profileRes.body as { data: AgencyDto }).data.documentsCount, 4);
  });

  it('13. Deletes own document and denies non-owner document deletion (Returns 404 DOCUMENT_NOT_FOUND)', async () => {
    // Agency 1 registers & uploads a document
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Delete Test Agency 1',
        registrationNumber: 'KL-REG-10001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency for delete testing',
        contactEmail: 'del1@agency.com',
        contactPhone: '+919847022222',
        address: 'Del Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    const uploadRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency/documents',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        documentType: 'TRADE_LICENSE',
        originalFileName: 'trade_lic.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        fileData: VALID_PDF_BASE64,
      },
    });
    const docId = (uploadRes.body as { data: AgencyDocumentDto }).data.id;

    // Agency 2 registers
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusiness2Token}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Delete Test Agency 2',
        registrationNumber: 'KL-REG-10002',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency 2 for BOLA testing',
        contactEmail: 'del2@agency.com',
        contactPhone: '+919847033333',
        address: 'Other Road',
        district: 'Wayanad',
        pinCode: '673121',
      },
    });

    // Agency 2 attempts to delete Agency 1's document
    const unauthorizedDelete = await dispatchRequest(app, {
      method: 'DELETE',
      url: `/api/v1/business/agency/documents/${docId}`,
      headers: {
        authorization: `Bearer ${agencyBusiness2Token}`,
      },
    });
    assert.equal(unauthorizedDelete.status, 404);
    assert.equal((unauthorizedDelete.body as any).error.code, 'DOCUMENT_NOT_FOUND');

    // Agency 1 successfully deletes own document
    const authorizedDelete = await dispatchRequest(app, {
      method: 'DELETE',
      url: `/api/v1/business/agency/documents/${docId}`,
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
      },
    });
    assert.equal(authorizedDelete.status, 200);
    assert.equal((authorizedDelete.body as any).success, true);
  });

  // ============================================================================
  // 4. ADMIN INSPECTION & RBAC PERMISSION ENFORCEMENT
  // ============================================================================

  it('14. Admin listing requires VIEW_AGENCIES permission (Returns 403 when lacking permission)', async () => {
    // Admin without VIEW_AGENCIES
    const noPermAdminId = new Types.ObjectId();
    const noPermAccountId = noPermAdminId.toString();
    authStore.accounts.set(noPermAccountId, {
      _id: noPermAdminId,
      email: 'noperm@kerala.gov.in',
      passwordHash: 'hash',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
      displayName: 'No Perm Admin',
    });
    authStore.adminProfiles.set(noPermAccountId, {
      _id: new Types.ObjectId(),
      accountId: noPermAdminId,
      displayName: 'No Perm Admin',
      adminLevel: ADMIN_LEVELS.MODERATOR,
      permissions: [ADMIN_PERMISSIONS.VIEW_DASHBOARD],
      mfaEnabled: true,
    });
    const noPermToken = createAuthToken(noPermAccountId, 'noperm@kerala.gov.in', ACCOUNT_TYPES.ADMIN);

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/admin/agencies',
      headers: {
        authorization: `Bearer ${noPermToken}`,
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  it('15. Admin with VIEW_AGENCIES lists and filters registered agencies (Returns 200)', async () => {
    // Create test agency
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Munnar Highland Adventures',
        registrationNumber: 'KL-REG-11001',
        businessCategory: 'ADVENTURE_TOURISM',
        description: 'Trekking through Munnar tea gardens',
        contactEmail: 'munnar@adventures.com',
        contactPhone: '+919847022222',
        address: 'Tea Estate Road, Munnar',
        district: 'Idukki',
        pinCode: '685612',
      },
    });
    if (createRes.status !== 201) {
      console.log('Test 15 POST failed:', createRes.status, JSON.stringify(createRes.body));
    }
    assert.equal(createRes.status, 201);

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/admin/agencies?district=Idukki&verificationStatus=PENDING',
      headers: {
        authorization: `Bearer ${adminViewerToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = res.body as { success: boolean; data: AgencyDto[]; pagination: { total: number } };
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].agencyName, 'Munnar Highland Adventures');
    assert.equal(body.pagination.total, 1);
  });

  // ============================================================================
  // 5. ADMIN REVIEW, ATOMIC STATUS TRANSITION & DUAL-COLLECTION SYNC
  // ============================================================================

  it('16. Status review requires VERIFY_AGENCIES permission (Viewer admin receives 403)', async () => {
    // Register agency
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Review Perm Agency',
        registrationNumber: 'KL-REG-12001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Testing review permission gates',
        contactEmail: 'rev@agency.com',
        contactPhone: '+919847022222',
        address: 'MG Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });
    const agencyId = (createRes.body as { data: AgencyDto }).data.id;

    // Admin viewer (has only VIEW_AGENCIES) tries to review
    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/agencies/${agencyId}/review`,
      headers: {
        authorization: `Bearer ${adminViewerToken}`,
        'content-type': 'application/json',
      },
      body: {
        status: 'VERIFIED',
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  it('17. Enforces rejection reason when transitioning status to REJECTED (Returns 400)', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Reject Reason Agency',
        registrationNumber: 'KL-REG-13001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Testing rejection reason validation',
        contactEmail: 'rej@agency.com',
        contactPhone: '+919847022222',
        address: 'MG Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });
    const agencyId = (createRes.body as { data: AgencyDto }).data.id;

    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/agencies/${agencyId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        status: 'REJECTED',
        // missing rejectionReason
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('18. Approves agency, synchronizes BusinessProfile.verificationStatus, and records AuditLog', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Approval Test Agency',
        registrationNumber: 'KL-REG-14001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency destined for approval and audit inspection',
        contactEmail: 'app@agency.com',
        contactPhone: '+919847022222',
        address: 'MG Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });
    const agencyId = (createRes.body as { data: AgencyDto }).data.id;

    // Verify initial BusinessProfile status is PENDING
    assert.equal(
      authStore.businessProfiles.get(agencyBusinessAccountId)?.verificationStatus,
      'PENDING',
    );

    // Verifier admin reviews and approves agency
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

    assert.equal(reviewRes.status, 200);
    const body = reviewRes.body as { success: boolean; data: AgencyDto; auditLog: AuditLogEntryDto };
    assert.equal(body.success, true);
    assert.equal(body.data.verificationStatus, 'VERIFIED');
    assert.notEqual(body.data.verifiedAt, null);

    // Verify dual-collection synchronization
    const syncedBusinessProfile = authStore.businessProfiles.get(agencyBusinessAccountId);
    assert.equal(syncedBusinessProfile?.verificationStatus, 'VERIFIED');

    // Verify AuditLog record
    assert.equal(body.auditLog.action, 'AGENCY_APPROVED');
    assert.equal(body.auditLog.targetEntityId, agencyId);
    assert.equal(body.auditLog.actorAccountId, adminVerifierAccountId);
    assert.equal(agencyStore.auditLogs.length, 1);
  });

  // ============================================================================
  // 6. COMMERCIAL OPERATIONS GATING & RATE LIMITING
  // ============================================================================

  it('19. Gating verification: unverified business cannot create packages; verified agency can', async () => {
    // 1. Unverified agency attempt (status is PENDING)
    const blockedRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Unauthorized Malabar Tour Package',
        durationDays: 4,
        durationNights: 3,
        pricePerPerson: 12000,
        inclusions: ['Breakfast', 'Houseboat stay'],
        maxGroupSize: 10,
      },
    });
    assert.equal(blockedRes.status, 403);
    assert.equal((blockedRes.body as any).error.code, 'BUSINESS_NOT_VERIFIED');

    // 2. Register & approve agency
    const regRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Gating Verified Agency',
        registrationNumber: 'KL-REG-15001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency testing commercial gating',
        contactEmail: 'gate@agency.com',
        contactPhone: '+919847022222',
        address: 'MG Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });
    const agencyId = (regRes.body as { data: AgencyDto }).data.id;

    await dispatchRequest(app, {
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

    // 3. Now verified: package creation succeeds
    const allowedRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Authorized Malabar Tour Package',
        durationDays: 4,
        durationNights: 3,
        pricePerPerson: 12000,
        inclusions: ['Breakfast', 'Houseboat stay'],
        maxGroupSize: 10,
      },
    });
    assert.equal(allowedRes.status, 201);
  });

  it('20. Agency document upload rate limiter blocks burst flooding (Returns 429)', async () => {
    // Register agency first
    await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/agency',
      headers: {
        authorization: `Bearer ${agencyBusinessToken}`,
        'content-type': 'application/json',
      },
      body: {
        agencyName: 'Rate Limit Test Agency',
        registrationNumber: 'KL-REG-16001',
        businessCategory: 'TOUR_OPERATOR',
        description: 'Agency for rate limiting test',
        contactEmail: 'rate@agency.com',
        contactPhone: '+919847022222',
        address: 'Rate Road',
        district: 'Ernakulam',
        pinCode: '682001',
      },
    });

    // In test environment, agencyDocumentRateLimiter max is 15 requests
    let rateLimited = false;
    for (let i = 0; i < 25; i += 1) {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: '/api/v1/business/agency/documents',
        headers: {
          authorization: `Bearer ${agencyBusinessToken}`,
          'content-type': 'application/json',
        },
        body: {
          documentType: 'GST_CERTIFICATE',
          originalFileName: `cert_${i}.pdf`,
          fileSize: 1024,
          mimeType: 'application/pdf',
          fileData: VALID_PDF_BASE64,
        },
      });

      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }

    assert.equal(rateLimited, true, 'agencyDocumentRateLimiter must return 429 when max requests exceeded');
  });
});
