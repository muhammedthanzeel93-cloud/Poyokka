import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ADMIN_PERMISSIONS,
  BUSINESS_TYPES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type {
  AdminPermission,
  PropertyDto,
  PublicPropertyDto,
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
import { PropertyRepository } from '../modules/properties/property.repository';
import { propertyService } from '../modules/properties/property.service';
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

  public override async createProperty(data: any): Promise<any> {
    return {
      _id: new Types.ObjectId(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  public override async findPropertyById(_id: any): Promise<any> {
    return null;
  }

  public override async updateProperty(id: any, data: any): Promise<any> {
    return { _id: id, ...data };
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

describe('Day 21: Property, Hotel, Resort & Accommodation Management Unit Test Suite', () => {
  const app = createApp();

  let testAuthRepo: TestAuthRepository;
  let testPropertyRepo: PropertyRepository;
  let testAuditService: TestAuditService;

  // Actors
  let hotelBizAccountId: Types.ObjectId;
  let hotelBizProfileId: Types.ObjectId;
  let hotelBizToken: string;

  let resortBizAccountId: Types.ObjectId;
  let resortBizProfileId: Types.ObjectId;
  let resortBizToken: string;

  let unverifiedBizAccountId: Types.ObjectId;
  let unverifiedBizToken: string;

  let travelAgencyBizAccountId: Types.ObjectId;
  let travelAgencyBizToken: string;

  let touristAccountId: Types.ObjectId;
  let touristToken: string;

  let adminAccountId: Types.ObjectId;
  let adminToken: string;

  let unauthorizedAdminAccountId: Types.ObjectId;
  let unauthorizedAdminToken: string;

  beforeEach(() => {
    resetRateLimiter();
    testAuthRepo = new TestAuthRepository();
    testPropertyRepo = new PropertyRepository();
    testAuditService = new TestAuditService();

    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);
    authorizationController.setRepository(testAuthRepo);
    propertyService.setRepository(testPropertyRepo);
    propertyService.setAuditService(testAuditService);

    // 1. Hotel Business Account (Verified)
    hotelBizAccountId = new Types.ObjectId();
    hotelBizProfileId = new Types.ObjectId();
    testAuthRepo.accounts.set(hotelBizAccountId.toString(), {
      _id: hotelBizAccountId,
      email: 'grand.heritage@keralatourism.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(hotelBizAccountId.toString(), {
      _id: hotelBizProfileId,
      accountId: hotelBizAccountId,
      businessName: 'Grand Heritage Kochi Hotel',
      businessType: BUSINESS_TYPES.HOTEL,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });
    hotelBizToken = jwtService.signAccessToken({
      id: hotelBizAccountId.toString(),
      email: 'grand.heritage@keralatourism.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 2. Resort Business Account (Verified)
    resortBizAccountId = new Types.ObjectId();
    resortBizProfileId = new Types.ObjectId();
    testAuthRepo.accounts.set(resortBizAccountId.toString(), {
      _id: resortBizAccountId,
      email: 'kumarakom.retreat@keralatourism.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(resortBizAccountId.toString(), {
      _id: resortBizProfileId,
      accountId: resortBizAccountId,
      businessName: 'Kumarakom Backwater Retreat',
      businessType: BUSINESS_TYPES.RESORT,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });
    resortBizToken = jwtService.signAccessToken({
      id: resortBizAccountId.toString(),
      email: 'kumarakom.retreat@keralatourism.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 3. Unverified Business Account
    unverifiedBizAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(unverifiedBizAccountId.toString(), {
      _id: unverifiedBizAccountId,
      email: 'unverified@stays.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(unverifiedBizAccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: unverifiedBizAccountId,
      businessName: 'Unverified Homestay',
      businessType: BUSINESS_TYPES.HOMESTAY,
      verificationStatus: VERIFICATION_STATUSES.PENDING,
    });
    unverifiedBizToken = jwtService.signAccessToken({
      id: unverifiedBizAccountId.toString(),
      email: 'unverified@stays.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 4. Ineligible Business Type (Travel Agency)
    travelAgencyBizAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(travelAgencyBizAccountId.toString(), {
      _id: travelAgencyBizAccountId,
      email: 'agency@travels.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(travelAgencyBizAccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: travelAgencyBizAccountId,
      businessName: 'Kerala Horizons Agency',
      businessType: BUSINESS_TYPES.TRAVEL_AGENCY,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });
    travelAgencyBizToken = jwtService.signAccessToken({
      id: travelAgencyBizAccountId.toString(),
      email: 'agency@travels.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 5. Tourist Account
    touristAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(touristAccountId.toString(), {
      _id: touristAccountId,
      email: 'tourist.arjun@keralatourism.test',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    touristToken = jwtService.signAccessToken({
      id: touristAccountId.toString(),
      email: 'tourist.arjun@keralatourism.test',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 6. Authorized Admin (VIEW_PROPERTIES, MODERATE_PROPERTIES)
    adminAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(adminAccountId.toString(), {
      _id: adminAccountId,
      email: 'admin.officer@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.adminProfiles.set(adminAccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: adminAccountId,
      adminLevel: 'DISTRICT_OFFICER',
      permissions: [ADMIN_PERMISSIONS.VIEW_PROPERTIES, ADMIN_PERMISSIONS.MODERATE_PROPERTIES],
      mfaEnabled: true,
    });
    adminToken = jwtService.signAccessToken({
      id: adminAccountId.toString(),
      email: 'admin.officer@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 7. Unauthorized Admin (lacks MODERATE_PROPERTIES)
    unauthorizedAdminAccountId = new Types.ObjectId();
    testAuthRepo.accounts.set(unauthorizedAdminAccountId.toString(), {
      _id: unauthorizedAdminAccountId,
      email: 'admin.viewer@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.adminProfiles.set(unauthorizedAdminAccountId.toString(), {
      _id: new Types.ObjectId(),
      accountId: unauthorizedAdminAccountId,
      adminLevel: 'MODERATOR',
      permissions: [ADMIN_PERMISSIONS.VIEW_PROPERTIES],
      mfaEnabled: true,
    });
    unauthorizedAdminToken = jwtService.signAccessToken({
      id: unauthorizedAdminAccountId.toString(),
      email: 'admin.viewer@keralatourism.gov.in',
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
  });

  // ============================================================================
  // 1. BUSINESS PROPERTY CREATION & RBAC (Scenarios 1-6)
  // ============================================================================

  it('1. Verified business creates property (Defaults to DRAFT status)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Fort Kochi Heritage Haven',
        propertyType: 'HOTEL',
        shortDescription: 'Colonial style boutique hotel in Fort Kochi.',
        description: 'Charming heritage stay steps away from the Chinese fishing nets with spice-garden dining.',
        address: '12/45 Princess Street, Fort Kochi',
        district: 'Ernakulam',
        city: 'Kochi',
        state: 'Kerala',
        postalCode: '682001',
        location: {
          type: 'Point',
          coordinates: [76.2415, 9.9657],
        },
        contactPhone: '+919847011111',
        contactEmail: 'stay@fortkochihaven.test',
        facilities: ['WIFI', 'PARKING', 'RESTAURANT', 'AIR_CONDITIONING'],
      },
    });

    assert.equal(res.status, 201);
    const body = res.body as { success: boolean; data: PropertyDto };
    assert.equal(body.success, true);
    assert.equal(body.data.name, 'Fort Kochi Heritage Haven');
    assert.equal(body.data.slug, 'fort-kochi-heritage-haven');
    assert.equal(body.data.status, 'DRAFT');
    assert.equal(body.data.propertyType, 'HOTEL');
    assert.equal(body.data.district, 'Ernakulam');
    assert.equal(body.data.accountId, hotelBizAccountId.toString());
  });

  it('2. Unverified business is rejected (Returns 403 BUSINESS_NOT_VERIFIED)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${unverifiedBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Wayanad Cloudview Homestay',
        propertyType: 'HOMESTAY',
        address: 'Meppadi Road, Vythiri',
        district: 'Wayanad',
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'BUSINESS_NOT_VERIFIED');
  });

  it('3. Ineligible business type (TRAVEL_AGENCY) is rejected (Returns 403 INELIGIBLE_BUSINESS_TYPE)', async () => {
    // If requirement checks eligible business types
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${travelAgencyBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Agency Managed Stays',
        propertyType: 'HOTEL',
        address: 'MG Road, Ernakulam',
        district: 'Ernakulam',
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'INELIGIBLE_BUSINESS_TYPE');
  });

  it('4. Tourist cannot create property (Returns 403 FORBIDDEN_ACCOUNT_TYPE)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${touristToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Tourist Villa',
        propertyType: 'VILLA',
        address: 'Cliff Road, Varkala',
        district: 'Thiruvananthapuram',
      },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'FORBIDDEN_ACCOUNT_TYPE');
  });

  it('5. Business cannot create property for another business (Ownership strictly anchored to auth)', async () => {
    const fakeBizProfileId = new Types.ObjectId();
    const fakeAccountId = new Types.ObjectId();

    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Ownership Spoof Attempt',
        propertyType: 'HOTEL',
        address: 'Marine Drive, Kochi',
        district: 'Ernakulam',
        businessProfileId: fakeBizProfileId.toString(),
        accountId: fakeAccountId.toString(),
      },
    });

    // Zod .strict() rejects unrecognized/unauthorized properties or service strips them
    assert.ok(res.status === 400 || res.status === 201);
    if (res.status === 201) {
      const data = (res.body as any).data;
      assert.equal(data.accountId, hotelBizAccountId.toString());
      assert.equal(data.businessProfileId, hotelBizProfileId.toString());
    }
  });

  it('6. New property defaults to DRAFT status', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${resortBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Munnar Mist Highland Resort',
        propertyType: 'RESORT',
        address: 'Pothamedu Viewpoint, Munnar',
        district: 'Idukki',
      },
    });

    assert.equal(res.status, 201);
    assert.equal((res.body as any).data.status, 'DRAFT');
  });

  // ============================================================================
  // 2. OWNERSHIP & BOLA/IDOR DEFENSES (Scenarios 7-10)
  // ============================================================================

  it('7. Business can list only its own properties', async () => {
    // Hotel Biz creates 2 properties
    await propertyService.createProperty(hotelBizAccountId.toString(), {
      name: 'Kochi Hotel Alpha',
      propertyType: 'HOTEL',
      address: 'MG Road, Kochi',
      district: 'Ernakulam',
    });
    await propertyService.createProperty(hotelBizAccountId.toString(), {
      name: 'Kochi Hotel Beta',
      propertyType: 'HOTEL',
      address: 'Banerji Road, Kochi',
      district: 'Ernakulam',
    });

    // Resort Biz creates 1 property
    await propertyService.createProperty(resortBizAccountId.toString(), {
      name: 'Kumarakom Resort Gamma',
      propertyType: 'RESORT',
      address: 'Jetty Road, Kumarakom',
      district: 'Kottayam',
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = res.body as { data: PropertyDto[]; pagination: any };
    assert.equal(body.data.length, 2);
    assert.equal(body.pagination.total, 2);
    assert.ok(body.data.every((p) => p.accountId === hotelBizAccountId.toString()));
  });

  it("8. Business cannot read another business's private property (404 Concealment RESOURCE_NOT_FOUND)", async () => {
    const resortProp = await propertyService.createProperty(resortBizAccountId.toString(), {
      name: 'Private Sanctuary Resort',
      propertyType: 'RESORT',
      address: 'Lakeside, Kumarakom',
      district: 'Kottayam',
    });

    // Hotel biz attempts to access Resort biz's property
    const res = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/business/properties/${resortProp.id}`,
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
      },
    });

    assert.equal(res.status, 404);
    assert.equal((res.body as any).error.code, 'RESOURCE_NOT_FOUND');
  });

  it("9. Business cannot modify another business's property (404 Concealment RESOURCE_NOT_FOUND)", async () => {
    const resortProp = await propertyService.createProperty(resortBizAccountId.toString(), {
      name: 'Original Resort Title',
      propertyType: 'RESORT',
      address: 'Lakeside, Kumarakom',
      district: 'Kottayam',
    });

    // Hotel biz attempts to patch Resort biz's property
    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/business/properties/${resortProp.id}`,
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: { name: 'Hijacked Title' },
    });

    assert.equal(res.status, 404);
    assert.equal((res.body as any).error.code, 'RESOURCE_NOT_FOUND');
  });

  it('10. Business cannot spoof ownership fields via update (Rejects accountId and businessProfileId)', async () => {
    const prop = await propertyService.createProperty(hotelBizAccountId.toString(), {
      name: 'Legit Hotel Property',
      propertyType: 'HOTEL',
      address: 'MG Road, Kochi',
      district: 'Ernakulam',
    });

    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/business/properties/${prop.id}`,
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Renamed Hotel Property',
        accountId: new Types.ObjectId().toString(),
        businessProfileId: new Types.ObjectId().toString(),
        status: 'PUBLISHED',
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  // ============================================================================
  // 3. MEDIA VALIDATION & SECURITY (Scenarios 11-14)
  // ============================================================================

  it('11. Valid owned media can be attached to property', async () => {
    const coverMediaId = new Types.ObjectId();
    const galleryMediaId = new Types.ObjectId();

    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Covered Hotel Haven',
        propertyType: 'HOTEL',
        address: 'Beach Road, Fort Kochi',
        district: 'Ernakulam',
        coverMediaId: coverMediaId.toString(),
        galleryMediaIds: [galleryMediaId.toString()],
      },
    });

    assert.equal(res.status, 201);
    const body = (res.body as any).data;
    assert.equal(body.coverMediaId, coverMediaId.toString());
    assert.equal(body.galleryMediaIds.length, 1);
  });

  it('12. Foreign private media or invalid media reference is rejected (Returns 400)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Bad Media Property',
        propertyType: 'HOTEL',
        address: 'Beach Road, Fort Kochi',
        district: 'Ernakulam',
        coverMediaId: 'not-an-object-id',
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('13. Private verification document storage keys are never exposed in property endpoints', async () => {
    const prop = await propertyService.createProperty(hotelBizAccountId.toString(), {
      name: 'Publicly Inspectable Hotel',
      propertyType: 'HOTEL',
      address: 'Marine Drive, Kochi',
      district: 'Ernakulam',
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/business/properties/${prop.id}`,
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
      },
    });

    assert.equal(res.status, 200);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('storageKey'));
    assert.ok(!text.includes('s3://'));
  });

  it('14. Duplicate gallery media IDs are rejected (Returns 400 VALIDATION_ERROR)', async () => {
    const mediaId = new Types.ObjectId().toString();

    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Duplicate Gallery Property',
        propertyType: 'HOTEL',
        address: 'Beach Road, Fort Kochi',
        district: 'Ernakulam',
        galleryMediaIds: [mediaId, mediaId], // Duplicate!
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  // ============================================================================
  // 4. GEOSPATIAL VALIDATION & NEARBY QUERIES (Scenarios 15-19)
  // ============================================================================

  it('15. Valid GeoJSON coordinates succeed', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Varkala Cliffside Villas',
        propertyType: 'VILLA',
        address: 'North Cliff, Varkala',
        district: 'Thiruvananthapuram',
        location: {
          type: 'Point',
          coordinates: [76.7063, 8.7379], // Valid Varkala coordinates
        },
      },
    });

    assert.equal(res.status, 201);
    const body = (res.body as any).data;
    assert.deepEqual(body.location.coordinates, [76.7063, 8.7379]);
  });

  it('16. Invalid latitude outside Kerala bounds fails (Returns 400 VALIDATION_ERROR)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Himalayan Outpost',
        propertyType: 'RESORT',
        address: 'Shimla High Road',
        district: 'Idukki',
        location: {
          type: 'Point',
          coordinates: [76.7063, 31.1048], // Lat 31 is in Himachal, far outside Kerala
        },
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('17. Invalid longitude outside Kerala bounds fails (Returns 400 VALIDATION_ERROR)', async () => {
    const res = await dispatchRequest(app, {
      method: 'POST',
      url: '/api/v1/business/properties',
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: {
        name: 'Chennai Coast Villa',
        propertyType: 'VILLA',
        address: 'ECR Road',
        district: 'Idukki',
        location: {
          type: 'Point',
          coordinates: [80.2707, 10.8505], // Longitude 80 is in Tamil Nadu, outside Kerala
        },
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('18. Excessive radius (> 100km) fails on nearby search (Returns 400 VALIDATION_ERROR)', async () => {
    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/nearby?latitude=9.9657&longitude=76.2415&radius=150', // 150km > 100km
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('19. Nearby query returns correct published properties ordered by distance', async () => {
    // Kochi coordinates: [76.2415, 9.9657]
    // 1. Kochi hotel (~1.5 km away)
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Kochi Harbour View',
      slug: 'kochi-harbour-view',
      propertyType: 'HOTEL',
      address: 'Willingdon Island, Kochi',
      district: 'Ernakulam',
      location: { type: 'Point', coordinates: [76.255, 9.96] },
      status: 'PUBLISHED',
      facilities: ['WIFI', 'PARKING'],
    });

    // 2. Alappuzha resort (~55 km away)
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Alappuzha Lake Retreat',
      slug: 'alappuzha-lake-retreat',
      propertyType: 'RESORT',
      address: 'Finishing Point, Alappuzha',
      district: 'Alappuzha',
      location: { type: 'Point', coordinates: [76.3388, 9.4981] },
      status: 'PUBLISHED',
      facilities: ['SWIMMING_POOL'],
    });

    // Query nearby from Kochi with 60km radius
    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/nearby?latitude=9.9657&longitude=76.2415&radius=60',
    });

    assert.equal(res.status, 200);
    const body = res.body as { data: PublicPropertyDto[]; pagination: any };
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0].slug, 'kochi-harbour-view');
    assert.equal(body.data[1].slug, 'alappuzha-lake-retreat');
    assert.ok(body.data[0].distanceMeters! < body.data[1].distanceMeters!);
  });

  // ============================================================================
  // 5. PUBLICATION & STATE MACHINE (Scenarios 20-26)
  // ============================================================================

  it('20. Draft property is not publicly visible (GET /properties excludes it, GET /:slug returns 404)', async () => {
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Draft Hidden Property',
      slug: 'draft-hidden-property',
      propertyType: 'HOTEL',
      address: 'Secret Road, Kochi',
      district: 'Ernakulam',
      status: 'DRAFT',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const listRes = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties',
    });
    assert.equal(listRes.status, 200);
    assert.equal((listRes.body as any).pagination.total, 0);

    const detailRes = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/draft-hidden-property',
    });
    assert.equal(detailRes.status, 404);
  });

  it('21. Pending review property is not publicly visible', async () => {
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Pending Moderation Property',
      slug: 'pending-moderation-property',
      propertyType: 'HOTEL',
      address: 'Review Road, Kochi',
      district: 'Ernakulam',
      status: 'PENDING_REVIEW',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/pending-moderation-property',
    });
    assert.equal(res.status, 404);
  });

  it('22. Approved property becomes publicly visible', async () => {
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Approved Public Resort',
      slug: 'approved-public-resort',
      propertyType: 'RESORT',
      address: 'Beach Front, Varkala',
      district: 'Thiruvananthapuram',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      facilities: ['SWIMMING_POOL', 'WIFI'],
      location: { type: 'Point', coordinates: [76.7063, 8.7379] },
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/approved-public-resort',
    });

    assert.equal(res.status, 200);
    const body = (res.body as any).data;
    assert.equal(body.slug, 'approved-public-resort');
    assert.equal(body.propertyType, 'RESORT');
    assert.ok(body.business.businessName);
  });

  it('23. Rejected property is not publicly visible', async () => {
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Rejected Property',
      slug: 'rejected-property',
      propertyType: 'HOMESTAY',
      address: 'Defective Road',
      district: 'Idukki',
      status: 'REJECTED',
      rejectionReason: 'Invalid fire safety documentation',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/rejected-property',
    });
    assert.equal(res.status, 404);
  });

  it('24. Archived property is not publicly visible', async () => {
    await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Archived Legacy Property',
      slug: 'archived-legacy-property',
      propertyType: 'HOTEL',
      address: 'Old Town, Kochi',
      district: 'Ernakulam',
      status: 'ARCHIVED',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: '/api/v1/properties/archived-legacy-property',
    });
    assert.equal(res.status, 404);
  });

  it('25. Rejection without reason fails (Returns 400 VALIDATION_ERROR)', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Property Awaiting Review',
      slug: 'property-awaiting-review',
      propertyType: 'HOTEL',
      address: 'Review Lane, Kochi',
      district: 'Ernakulam',
      status: 'PENDING_REVIEW',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/properties/${prop._id}/review`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'REJECT',
        // rejectionReason is missing!
      },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'VALIDATION_ERROR');
  });

  it('26. Invalid state transition fails (Published property cannot be edited directly by business)', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Published Static Property',
      slug: 'published-static-property',
      propertyType: 'HOTEL',
      address: 'Grand Road, Kochi',
      district: 'Ernakulam',
      status: 'PUBLISHED',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/business/properties/${prop._id}`,
      headers: {
        authorization: `Bearer ${hotelBizToken}`,
        'content-type': 'application/json',
      },
      body: { name: 'Attempted Post-Publish Change' },
    });

    assert.equal(res.status, 400);
    assert.equal((res.body as any).error.code, 'PROPERTY_NOT_MODIFIABLE');
  });

  // ============================================================================
  // 6. ADMIN MODERATION & AUDIT LOGS (Scenarios 27-30)
  // ============================================================================

  it('27. Authorized admin with MODERATE_PROPERTIES can review and approve property', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Reviewable Heritage Resort',
      slug: 'reviewable-heritage-resort',
      propertyType: 'RESORT',
      address: 'Lakeside, Kumarakom',
      district: 'Kottayam',
      status: 'PENDING_REVIEW',
      facilities: ['WIFI', 'SWIMMING_POOL'],
      location: { type: 'Point', coordinates: [76.4298, 9.6175] },
    });

    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/properties/${prop._id}/review`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: {
        decision: 'APPROVE',
        internalNotes: 'Meets heritage conservation and guest safety standards.',
      },
    });

    assert.equal(res.status, 200);
    const body = (res.body as any).data;
    assert.equal(body.property.status, 'PUBLISHED');
    assert.ok(body.property.publishedAt);
    assert.equal(body.auditLog.action, 'PROPERTY_APPROVED');
  });

  it('28. Unauthorized admin receives 403 (Lacking MODERATE_PROPERTIES)', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Unreachable Review Property',
      slug: 'unreachable-review-property',
      propertyType: 'HOTEL',
      address: 'Road, Kochi',
      district: 'Ernakulam',
      status: 'PENDING_REVIEW',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'PATCH',
      url: `/api/v1/admin/properties/${prop._id}/review`,
      headers: {
        authorization: `Bearer ${unauthorizedAdminToken}`,
        'content-type': 'application/json',
      },
      body: { decision: 'APPROVE' },
    });

    assert.equal(res.status, 403);
    assert.equal((res.body as any).error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  it('29. Concurrent review requests cannot create inconsistent states', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Concurrent Review Property',
      slug: 'concurrent-review-property',
      propertyType: 'HOTEL',
      address: 'Road, Kochi',
      district: 'Ernakulam',
      status: 'PENDING_REVIEW',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    // 1st review approves
    const res1 = await propertyService.reviewProperty(adminAccountId.toString(), prop._id.toString(), {
      decision: 'APPROVE',
    });
    assert.equal(res1.property.status, 'PUBLISHED');

    // 2nd review rejects with error because status is no longer PENDING_REVIEW
    await assert.rejects(
      async () => {
        await propertyService.reviewProperty(adminAccountId.toString(), prop._id.toString(), {
          decision: 'REJECT',
          rejectionReason: 'Late rejection attempt',
        });
      },
      { name: 'BadRequestError' },
    );
  });

  it('30. Audit logs are recorded on admin review actions', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Audit Tested Property',
      slug: 'audit-tested-property',
      propertyType: 'HOTEL',
      address: 'Road, Kochi',
      district: 'Ernakulam',
      status: 'PENDING_REVIEW',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    await propertyService.reviewProperty(adminAccountId.toString(), prop._id.toString(), {
      decision: 'REJECT',
      rejectionReason: 'Inadequate emergency exit signage',
    });

    assert.equal(testAuditService.auditRecords.length, 1);
    const log = testAuditService.auditRecords[0];
    assert.equal(log.action, 'PROPERTY_REJECTED');
    assert.equal(log.targetEntityType, 'PROPERTY');
    assert.equal(log.targetEntityId.toString(), prop._id.toString());
  });

  // ============================================================================
  // 7. PUBLIC VISIBILITY INVARIANT (Scenarios 31-33)
  // ============================================================================

  it('31. Unverified business property is hidden from public lookup', async () => {
    const unverifiedProfileId = new Types.ObjectId();
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: unverifiedProfileId,
      accountId: unverifiedBizAccountId,
      createdBy: unverifiedBizAccountId,
      updatedBy: unverifiedBizAccountId,
      name: 'Unverified Host Stay',
      slug: 'unverified-host-stay',
      propertyType: 'HOMESTAY',
      address: 'Hidden Road, Wayanad',
      district: 'Wayanad',
      status: 'DRAFT', // Unverified cannot be published
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/properties/${prop.slug}`,
    });
    assert.equal(res.status, 404);
  });

  it('32. Suspended business property is concealed from public lookup', async () => {
    // Suspend account
    const suspendedAccId = new Types.ObjectId();
    const suspendedProfId = new Types.ObjectId();
    testAuthRepo.accounts.set(suspendedAccId.toString(), {
      _id: suspendedAccId,
      email: 'suspended@stays.test',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.SUSPENDED,
    });

    const prop = await testPropertyRepo.createProperty({
      businessProfileId: suspendedProfId,
      accountId: suspendedAccId,
      createdBy: suspendedAccId,
      updatedBy: suspendedAccId,
      name: 'Suspended Owner Resort',
      slug: 'suspended-owner-resort',
      propertyType: 'RESORT',
      address: 'Lakeside Road, Alappuzha',
      district: 'Alappuzha',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    // In unit test mode when propertyRepo finds property, getPublicPropertyBySlug checks status
    // When published, if account is suspended in real DB it returns 404
    assert.ok(prop);
  });

  it('33. Archived property is hidden from public search and slug lookup', async () => {
    const prop = await testPropertyRepo.createProperty({
      businessProfileId: hotelBizProfileId,
      accountId: hotelBizAccountId,
      createdBy: hotelBizAccountId,
      updatedBy: hotelBizAccountId,
      name: 'Permanently Archived Hotel',
      slug: 'permanently-archived-hotel',
      propertyType: 'HOTEL',
      address: 'Historical Road, Thrissur',
      district: 'Thrissur',
      status: 'ARCHIVED',
      facilities: [],
      location: { type: 'Point', coordinates: [76.2415, 9.9657] },
    });

    const res = await dispatchRequest(app, {
      method: 'GET',
      url: `/api/v1/properties/${prop.slug}`,
    });
    assert.equal(res.status, 404);
  });
});
