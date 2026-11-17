import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  BUSINESS_TYPES,
  PROPERTY_STATUSES,
  ROOM_CATEGORIES,
  ROOM_FACILITIES,
  ROOM_PRICING_UNITS,
  ROOM_STATUSES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type {
  PropertyAvailabilityResponseDto,
  PublicRoomTypeDto,
  RoomTypeDto,
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
import { PropertyRepository, propertyRepository } from '../modules/properties/property.repository';
import { RoomRepository } from '../modules/rooms/room.repository';
import { roomService } from '../modules/rooms/room.service';
import {
  IAccountDocument,
  IBusinessProfileDocument,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { dispatchRequest } from './testUtils';

// --- Test Doubles & In-Memory Stores ---

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

class TestAuthRepository extends AuthRepository {
  public accounts: Map<string, StoredAccount> = new Map();
  public businessProfiles: Map<string, StoredBusinessProfile> = new Map();

  public override async findAccountById(id: string | Types.ObjectId): Promise<IAccountDocument | null> {
    const acc = this.accounts.get(id.toString());
    if (!acc) return null;
    return acc as unknown as IAccountDocument;
  }

  public override async findBusinessProfile(accountId: string | Types.ObjectId): Promise<IBusinessProfileDocument | null> {
    const profile = this.businessProfiles.get(accountId.toString());
    if (!profile) return null;
    return profile as unknown as IBusinessProfileDocument;
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

describe('Day 22: Room Types, Inventory & Availability Management Unit Test Suite', () => {
  const app = createApp();

  let testAuthRepo: TestAuthRepository;
  let testRoomRepo: RoomRepository;
  let testPropertyRepo: PropertyRepository;
  let testAuditService: TestAuditService;

  // Test identities
  const verifiedHotelUserId = new Types.ObjectId();
  const verifiedHotelBizId = new Types.ObjectId();

  const otherHotelUserId = new Types.ObjectId();
  const otherHotelBizId = new Types.ObjectId();

  const unverifiedHotelUserId = new Types.ObjectId();
  const unverifiedHotelBizId = new Types.ObjectId();

  const tourAgencyUserId = new Types.ObjectId();
  const tourAgencyBizId = new Types.ObjectId();

  const touristUserId = new Types.ObjectId();
  const suspendedUserId = new Types.ObjectId();

  let verifiedHotelToken: string;
  let otherHotelToken: string;
  let unverifiedHotelToken: string;
  let tourAgencyToken: string;
  let touristToken: string;
  let suspendedToken: string;

  // Test properties
  let publishedPropId: Types.ObjectId;
  let draftPropId: Types.ObjectId;
  let archivedPropId: Types.ObjectId;
  let otherBusinessPropId: Types.ObjectId;

  beforeEach(async () => {
    resetRateLimiter();

    testAuthRepo = new TestAuthRepository();
    testRoomRepo = new RoomRepository();
    testPropertyRepo = propertyRepository;
    testPropertyRepo.inMemoryStore.clear();
    testAuditService = new TestAuditService();

    // Wire dependencies
    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);
    (authorizationController as any).repo = testAuthRepo;

    roomService.setRepository(testRoomRepo);
    roomService.setAuditService(testAuditService);

    // 1. Verified Hotel Host
    testAuthRepo.accounts.set(verifiedHotelUserId.toString(), {
      _id: verifiedHotelUserId,
      email: 'host@kumarakomresort.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(verifiedHotelUserId.toString(), {
      _id: verifiedHotelBizId,
      accountId: verifiedHotelUserId,
      businessName: 'Kumarakom Heritage Resort',
      businessType: BUSINESS_TYPES.HOTEL,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });

    // 2. Competitor Hotel Host
    testAuthRepo.accounts.set(otherHotelUserId.toString(), {
      _id: otherHotelUserId,
      email: 'host@alappuzhavilla.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(otherHotelUserId.toString(), {
      _id: otherHotelBizId,
      accountId: otherHotelUserId,
      businessName: 'Alappuzha Lake Villa',
      businessType: BUSINESS_TYPES.RESORT,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });

    // 3. Unverified Hotel Host
    testAuthRepo.accounts.set(unverifiedHotelUserId.toString(), {
      _id: unverifiedHotelUserId,
      email: 'host@pendinghotel.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(unverifiedHotelUserId.toString(), {
      _id: unverifiedHotelBizId,
      accountId: unverifiedHotelUserId,
      businessName: 'Pending Verif Hotel',
      businessType: BUSINESS_TYPES.HOTEL,
      verificationStatus: VERIFICATION_STATUSES.PENDING,
    });

    // 4. Tour Agency (Ineligible for property rooms)
    testAuthRepo.accounts.set(tourAgencyUserId.toString(), {
      _id: tourAgencyUserId,
      email: 'agency@keralatours.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.businessProfiles.set(tourAgencyUserId.toString(), {
      _id: tourAgencyBizId,
      accountId: tourAgencyUserId,
      businessName: 'Kerala Travel Lines',
      businessType: BUSINESS_TYPES.TRAVEL_AGENCY,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });

    // 5. Tourist User
    testAuthRepo.accounts.set(touristUserId.toString(), {
      _id: touristUserId,
      email: 'tourist@gmail.com',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // 6. Suspended Account
    testAuthRepo.accounts.set(suspendedUserId.toString(), {
      _id: suspendedUserId,
      email: 'suspended@hotel.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.SUSPENDED,
    });

    // Issue JWTs
    verifiedHotelToken = jwtService.signAccessToken({
      id: verifiedHotelUserId.toString(),
      email: 'host@kumarakomresort.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    otherHotelToken = jwtService.signAccessToken({
      id: otherHotelUserId.toString(),
      email: 'host@alappuzhavilla.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    unverifiedHotelToken = jwtService.signAccessToken({
      id: unverifiedHotelUserId.toString(),
      email: 'host@pendinghotel.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    tourAgencyToken = jwtService.signAccessToken({
      id: tourAgencyUserId.toString(),
      email: 'agency@keralatours.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    touristToken = jwtService.signAccessToken({
      id: touristUserId.toString(),
      email: 'tourist@gmail.com',
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    suspendedToken = jwtService.signAccessToken({
      id: suspendedUserId.toString(),
      email: 'suspended@hotel.com',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.SUSPENDED,
    });

    // Seed properties in testPropertyRepo
    publishedPropId = new Types.ObjectId();
    testPropertyRepo.inMemoryStore.set(publishedPropId.toString(), {
      _id: publishedPropId,
      businessProfileId: verifiedHotelBizId,
      accountId: verifiedHotelUserId,
      createdBy: verifiedHotelUserId,
      updatedBy: verifiedHotelUserId,
      name: 'Kumarakom Heritage Lake Resort',
      slug: 'kumarakom-heritage-lake-resort',
      propertyType: 'RESORT',
      shortDescription: 'Peaceful lake resort',
      description: 'Lakeside paradise',
      address: 'Vembanad Lake Shore, Kumarakom',
      district: 'Kottayam',
      city: 'Kumarakom',
      state: 'Kerala',
      postalCode: '686563',
      location: { type: 'Point', coordinates: [76.43, 9.6] },
      contactPhone: '+919847000001',
      contactEmail: 'info@kumarakomresort.com',
      website: null,
      facilities: ['SWIMMING_POOL', 'WIFI'],
      coverMediaId: null,
      galleryMediaIds: [],
      status: PROPERTY_STATUSES.PUBLISHED,
      supportsHourly: false,
      supportsDaily: true,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    draftPropId = new Types.ObjectId();
    testPropertyRepo.inMemoryStore.set(draftPropId.toString(), {
      _id: draftPropId,
      businessProfileId: verifiedHotelBizId,
      accountId: verifiedHotelUserId,
      createdBy: verifiedHotelUserId,
      updatedBy: verifiedHotelUserId,
      name: 'Kumarakom Lake Cottages (Draft)',
      slug: 'kumarakom-lake-cottages-draft',
      propertyType: 'RESORT',
      shortDescription: 'Draft cottages',
      description: 'Draft cottages description',
      address: 'Lake road',
      district: 'Kottayam',
      city: 'Kumarakom',
      state: 'Kerala',
      postalCode: '686563',
      location: { type: 'Point', coordinates: [76.43, 9.6] },
      contactPhone: null,
      contactEmail: null,
      website: null,
      facilities: [],
      coverMediaId: null,
      galleryMediaIds: [],
      status: PROPERTY_STATUSES.DRAFT,
      supportsHourly: false,
      supportsDaily: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    archivedPropId = new Types.ObjectId();
    testPropertyRepo.inMemoryStore.set(archivedPropId.toString(), {
      _id: archivedPropId,
      businessProfileId: verifiedHotelBizId,
      accountId: verifiedHotelUserId,
      createdBy: verifiedHotelUserId,
      updatedBy: verifiedHotelUserId,
      name: 'Old Archived Homestay',
      slug: 'old-archived-homestay',
      propertyType: 'HOMESTAY',
      shortDescription: 'Old homestay',
      description: 'Old homestay description',
      address: 'Old road',
      district: 'Kottayam',
      city: 'Kumarakom',
      state: 'Kerala',
      postalCode: '686563',
      location: { type: 'Point', coordinates: [76.43, 9.6] },
      contactPhone: null,
      contactEmail: null,
      website: null,
      facilities: [],
      coverMediaId: null,
      galleryMediaIds: [],
      status: PROPERTY_STATUSES.ARCHIVED,
      supportsHourly: false,
      supportsDaily: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    otherBusinessPropId = new Types.ObjectId();
    testPropertyRepo.inMemoryStore.set(otherBusinessPropId.toString(), {
      _id: otherBusinessPropId,
      businessProfileId: otherHotelBizId,
      accountId: otherHotelUserId,
      createdBy: otherHotelUserId,
      updatedBy: otherHotelUserId,
      name: 'Alappuzha Backwater Villa',
      slug: 'alappuzha-backwater-villa',
      propertyType: 'VILLA',
      shortDescription: 'Villa description',
      description: 'Villa description',
      address: 'Finishing Point, Alappuzha',
      district: 'Alappuzha',
      city: 'Alappuzha',
      state: 'Kerala',
      postalCode: '688013',
      location: { type: 'Point', coordinates: [76.33, 9.49] },
      contactPhone: null,
      contactEmail: null,
      website: null,
      facilities: [],
      coverMediaId: null,
      galleryMediaIds: [],
      status: PROPERTY_STATUSES.PUBLISHED,
      supportsHourly: false,
      supportsDaily: true,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // ============================================================================
  // 1. BUSINESS: ROOM TYPE CREATION
  // ============================================================================

  describe('1. Business Room Type Creation (POST /business/properties/:propertyId/rooms)', () => {
    it('1.1 should create a new room type with valid data (201 Created)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Deluxe Sea View Suite',
          description: 'Spacious lakefront suite with private balcony',
          roomCategory: ROOM_CATEGORIES.SUITE,
          maxAdults: 2,
          maxChildren: 2,
          maxOccupancy: 3,
          bedConfiguration: '1 King Bed + 1 Sofa Bed',
          bedCount: 2,
          roomSize: 450,
          roomSizeUnit: 'SQ_FT',
          facilities: [ROOM_FACILITIES.WIFI, ROOM_FACILITIES.AIR_CONDITIONING, ROOM_FACILITIES.BALCONY],
          basePrice: 550000, // 5500.00 INR in paise
          currency: 'INR',
          pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT,
          totalUnits: 8,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.name, 'Deluxe Sea View Suite');
      assert.equal(res.body.data.slug, 'deluxe-sea-view-suite');
      assert.equal(res.body.data.basePrice, 550000);
      assert.equal(res.body.data.basePriceInr, 5500);
      assert.equal(res.body.data.totalUnits, 8);
      assert.equal(res.body.data.status, ROOM_STATUSES.ACTIVE);
    });

    it('1.2 should automatically append numerical suffix when duplicate slug occurs in same property', async () => {
      // First room type
      await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Deluxe Suite',
          roomCategory: ROOM_CATEGORIES.SUITE,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 King Bed',
          bedCount: 1,
          basePrice: 500000,
          totalUnits: 5,
        },
      });

      // Second room type with same name
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Deluxe Suite',
          roomCategory: ROOM_CATEGORIES.SUITE,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 King Bed',
          bedCount: 1,
          basePrice: 550000,
          totalUnits: 5,
        },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.slug, 'deluxe-suite-2');
    });

    it('1.3 should reject creation if maxOccupancy is less than maxAdults (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Invalid Capacity Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 3,
          maxOccupancy: 2, // Violates maxOccupancy >= maxAdults
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 300000,
          totalUnits: 5,
        },
      });

      assert.equal(res.status, 400);
    });

    it('1.4 should reject creation if price is below minimum threshold (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Too Cheap Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 500, // Below min 10000 paise (100 INR)
          totalUnits: 5,
        },
      });

      assert.equal(res.status, 400);
    });

    it('1.5 should reject creation on an archived property (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${archivedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Standard Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 400);
    });

    it('1.6 should conceal property of another business with 404 (BOLA Protection)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${otherBusinessPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Infiltrator Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 404);
    });

    it('1.7 should reject non-business account (403 Forbidden)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${touristToken}` },
        body: {
          name: 'Tourist Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 403);
    });

    it('1.8 should reject unverified business account (403 Forbidden)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${unverifiedHotelToken}` },
        body: {
          name: 'Unverified Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 403);
    });

    it('1.9 should reject unauthenticated request (401 Unauthorized)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        body: {
          name: 'Anon Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 401);
    });

    it('1.10 should reject ineligible business type like tour agency (403 Forbidden)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${tourAgencyToken}` },
        body: {
          name: 'Tour Agency Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 403);
    });

    it('1.11 should reject suspended account (403 Forbidden)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${suspendedToken}` },
        body: {
          name: 'Suspended Account Room',
          roomCategory: ROOM_CATEGORIES.STANDARD,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 Queen Bed',
          bedCount: 1,
          basePrice: 200000,
          totalUnits: 3,
        },
      });

      assert.equal(res.status, 403);
    });
  });

  // ============================================================================
  // 2. BUSINESS: ROOM TYPE READ & MUTATION
  // ============================================================================

  describe('2. Business Room Type Read & Mutation', () => {
    let createdRoomId: string;

    beforeEach(async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Premium Lakeview Villa',
          roomCategory: ROOM_CATEGORIES.VILLA,
          maxAdults: 4,
          maxOccupancy: 4,
          bedConfiguration: '2 King Beds',
          bedCount: 2,
          basePrice: 1200000, // 12,000 INR
          totalUnits: 4,
        },
      });
      createdRoomId = res.body.data.id;
    });

    it('2.1 should list room types for owner property (GET /business/properties/:propertyId/rooms)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto[]; total: number }>(app, {
        method: 'GET',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.total, 1);
      assert.equal(res.body.data[0].name, 'Premium Lakeview Villa');
    });

    it('2.2 should retrieve single room type details (GET /business/rooms/:roomTypeId)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, createdRoomId);
      assert.equal(res.body.data.basePriceInr, 12000);
    });

    it('2.3 should update room type attributes (PATCH /business/rooms/:roomTypeId)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'PATCH',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Executive Lakeview Villa',
          basePrice: 1500000, // 15,000 INR
          totalUnits: 6,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, 'Executive Lakeview Villa');
      assert.equal(res.body.data.slug, 'executive-lakeview-villa');
      assert.equal(res.body.data.basePrice, 1500000);
      assert.equal(res.body.data.basePriceInr, 15000);
      assert.equal(res.body.data.totalUnits, 6);
    });

    it('2.4 should soft-delete room type (DELETE /business/rooms/:roomTypeId)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: { message: string } }>(app, {
        method: 'DELETE',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      assert.equal(res.status, 200);

      // Verify it's archived
      const getRes = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });
      assert.equal(getRes.status, 400); // ROOM_ARCHIVED
    });

    it('2.5 should conceal another business room type with 404 (BOLA Protection)', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${otherHotelToken}` },
      });

      assert.equal(res.status, 404);
    });

    it('2.6 should prevent updating an archived room type (400 Bad Request)', async () => {
      // Archive first
      await dispatchRequest(app, {
        method: 'DELETE',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      // Attempt to patch
      const res = await dispatchRequest(app, {
        method: 'PATCH',
        url: `/api/v1/business/rooms/${createdRoomId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: { name: 'Resurrected Room' },
      });

      assert.equal(res.status, 400);
    });
  });

  // ============================================================================
  // 3. BUSINESS: INVENTORY MANAGEMENT
  // ============================================================================

  describe('3. Business Inventory Configuration & Adjustments', () => {
    let roomId: string;

    beforeEach(async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Heritage Lake Cottage',
          roomCategory: ROOM_CATEGORIES.COTTAGE,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 King Bed',
          bedCount: 1,
          basePrice: 400000,
          totalUnits: 10,
        },
      });
      roomId = res.body.data.id;
    });

    it('3.1 should bulk configure inventory range (PUT /business/rooms/:roomTypeId/inventory)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: { configuredDatesCount: number } }>(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${roomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-10',
          totalUnits: 10,
          blockedUnits: 1,
          maintenanceUnits: 1,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.configuredDatesCount, 10);

      // Verify inventory query
      const getRes = await dispatchRequest<{ success: boolean; data: any[]; total: number }>(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${roomId}/inventory?startDate=2026-12-01&endDate=2026-12-10`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.total, 10);
      assert.equal(getRes.body.data[0].totalUnits, 10);
      assert.equal(getRes.body.data[0].availableUnits, 8);
      assert.equal(getRes.body.data[0].blockedUnits, 1);
      assert.equal(getRes.body.data[0].maintenanceUnits, 1);
    });

    it('3.2 should reject inventory if totalUnits < blocked + maintenance (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${roomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-05',
          totalUnits: 5,
          blockedUnits: 3,
          maintenanceUnits: 3, // 3 + 3 = 6 > 5
        },
      });

      assert.equal(res.status, 400);
    });

    it('3.3 should reject inventory range exceeding 180 days (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${roomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-01-01',
          endDate: '2026-08-01', // > 210 days
          totalUnits: 10,
        },
      });

      assert.equal(res.status, 400);
    });

    it('3.4 should reject inverted date range where startDate > endDate (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${roomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-10',
          endDate: '2026-12-01',
          totalUnits: 10,
        },
      });

      assert.equal(res.status, 400);
    });

    it('3.5 should update a single inventory item (PATCH /business/rooms/:roomTypeId/inventory/:invId)', async () => {
      // Seed 1 day
      await dispatchRequest(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${roomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-01',
          totalUnits: 10,
          blockedUnits: 0,
          maintenanceUnits: 0,
        },
      });

      const getRes = await dispatchRequest<{ success: boolean; data: any[] }>(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${roomId}/inventory?startDate=2026-12-01&endDate=2026-12-01`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      const invId = getRes.body.data[0].id;

      // Update single item
      const patchRes = await dispatchRequest<{ success: boolean; data: any }>(app, {
        method: 'PATCH',
        url: `/api/v1/business/rooms/${roomId}/inventory/${invId}`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          blockedUnits: 2,
          maintenanceUnits: 1,
        },
      });

      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.body.data.availableUnits, 7); // 10 - 2 - 1 = 7
      assert.equal(patchRes.body.data.blockedUnits, 2);
      assert.equal(patchRes.body.data.maintenanceUnits, 1);
    });
  });

  // ============================================================================
  // 4. BUSINESS: BLOCKING & UNBLOCKING DATES
  // ============================================================================

  describe('4. Date Blocking & Unblocking Concurrency Operations', () => {
    let roomId: string;

    beforeEach(async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Block Test Suite',
          roomCategory: ROOM_CATEGORIES.SUITE,
          maxAdults: 2,
          maxOccupancy: 2,
          bedConfiguration: '1 King Bed',
          bedCount: 1,
          basePrice: 500000,
          totalUnits: 5,
        },
      });
      roomId = res.body.data.id;

      // Seed 5 available units across 5 days (2026-12-01 to 2026-12-05)
      await dispatchRequest(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${roomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-05',
          totalUnits: 5,
          blockedUnits: 0,
          maintenanceUnits: 0,
        },
      });
    });

    it('4.1 should block units for maintenance across dates (POST /business/rooms/:roomTypeId/block-dates)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: { affectedDatesCount: number } }>(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/block-dates`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          unitsToBlock: 2,
          blockType: 'MAINTENANCE',
          reason: 'Air conditioning annual maintenance',
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.affectedDatesCount, 3);

      // Verify that availableUnits was reduced to 3 and maintenanceUnits increased to 2
      const getRes = await dispatchRequest<{ success: boolean; data: any[] }>(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${roomId}/inventory?startDate=2026-12-01&endDate=2026-12-03`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      for (const item of getRes.body.data) {
        assert.equal(item.availableUnits, 3);
        assert.equal(item.maintenanceUnits, 2);
      }
    });

    it('4.2 should reject blocking if available units are insufficient (409 Conflict)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/block-dates`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          unitsToBlock: 10, // Total is only 5!
          blockType: 'MAINTENANCE',
        },
      });

      assert.equal(res.status, 409);
    });

    it('4.3 should unblock maintenance units back to sellable inventory (POST /unblock-dates)', async () => {
      // First block 3 units
      await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/block-dates`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          unitsToBlock: 3,
          blockType: 'MAINTENANCE',
        },
      });

      // Now unblock 2 units
      const unblockRes = await dispatchRequest<{ success: boolean; data: { affectedDatesCount: number } }>(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/unblock-dates`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          unitsToUnblock: 2,
          blockType: 'MAINTENANCE',
        },
      });

      assert.equal(unblockRes.status, 200);

      // Verify that available is now 4 (5 - 3 + 2 = 4) and maintenance is 1 (3 - 2 = 1)
      const getRes = await dispatchRequest<{ success: boolean; data: any[] }>(app, {
        method: 'GET',
        url: `/api/v1/business/rooms/${roomId}/inventory?startDate=2026-12-01&endDate=2026-12-03`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
      });

      for (const item of getRes.body.data) {
        assert.equal(item.availableUnits, 4);
        assert.equal(item.maintenanceUnits, 1);
      }
    });

    it('4.4 should reject unblocking more units than currently in maintenance (409 Conflict)', async () => {
      const res = await dispatchRequest(app, {
        method: 'POST',
        url: `/api/v1/business/rooms/${roomId}/unblock-dates`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          unitsToUnblock: 2, // None in maintenance!
          blockType: 'MAINTENANCE',
        },
      });

      assert.equal(res.status, 409);
    });
  });

  // ============================================================================
  // 5. PUBLIC DISCOVERY & AVAILABILITY SCANS
  // ============================================================================

  describe('5. Public Room Discovery & Availability Scans', () => {
    let activeRoomId: string;

    beforeEach(async () => {
      const res = await dispatchRequest<{ success: boolean; data: RoomTypeDto }>(app, {
        method: 'POST',
        url: `/api/v1/business/properties/${publishedPropId}/rooms`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          name: 'Public Lake Villa',
          roomCategory: ROOM_CATEGORIES.VILLA,
          maxAdults: 2,
          maxChildren: 1,
          maxOccupancy: 3,
          bedConfiguration: '1 King Bed',
          bedCount: 1,
          basePrice: 800000, // 8000.00 INR
          totalUnits: 5,
        },
      });
      activeRoomId = res.body.data.id;

      // Seed inventory for Dec 1 - Dec 10 with 5 available units
      await dispatchRequest(app, {
        method: 'PUT',
        url: `/api/v1/business/rooms/${activeRoomId}/inventory`,
        headers: { authorization: `Bearer ${verifiedHotelToken}` },
        body: {
          startDate: '2026-12-01',
          endDate: '2026-12-10',
          totalUnits: 5,
          blockedUnits: 0,
          maintenanceUnits: 0,
        },
      });
    });

    it('5.1 should list public active rooms for a published property (GET /properties/:propertyId/rooms)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: PublicRoomTypeDto[]; total: number }>(app, {
        method: 'GET',
        url: `/api/v1/properties/${publishedPropId}/rooms`,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.total, 1);
      assert.equal(res.body.data[0].name, 'Public Lake Villa');
      assert.equal(res.body.data[0].pricePerNight, 8000);
      assert.equal(res.body.data[0].pricePerNightPaise, 800000);
    });

    it('5.2 should conceal rooms for an unpublished/draft property with 404', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/v1/properties/${draftPropId}/rooms`,
      });

      assert.equal(res.status, 404);
    });

    it('5.3 should fetch public details of a single active room (GET /rooms/:roomTypeId)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: PublicRoomTypeDto }>(app, {
        method: 'GET',
        url: `/api/v1/rooms/${activeRoomId}`,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, 'Public Lake Villa');
      assert.equal(res.body.data.pricePerNight, 8000);
    });

    it('5.4 should check property availability for a multi-night stay (GET /properties/:propertyId/availability)', async () => {
      const res = await dispatchRequest<{ success: boolean; data: PropertyAvailabilityResponseDto }>(app, {
        method: 'GET',
        url: `/api/v1/properties/${publishedPropId}/availability?checkIn=2026-12-01&checkOut=2026-12-04&adults=2&rooms=1`,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.nightsCount, 3);
      assert.equal(res.body.data.availableRoomTypes.length, 1);

      const roomResult = res.body.data.availableRoomTypes[0];
      assert.equal(roomResult.isAvailable, true);
      assert.equal(roomResult.availableUnitsAcrossStay, 5);
      assert.equal(roomResult.nightsCount, 3);
      assert.equal(roomResult.pricePerNight, 8000);
      assert.equal(roomResult.totalStayPrice, 24000); // 3 * 8000 = 24000
    });

    it('5.5 should report isAvailable: false when party size exceeds room occupancy', async () => {
      const res = await dispatchRequest<{ success: boolean; data: PropertyAvailabilityResponseDto }>(app, {
        method: 'GET',
        url: `/api/v1/properties/${publishedPropId}/availability?checkIn=2026-12-01&checkOut=2026-12-03&adults=4&rooms=1`, // 4 adults exceeds maxOccupancy 3
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.availableRoomTypes[0].isAvailable, false);
    });

    it('5.6 should report isAvailable: false when requested units exceed available inventory', async () => {
      const res = await dispatchRequest<{ success: boolean; data: PropertyAvailabilityResponseDto }>(app, {
        method: 'GET',
        url: `/api/v1/properties/${publishedPropId}/availability?checkIn=2026-12-01&checkOut=2026-12-03&adults=2&rooms=10`, // 10 rooms requested, only 5 exist
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.availableRoomTypes[0].isAvailable, false);
    });

    it('5.7 should reject availability query where checkIn >= checkOut (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/v1/properties/${publishedPropId}/availability?checkIn=2026-12-05&checkOut=2026-12-01`,
      });

      assert.equal(res.status, 400);
    });

    it('5.8 should reject availability query exceeding 30 stay nights (400 Bad Request)', async () => {
      const res = await dispatchRequest(app, {
        method: 'GET',
        url: `/api/v1/properties/${publishedPropId}/availability?checkIn=2026-12-01&checkOut=2027-01-15`, // > 40 nights
      });

      assert.equal(res.status, 400);
    });
  });
});
