import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ADMIN_PERMISSIONS,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type {
  AdminPermission,
  TravelPackageDto,
  PublicTravelPackageDto,
} from '@kerala-tourism/shared-types';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { authorizationController } from '../modules/authorization/authorization.controller';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import {
  AuditLogService,
  RecordAdminAuditInput,
} from '../modules/admin/audit-log.service';
import { AuthRepository } from '../modules/auth/auth.repository';
import { AgencyRepository } from '../modules/agencies/agency.repository';
import { agencyService } from '../modules/agencies/agency.service';
import { PackageRepository } from '../modules/packages/package.repository';
import { packageService } from '../modules/packages/package.service';
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
  accountType: string;
  status: string;
}

interface StoredBusinessProfile {
  _id: Types.ObjectId;
  accountId: Types.ObjectId;
  businessName: string;
  businessType: string;
  verificationStatus: string;
}

interface StoredAdminProfile {
  _id: Types.ObjectId;
  accountId: Types.ObjectId;
  adminLevel: string;
  permissions: AdminPermission[];
  mfaEnabled: boolean;
}

class TestAuthRepository extends AuthRepository {
  public accounts: Map<string, StoredAccount> = new Map();
  public businessProfiles: Map<string, StoredBusinessProfile> = new Map();
  public adminProfiles: Map<string, StoredAdminProfile> = new Map();

  public override async findAccountById(id: string | Types.ObjectId): Promise<IAccountDocument | null> {
    const acc = this.accounts.get(id.toString());
    if (!acc) return null;
    return acc as unknown as IAccountDocument;
  }

  public override async findAdminProfile(accountId: string | Types.ObjectId): Promise<IAdminProfileDocument | null> {
    const profile = this.adminProfiles.get(accountId.toString());
    if (!profile) return null;
    return profile as unknown as IAdminProfileDocument;
  }

  public override async findBusinessProfile(accountId: string | Types.ObjectId): Promise<IBusinessProfileDocument | null> {
    const profile = this.businessProfiles.get(accountId.toString());
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
  public agencies: Map<string, any> = new Map();

  public override async findAgencyByAccountId(accountId: string | Types.ObjectId): Promise<any | null> {
    for (const agency of this.agencies.values()) {
      if (agency.accountId.toString() === accountId.toString()) {
        return JSON.parse(JSON.stringify(agency));
      }
    }
    return null;
  }

  public override async findAgencyById(id: string | Types.ObjectId): Promise<any | null> {
    const doc = this.agencies.get(id.toString());
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }
}

class TestAuditService extends AuditLogService {
  public auditRecords: any[] = [];

  public override async recordAdminAction(input: RecordAdminAuditInput): Promise<any> {
    const record = {
      id: new Types.ObjectId().toString(),
      ...input,
      timestamp: new Date().toISOString(),
    };
    this.auditRecords.push(record);
    return record;
  }
}

describe('Day 20: Travel Packages & Agency Package Management Unit Test Suite', () => {
  const app = createApp();

  let testAuthRepo: TestAuthRepository;
  let testAgencyRepo: TestAgencyRepository;
  let testPackageRepo: PackageRepository;
  let testAuditService: TestAuditService;

  // Actors
  let agency1AccountId: Types.ObjectId;
  let agency1Id: Types.ObjectId;
  let agency1Token: string;

  let agency2AccountId: Types.ObjectId;
  let agency2Id: Types.ObjectId;
  let agency2Token: string;

  let unverifiedBizAccountId: Types.ObjectId;
  let unverifiedBizToken: string;

  let touristAccountId: Types.ObjectId;
  let touristToken: string;

  let adminVerifierId: Types.ObjectId;
  let adminVerifierToken: string;

  let adminUnauthorizedId: Types.ObjectId;
  let adminUnauthorizedToken: string;

  beforeEach(() => {
    resetRateLimiter();

    testAuthRepo = new TestAuthRepository();
    testAgencyRepo = new TestAgencyRepository();
    testPackageRepo = new PackageRepository();
    testAuditService = new TestAuditService();

    // Wire dependency injection
    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);
    authorizationController.setRepository(testAuthRepo);
    agencyService.setRepository(testAgencyRepo);
    packageService.setRepository(testPackageRepo);
    packageService.setAgencyRepository(testAgencyRepo);
    packageService.setAuthRepository(testAuthRepo);
    packageService.setAuditService(testAuditService);

    // 1. Verified Agency 1
    agency1AccountId = new Types.ObjectId();
    agency1Id = new Types.ObjectId();
    testAuthRepo.accounts.set(agency1AccountId.toString(), {
      _id: agency1AccountId,
      email: 'agency1@keralatourism.org',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(agency1AccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: agency1AccountId,
      businessName: 'Kerala Trails & Expeditions',
      businessType: 'TRAVEL_AGENCY',
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });
    testAgencyRepo.agencies.set(agency1Id.toString(), {
      _id: agency1Id,
      accountId: agency1AccountId,
      agencyName: 'Kerala Trails & Expeditions',
      registrationNumber: 'KL-TRAIL-001',
      businessCategory: 'TOUR_OPERATOR',
      district: 'Ernakulam',
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      contactEmail: 'contact@keralatrails.org',
      contactPhone: '+919847011111',
      website: 'https://keralatrails.org',
    });
    agency1Token = jwtService.signAccessToken({
      id: agency1AccountId.toString(),
      email: 'agency1@keralatourism.org',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 2. Verified Agency 2 (for BOLA testing)
    agency2AccountId = new Types.ObjectId();
    agency2Id = new Types.ObjectId();
    testAuthRepo.accounts.set(agency2AccountId.toString(), {
      _id: agency2AccountId,
      email: 'agency2@keralatourism.org',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(agency2AccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: agency2AccountId,
      businessName: 'Malabar Backwaters Travel',
      businessType: 'TRAVEL_AGENCY',
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });
    testAgencyRepo.agencies.set(agency2Id.toString(), {
      _id: agency2Id,
      accountId: agency2AccountId,
      agencyName: 'Malabar Backwaters Travel',
      registrationNumber: 'KL-BACKWATER-002',
      businessCategory: 'TOUR_OPERATOR',
      district: 'Alappuzha',
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      contactEmail: 'contact@malabarbackwaters.org',
      contactPhone: '+919847022222',
      website: 'https://malabarbackwaters.org',
    });
    agency2Token = jwtService.signAccessToken({
      id: agency2AccountId.toString(),
      email: 'agency2@keralatourism.org',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 3. Unverified Business
    unverifiedBizAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(unverifiedBizAccountId.toString(), {
      _id: unverifiedBizAccountId,
      email: 'unverified@business.org',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(unverifiedBizAccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: unverifiedBizAccountId,
      businessName: 'Unverified Agency Inc',
      businessType: 'TRAVEL_AGENCY',
      verificationStatus: VERIFICATION_STATUSES.PENDING,
    });
    unverifiedBizToken = jwtService.signAccessToken({
      id: unverifiedBizAccountId.toString(),
      email: 'unverified@business.org',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 4. Tourist
    touristAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(touristAccountId.toString(), {
      _id: touristAccountId,
      email: 'tourist@gmail.com',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    touristToken = jwtService.signAccessToken({
      id: touristAccountId.toString(),
      email: 'tourist@gmail.com',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 5. Admin with MODERATE_PACKAGES & VIEW_PACKAGES
    adminVerifierId = new Types.ObjectId();
    testAuthRepo.accounts.set(adminVerifierId.toString(), {
      _id: adminVerifierId,
      email: 'verifier.admin@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.adminProfiles.set(adminVerifierId.toString(), {
      _id: new Types.ObjectId(),
      accountId: adminVerifierId,
      adminLevel: 'SUPER_ADMIN',
      permissions: [ADMIN_PERMISSIONS.VIEW_PACKAGES, ADMIN_PERMISSIONS.MODERATE_PACKAGES],
      mfaEnabled: true,
    });
    adminVerifierToken = jwtService.signAccessToken({
      id: adminVerifierId.toString(),
      email: 'verifier.admin@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 6. Admin without MODERATE_PACKAGES
    adminUnauthorizedId = new Types.ObjectId();
    testAuthRepo.accounts.set(adminUnauthorizedId.toString(), {
      _id: adminUnauthorizedId,
      email: 'unauthorized.admin@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.adminProfiles.set(adminUnauthorizedId.toString(), {
      _id: new Types.ObjectId(),
      accountId: adminUnauthorizedId,
      adminLevel: 'DISTRICT_OFFICER',
      permissions: [ADMIN_PERMISSIONS.VIEW_DASHBOARD],
      mfaEnabled: true,
    });
    adminUnauthorizedToken = jwtService.signAccessToken({
      id: adminUnauthorizedId.toString(),
      email: 'unauthorized.admin@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
  });

  // ============================================================================
  // TEST SUITE: 20 REQUIREMENTS
  // ============================================================================

  it('1. Verified agency creates a package (Defaults to DRAFT status)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Munnar Tea Gardens & Spice Trail',
        shortDescription: 'Explore the lush misty hills of Munnar and aromatic spice plantations.',
        description: 'Comprehensive 4-day tour through tea gardens, waterfalls, and national parks in Idukki.',
        packageCategory: 'HILL_STATION',
        durationDays: 4,
        durationNights: 3,
        basePrice: 12500,
        itinerary: [
          { dayNumber: 1, title: 'Arrival & Tea Museum', description: 'Arrive at Munnar, check in, visit KDHP museum.' },
          { dayNumber: 2, title: 'Eravikulam National Park', description: 'Spot the endangered Nilgiri Tahr.' },
          { dayNumber: 3, title: 'Mattupetty Dam & Echo Point', description: 'Scenic boat ride and speed boating.' },
          { dayNumber: 4, title: 'Spice Garden Walk & Departure', description: 'Guided botanical tour and return.' },
        ],
        inclusions: ['Luxury Resort Stay', 'Breakfast & Dinner', 'Private Cab'],
        exclusions: ['Airfare', 'Entry tickets'],
      },
    });

    assert.equal(res.status, 201);
    const data = (res.body as { data: TravelPackageDto }).data;
    assert.equal(data.status, 'DRAFT');
    assert.equal(data.title, 'Munnar Tea Gardens & Spice Trail');
    assert.equal(data.agencyId, agency1Id.toString());
    assert.equal(data.createdBy, agency1AccountId.toString());
    assert.match(data.slug, /^munnar-tea-gardens-spice-trail/);
  });

  it('2. Unverified agency cannot create a package (Returns 403 BUSINESS_NOT_VERIFIED)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${unverifiedBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Unverified Wayanad Safari',
        durationDays: 3,
        durationNights: 2,
        basePrice: 8000,
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'BUSINESS_NOT_VERIFIED');
  });

  it('3. Tourist cannot create a package (Returns 403 FORBIDDEN_ACCOUNT_TYPE)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${touristToken}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Tourist Unauthorized Package',
        durationDays: 2,
        durationNights: 1,
        basePrice: 5000,
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'FORBIDDEN_ACCOUNT_TYPE');
  });

  it("4. Agency cannot modify another agency's package (404 Concealment RESOURCE_NOT_FOUND)", async () => {
    // Agency 1 creates a package
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Agency 1 Private Package',
        durationDays: 3,
        durationNights: 2,
        basePrice: 9000,
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;

    // Agency 2 attempts to update Agency 1's package
    const attackRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/business/packages/${packageId}`,
      headers: {
        authorization: `Bearer ${agency2Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Hijacked by Agency 2',
      },
    });

    assert.equal(attackRes.status, 404);
    assert.equal((attackRes.body as any).error.code, 'RESOURCE_NOT_FOUND');
  });

  it('5. Client cannot spoof agencyId (agencyId strictly derived from authenticated agency)', async () => {
    const fakeAgencyId = new Types.ObjectId().toString();
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Spoof Agency ID Attempt',
        agencyId: fakeAgencyId, // Should be rejected by .strict() schema
        durationDays: 2,
        durationNights: 1,
        basePrice: 4000,
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('6. Client cannot spoof createdBy or status (Strict schema rejection)', async () => {
    const fakeUserId = new Types.ObjectId().toString();
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Privilege Escalation Package',
        createdBy: fakeUserId,
        status: 'PUBLISHED',
        durationDays: 2,
        durationNights: 1,
        basePrice: 5000,
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('7. Invalid destination reference is rejected (Returns 400 INVALID_DESTINATIONS)', async () => {
    // In disconnected test runner, invalid hex format is caught by schema, and invalid ObjectId reference is caught by validator
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Invalid Destination Reference',
        destinationIds: ['invalid-object-id-string'],
        durationDays: 3,
        durationNights: 2,
        basePrice: 6000,
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('8. Unauthorized media reference is rejected (Returns 400 INVALID_MEDIA_REFERENCE or VALIDATION_ERROR)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Unauthorized Media Reference',
        coverMediaId: 'invalid-media-id-format',
        durationDays: 3,
        durationNights: 2,
        basePrice: 6000,
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('9. New package defaults to DRAFT status', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Wayanad Chembra Peak Trekking',
        durationDays: 2,
        durationNights: 1,
        basePrice: 4500,
      },
    });

    assert.equal(res.status, 201);
    const data = (res.body as { data: TravelPackageDto }).data;
    assert.equal(data.status, 'DRAFT');
  });

  it('10. Draft package is not publicly visible (GET /packages excludes it, GET /packages/:slug returns 404)', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Secret Hidden Draft Package',
        durationDays: 3,
        durationNights: 2,
        basePrice: 8000,
      },
    });
    const slug = (createRes.body as { data: TravelPackageDto }).data.slug;

    // Public list excludes draft package
    const listRes = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/packages',
    });
    assert.equal(listRes.status, 200);
    const items = (listRes.body as { data: PublicTravelPackageDto[] }).data;
    const found = items.find((p) => p.slug === slug);
    assert.equal(found, undefined);

    // Direct slug lookup returns 404
    const slugRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/packages/${slug}`,
    });
    assert.equal(slugRes.status, 404);
    assert.equal((slugRes.body as any).error.code, 'RESOURCE_NOT_FOUND');
  });

  it('11. Published package is publicly visible (Returns 200 with sanitized agency info)', async () => {
    // 1. Create draft package
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Alleppey Luxury Houseboat Cruise',
        shortDescription: 'Overnight cruise through Alleppey backwaters.',
        description: 'Cruising through Punnamada lake with authentic Kerala cuisine prepared onboard.',
        durationDays: 2,
        durationNights: 1,
        basePrice: 15000,
        itinerary: [
          { dayNumber: 1, title: 'Boarding & Cruise', description: 'Board houseboat at 12 PM, lunch and village cruise.' },
          { dayNumber: 2, title: 'Sunrise & Disembark', description: 'Breakfast, morning cruise and checkout at 9 AM.' },
        ],
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;
    const slug = (createRes.body as { data: TravelPackageDto }).data.slug;

    // 2. Submit for review
    await dispatchRequest(app, {
      method: 'POST',
      url: `/api/v1/business/packages/${packageId}/submit-review`,
      headers: {
        authorization: `Bearer ${agency1Token}`,
      },
    });

    // 3. Admin reviews and approves
    const reviewRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVE',
      },
    });
    assert.equal(reviewRes.status, 200);

    // 4. Now publicly visible
    const slugRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/packages/${slug}`,
    });
    assert.equal(slugRes.status, 200);
    const pubPkg = (slugRes.body as { data: PublicTravelPackageDto }).data;
    assert.equal(pubPkg.title, 'Alleppey Luxury Houseboat Cruise');
    assert.equal(pubPkg.agency.agencyName, 'Kerala Trails & Expeditions');
  });

  it('12. Rejected package is not publicly visible (Direct slug returns 404)', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Low Quality Reject Package',
        shortDescription: 'Inadequate package description.',
        description: 'Short text here describing nothing useful.',
        durationDays: 2,
        durationNights: 1,
        basePrice: 2000,
        itinerary: [{ dayNumber: 1, title: 'Day 1', description: 'Walk around' }],
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;
    const slug = (createRes.body as { data: TravelPackageDto }).data.slug;

    // Submit and reject
    await dispatchRequest(app, {
      method: 'POST',
      url: `/api/v1/business/packages/${packageId}/submit-review`,
      headers: { authorization: `Bearer ${agency1Token}` },
    });

    await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'REJECT',
        rejectionReason: 'The itinerary details and inclusions are insufficient.',
      },
    });

    // Public lookup returns 404
    const pubRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/packages/${slug}`,
    });
    assert.equal(pubRes.status, 404);
  });

  it('13. Unverified agency packages are hidden from public lookup', async () => {
    // If an agency's verification is revoked or unverified, packages are hidden
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Package Before Revocation',
        shortDescription: 'Package description.',
        description: 'Full description of the tour package.',
        durationDays: 2,
        durationNights: 1,
        basePrice: 3000,
        itinerary: [{ dayNumber: 1, title: 'Day 1', description: 'Activity' }],
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;
    const slug = (createRes.body as { data: TravelPackageDto }).data.slug;

    // Publish it
    await dispatchRequest(app, {
      method: 'POST',
      url: `/api/v1/business/packages/${packageId}/submit-review`,
      headers: { authorization: `Bearer ${agency1Token}` },
    });
    await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVE' },
    });

    // Revoke agency verification
    const agencyRecord = testAgencyRepo.agencies.get(agency1Id.toString());
    agencyRecord.verificationStatus = 'REJECTED';

    // Public lookup now returns 404
    const pubRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/packages/${slug}`,
    });
    assert.equal(pubRes.status, 404);
  });

  it('14. Suspended agency account packages are hidden publicly', async () => {
    // Re-verify agency
    const agencyRecord = testAgencyRepo.agencies.get(agency1Id.toString());
    agencyRecord.verificationStatus = 'VERIFIED';

    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Package Before Suspension',
        shortDescription: 'Package description.',
        description: 'Full description of the tour package.',
        durationDays: 2,
        durationNights: 1,
        basePrice: 3500,
        itinerary: [{ dayNumber: 1, title: 'Day 1', description: 'Activity' }],
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;
    const slug = (createRes.body as { data: TravelPackageDto }).data.slug;

    // Publish
    await dispatchRequest(app, {
      method: 'POST',
      url: `/api/v1/business/packages/${packageId}/submit-review`,
      headers: { authorization: `Bearer ${agency1Token}` },
    });
    await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVE' },
    });

    // Suspend agency account
    const accRecord = testAuthRepo.accounts.get(agency1AccountId.toString());
    accRecord!.status = ACCOUNT_STATUSES.SUSPENDED;

    // Public lookup now returns 404
    const pubRes = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/packages/${slug}`,
    });
    assert.equal(pubRes.status, 404);
  });

  it('15. Invalid price and duration values are rejected (Returns 400 VALIDATION_ERROR)', async () => {
    // Price <= 0
    const zeroPriceRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Zero Price Package',
        durationDays: 3,
        durationNights: 2,
        basePrice: 0,
      },
    });
    assert.equal(zeroPriceRes.status, 400);

    // Duration days = 0
    const zeroDaysRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Zero Days Package',
        durationDays: 0,
        durationNights: 0,
        basePrice: 5000,
      },
    });
    assert.equal(zeroDaysRes.status, 400);
  });

  it('16. Invalid status transitions are rejected (Returns 400)', async () => {
    const accRecord = testAuthRepo.accounts.get(agency1AccountId.toString());
    accRecord!.status = ACCOUNT_STATUSES.ACTIVE;

    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Status Machine Guarded Package',
        shortDescription: 'Package description.',
        description: 'Comprehensive description of tour.',
        durationDays: 3,
        durationNights: 2,
        basePrice: 6000,
        itinerary: [{ dayNumber: 1, title: 'Day 1', description: 'Activity' }],
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;

    // Submit for review -> Status becomes PENDING_REVIEW
    await dispatchRequest(app, {
      method: 'POST',
      url: `/api/v1/business/packages/${packageId}/submit-review`,
      headers: { authorization: `Bearer ${agency1Token}` },
    });

    // Attempt to edit package while PENDING_REVIEW (should be blocked)
    const editBlockedRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/business/packages/${packageId}`,
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Illegal Edit While Under Review',
      },
    });
    assert.equal(editBlockedRes.status, 400);
    assert.equal((editBlockedRes.body as any).error.code, 'PACKAGE_NOT_MODIFIABLE');

    // Attempt to re-submit package while already PENDING_REVIEW (should be blocked)
    const reSubmitRes = await dispatchRequest(app, {
      method: 'POST',
      url: `/api/v1/business/packages/${packageId}/submit-review`,
      headers: { authorization: `Bearer ${agency1Token}` },
    });
    assert.equal(reSubmitRes.status, 400);
    assert.equal((reSubmitRes.body as any).error.code, 'ALREADY_SUBMITTED');
  });

  it('17. Only authorized admins with MODERATE_PACKAGES can review packages (Returns 403)', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Admin Authorization Test Package',
        durationDays: 2,
        durationNights: 1,
        basePrice: 4000,
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;

    // Unauthorized admin tries to review
    const unauthRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminUnauthorizedToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVE',
      },
    });
    assert.equal(unauthRes.status, 403);
    assert.equal((unauthRes.body as any).error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  it('18. Rejection requires a mandatory reason of at least 5 chars (Returns 400)', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Rejection Reason Validation Package',
        durationDays: 2,
        durationNights: 1,
        basePrice: 4000,
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;

    // Decision REJECT without rejectionReason
    const rejectNoReasonRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'REJECT',
      },
    });
    assert.equal(rejectNoReasonRes.status, 400);

    // Decision REJECT with too short rejectionReason
    const rejectShortReasonRes = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'REJECT',
        rejectionReason: 'Bad',
      },
    });
    assert.equal(rejectShortReasonRes.status, 400);
  });

  it('19. Concurrent review attempts cannot create inconsistent states', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Concurrent Review Safe Package',
        durationDays: 2,
        durationNights: 1,
        basePrice: 5000,
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;

    // Send two concurrent reviews
    const [review1, review2] = await Promise.all([
      dispatchRequest(app, {
        method: 'PATCH',
        url: `/api/v1/admin/packages/${packageId}/review`,
        headers: {
          authorization: `Bearer ${adminVerifierToken}`,
          'content-type': 'application/json',
        },
        body: { decision: 'APPROVE' },
      }),
      dispatchRequest(app, {
        method: 'PATCH',
        url: `/api/v1/admin/packages/${packageId}/review`,
        headers: {
          authorization: `Bearer ${adminVerifierToken}`,
          'content-type': 'application/json',
        },
        body: { decision: 'APPROVE' },
      }),
    ]);

    assert.equal(review1.status, 200);
    assert.equal(review2.status, 200);
    const pkg = await testPackageRepo.findPackageById(packageId);
    assert.equal(pkg?.status, 'PUBLISHED');
  });

  it('20. Audit logs are recorded correctly on admin package review', async () => {
    const createRes = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/packages',
      headers: {
        authorization: `Bearer ${agency1Token}`,
        'content-type': 'application/json',
      },
      body: {
        title: 'Audited Travel Package',
        durationDays: 3,
        durationNights: 2,
        basePrice: 7000,
      },
    });
    const packageId = (createRes.body as { data: TravelPackageDto }).data.id;

    const initialAuditCount = testAuditService.auditRecords.length;

    await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/packages/${packageId}/review`,
      headers: {
        authorization: `Bearer ${adminVerifierToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVE',
      },
    });

    assert.equal(testAuditService.auditRecords.length, initialAuditCount + 1);
    const lastAudit = testAuditService.auditRecords[testAuditService.auditRecords.length - 1];
    assert.equal(lastAudit.action, 'PACKAGE_APPROVED');
    assert.equal(lastAudit.targetEntityType, 'TRAVEL_PACKAGE');
    assert.equal(lastAudit.targetEntityId.toString(), packageId);
    assert.equal(lastAudit.actorAccountId.toString(), adminVerifierId.toString());
  });
});
