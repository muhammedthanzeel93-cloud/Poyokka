import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
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
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import {
  AuditLogService,
  RecordAdminAuditInput,
} from '../modules/admin/audit-log.service';
import { AuthRepository } from '../modules/auth/auth.repository';
import { PropertyRepository } from '../modules/properties/property.repository';
import { RoomRepository } from '../modules/rooms/room.repository';
import { BookingsRepository } from '../modules/bookings/bookings.repository';
import { bookingsService } from '../modules/bookings/bookings.service';
import { bookingHoldExpiryService } from '../modules/bookings/booking-expiry.service';
import {
  IAccountDocument,
  IBusinessProfileDocument,
} from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { dispatchRequest as rawDispatchRequest } from './testUtils';
import { getTodayInKolkata } from '../modules/bookings/bookings.validation';

const dispatchRequest = async (
  appInstance: any,
  method: string,
  url: string,
  options: { token?: string; headers?: Record<string, string>; body?: unknown } = {},
) => {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  const response = await rawDispatchRequest<any>(appInstance, {
    method,
    url,
    headers,
    body: options.body,
  });
  if (response.body && response.body.error && !response.body.message) {
    response.body.message = response.body.error.message;
  }
  return response;
};

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

  public async findAccountById(id: string | Types.ObjectId): Promise<IAccountDocument | null> {
    const acc = this.accounts.get(id.toString());
    if (!acc) return null;
    return {
      _id: acc._id,
      email: acc.email,
      accountType: acc.accountType,
      status: acc.status,
    } as unknown as IAccountDocument;
  }

  public async findBusinessProfileByAccountId(accountId: string | Types.ObjectId): Promise<IBusinessProfileDocument | null> {
    const prof = this.businessProfiles.get(accountId.toString());
    if (!prof) return null;
    return {
      _id: prof._id,
      accountId: prof.accountId,
      businessName: prof.businessName,
      businessType: prof.businessType,
      verificationStatus: prof.verificationStatus,
    } as unknown as IBusinessProfileDocument;
  }
}

class MockAuditService extends AuditLogService {
  public recordedLogs: RecordAdminAuditInput[] = [];

  public async recordAdminAction(input: RecordAdminAuditInput): Promise<any> {
    this.recordedLogs.push(input);
    return {
      id: new Types.ObjectId().toString(),
      ...input,
      createdAt: new Date().toISOString(),
    };
  }
}

describe('DAY 23 — Booking Engine, Multi-Night Availability & Temporary Holds', () => {
  let app: any;
  let testAuthRepo: TestAuthRepository;
  let mockAudit: MockAuditService;
  let testBookingsRepo: BookingsRepository;
  let testRoomRepo: RoomRepository;
  let testPropRepo: PropertyRepository;

  // Tourist 1 Credentials
  const touristId = new Types.ObjectId();
  const touristEmail = 'tourist@keralatourism.local';
  let touristToken: string;

  // Tourist 2 Credentials (for authorization isolation)
  const otherTouristId = new Types.ObjectId();
  const otherTouristEmail = 'other.tourist@keralatourism.local';
  let otherTouristToken: string;

  // Merchant & Property Identity
  const merchantAccountId = new Types.ObjectId();
  const businessProfileId = new Types.ObjectId();
  const propertyId = new Types.ObjectId();
  const roomTypeId = new Types.ObjectId();

  const today = getTodayInKolkata();
  const [yearStr, monthStr, dayStr] = today.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);

  // Future valid stay dates (5 days from today)
  const checkInDate = new Date(Date.UTC(y, m - 1, d + 5)).toISOString().split('T')[0];
  const checkOutDate = new Date(Date.UTC(y, m - 1, d + 8)).toISOString().split('T')[0]; // 3 nights
  const stayDates = [
    new Date(Date.UTC(y, m - 1, d + 5)).toISOString().split('T')[0],
    new Date(Date.UTC(y, m - 1, d + 6)).toISOString().split('T')[0],
    new Date(Date.UTC(y, m - 1, d + 7)).toISOString().split('T')[0],
  ];

  beforeEach(() => {
    resetRateLimiter();
    testAuthRepo = new TestAuthRepository();
    mockAudit = new MockAuditService();
    testBookingsRepo = new BookingsRepository();
    testRoomRepo = new RoomRepository();
    testPropRepo = new PropertyRepository();

    // Wire services
    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);

    bookingsService.setRepository(testBookingsRepo);
    testBookingsRepo.setRoomRepository(testRoomRepo);
    bookingsService.setPropertyRepository(testPropRepo);
    bookingsService.setRoomRepository(testRoomRepo);
    bookingsService.setAuditService(mockAudit);

    bookingHoldExpiryService.setRepository(testBookingsRepo);
    bookingHoldExpiryService.setAuditService(mockAudit);

    app = createApp();

    // Seed Tourist 1
    testAuthRepo.accounts.set(touristId.toString(), {
      _id: touristId,
      email: touristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    touristToken = jwtService.signAccessToken({
      id: touristId.toString(),
      email: touristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // Seed Tourist 2
    testAuthRepo.accounts.set(otherTouristId.toString(), {
      _id: otherTouristId,
      email: otherTouristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    otherTouristToken = jwtService.signAccessToken({
      id: otherTouristId.toString(),
      email: otherTouristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // Seed Merchant & Business Profile
    testAuthRepo.businessProfiles.set(merchantAccountId.toString(), {
      _id: businessProfileId,
      accountId: merchantAccountId,
      businessName: 'Wayanad Nature Resorts',
      businessType: BUSINESS_TYPES.RESORT,
      verificationStatus: 'VERIFIED',
    });

    // Seed Published Property
    testPropRepo.inMemoryStore.set(propertyId.toString(), {
      _id: propertyId,
      businessProfileId,
      accountId: merchantAccountId,
      name: 'Wayanad Rainforest Retreat',
      slug: 'wayanad-rainforest-retreat',
      propertyType: 'RESORT' as any,
      status: PROPERTY_STATUSES.PUBLISHED,
      district: 'Wayanad' as any,
      address: {
        line1: 'Bypass Road',
        line2: 'Vythiri',
        city: 'Vythiri',
        postalCode: '673576',
        district: 'Wayanad' as any,
      },
      location: {
        type: 'Point',
        coordinates: [76.042, 11.554],
      },
      checkInTime: '14:00',
      checkOutTime: '11:00',
      contactEmail: 'contact@wayanadretreat.com',
      contactPhone: '+919876543210',
      facilities: ['WIFI', 'SWIMMING_POOL', 'RESTAURANT'] as any,
      starRating: 4,
      isFeatured: false,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Seed Active Room Type (Base Price 5000.00 INR = 500000 paise, Max Adults: 2, Max Occupancy: 3, Total Units: 5)
    testRoomRepo.inMemoryRoomTypes.set(roomTypeId.toString(), {
      _id: roomTypeId,
      propertyId,
      businessProfileId,
      accountId: merchantAccountId,
      name: 'Deluxe Rainforest Cottage',
      slug: 'deluxe-rainforest-cottage',
      roomCategory: ROOM_CATEGORIES.COTTAGE,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
      bedConfiguration: '1 King Bed',
      bedCount: 1,
      roomSize: 450,
      roomSizeUnit: 'SQ_FT' as any,
      facilities: ['WIFI', 'AIR_CONDITIONING', 'BALCONY'],
      basePrice: 500000, // 5000.00 INR in paise
      currency: 'INR',
      pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT,
      status: ROOM_STATUSES.ACTIVE,
      totalUnits: 5,
      coverMediaId: null,
      galleryMediaIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed Initial Inventory across stayDates (5 available units per night)
    for (const d of stayDates) {
      testRoomRepo.inMemoryInventory.set(`${roomTypeId.toString()}:${d}`, {
        _id: new Types.ObjectId(),
        propertyId,
        roomTypeId,
        businessProfileId,
        date: new Date(`${d}T00:00:00.000Z`),
        totalUnits: 5,
        availableUnits: 5,
        blockedUnits: 0,
        maintenanceUnits: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });

  // =========================================================================
  // 1. INPUT VALIDATION TESTS
  // =========================================================================

  it('1. Rejects booking hold creation when unauthenticated', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
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

    assert.equal(res.status, 401);
  });

  it('2. Rejects booking hold with past check-in date relative to Asia/Kolkata', async () => {
    const pastCheckIn = '2020-01-01';
    const pastCheckOut = '2020-01-03';

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate: pastCheckIn,
        checkOutDate: pastCheckOut,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /past/i);
  });

  it('3. Rejects booking hold when checkOutDate is on or before checkInDate', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate: checkInDate, // Equal dates
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /after check-in/i);
  });

  it('4. Rejects stay duration exceeding maximum of 30 nights', async () => {
    const farCheckOut = new Date(Date.UTC(y, m - 1, d + 37)).toISOString().split('T')[0];

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate: farCheckOut,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /cannot exceed 30 nights/i);
  });

  it('5. Rejects advance booking beyond 180 days', async () => {
    const distantCheckIn = new Date(Date.UTC(y, m - 1, d + 190)).toISOString().split('T')[0];
    const distantCheckOut = new Date(Date.UTC(y, m - 1, d + 193)).toISOString().split('T')[0];

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate: distantCheckIn,
        checkOutDate: distantCheckOut,
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /180 days/i);
  });

  it('6. Rejects invalid room counts (< 1 or > 10)', async () => {
    const resZero = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 0,
        adults: 1,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });
    assert.equal(resZero.status, 400);

    const resExcess = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 11,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });
    assert.equal(resExcess.status, 400);
  });

  it('7. Rejects invalid guest details (invalid email or phone)', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 1,
        guestDetails: {
          primaryGuestName: 'A', // Too short (min 2)
          email: 'not-an-email',
          phone: '123', // Too short (min 10)
        },
      },
    });

    assert.equal(res.status, 400);
  });

  it('8. Rejects client attempt to inject unauthorized price or payment fields (strict Zod validation)', async () => {
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
        customPrice: 100, // Injected forbidden field
        status: 'CONFIRMED', // Injected forbidden status
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
    assert.ok(JSON.stringify(res.body).toLowerCase().includes('unrecognized'));
  });

  // =========================================================================
  // 2. PROPERTY & ROOM ELIGIBILITY
  // =========================================================================

  it('9. Rejects hold if property does not exist', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: new Types.ObjectId().toString(),
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

    assert.equal(res.status, 404);
    assert.match(res.body.message, /property not found/i);
  });

  it('10. Rejects hold if property is not published (DRAFT status)', async () => {
    const draftPropId = new Types.ObjectId();
    testPropRepo.inMemoryStore.set(draftPropId.toString(), {
      _id: draftPropId,
      businessProfileId,
      name: 'Draft Villa',
      status: PROPERTY_STATUSES.DRAFT,
    } as any);

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: draftPropId.toString(),
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

    assert.equal(res.status, 404);
    assert.match(res.body.message, /not currently available/i);
  });

  it('11. Rejects hold if room type does not exist', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: new Types.ObjectId().toString(),
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

    assert.equal(res.status, 404);
    assert.match(res.body.message, /room type not found/i);
  });

  it('12. Rejects hold if room type is ARCHIVED', async () => {
    const archivedRoomId = new Types.ObjectId();
    testRoomRepo.inMemoryRoomTypes.set(archivedRoomId.toString(), {
      _id: archivedRoomId,
      propertyId,
      status: ROOM_STATUSES.ARCHIVED,
      basePrice: 500000,
      maxAdults: 2,
      maxOccupancy: 3,
    } as any);

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: archivedRoomId.toString(),
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

    assert.equal(res.status, 404);
    assert.match(res.body.message, /not active/i);
  });

  it('13. Rejects hold if room type belongs to a different property', async () => {
    const otherPropId = new Types.ObjectId();
    testPropRepo.inMemoryStore.set(otherPropId.toString(), {
      _id: otherPropId,
      businessProfileId,
      name: 'Other Property',
      status: PROPERTY_STATUSES.PUBLISHED,
    } as any);

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: otherPropId.toString(), // Mismatched property
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

    assert.equal(res.status, 404);
  });

  // =========================================================================
  // 3. OCCUPANCY VALIDATION
  // =========================================================================

  it('14. Rejects hold when adults count exceeds maxAdults * numberOfRooms', async () => {
    // Room has maxAdults: 2. For 1 room, max is 2. Requesting 3 adults must fail.
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 3,
        children: 0,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /exceeds maximum adult capacity/i);
  });

  it('15. Rejects hold when total guests (adults + children) exceed maxOccupancy * numberOfRooms', async () => {
    // Room has maxAdults: 2, maxOccupancy: 3. For 1 room, requesting 2 adults + 2 children = 4 guests must fail.
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        children: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /exceed maximum total capacity/i);
  });

  it('16. Permits higher guest count when booking multiple rooms', async () => {
    // For 2 rooms: maxAdults allowed = 4, maxOccupancy allowed = 6. Requesting 4 adults + 1 child = 5 guests must succeed.
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 2,
        adults: 4,
        children: 1,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 201);
  });

  // =========================================================================
  // 4. INTEGER PAISE FINANCIAL CALCULATIONS & IMMUTABLE SNAPSHOT
  // =========================================================================

  it('17. Accurately calculates price snapshot in integer paise (1 room, 3 nights)', async () => {
    // Base price = 500000 paise (5000 INR). 1 room * 3 nights = 1500000 paise (15000 INR).
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 1,
        adults: 2,
        children: 0,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 201);
    const snap = res.body.data.booking.priceSnapshot;
    assert.equal(snap.basePricePaise, 500000);
    assert.equal(snap.basePriceInr, 5000);
    assert.equal(snap.numberOfRooms, 1);
    assert.equal(snap.numberOfNights, 3);
    assert.equal(snap.subtotalPaise, 1500000);
    assert.equal(snap.subtotalInr, 15000);
    assert.equal(snap.totalPaise, 1500000);
    assert.equal(snap.totalInr, 15000);
    assert.equal(snap.currency, 'INR');
    assert.equal(snap.dailyBreakdown.length, 3);
    assert.equal(snap.dailyBreakdown[0].pricePaise, 500000);
  });

  it('18. Accurately calculates multi-room multiplier in integer paise (2 rooms, 3 nights)', async () => {
    // Base price = 500000 paise. 2 rooms * 3 nights = 3000000 paise (30000 INR).
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 2,
        adults: 4,
        children: 0,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 201);
    const snap = res.body.data.booking.priceSnapshot;
    assert.equal(snap.numberOfRooms, 2);
    assert.equal(snap.numberOfNights, 3);
    assert.equal(snap.subtotalPaise, 3000000);
    assert.equal(snap.subtotalInr, 30000);
    assert.equal(snap.totalPaise, 3000000);
    assert.equal(snap.totalInr, 30000);
  });

  // =========================================================================
  // 5. INVENTORY DECREMENT & CONCURRENCY CONFLICT (409)
  // =========================================================================

  it('19. Atomically decrements available units across all stay dates', async () => {
    // Initial available units = 5. Booking 2 rooms should leave 3 units.
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 2,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 201);
    for (const d of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`);
      assert.equal(inv!.availableUnits, 3);
    }
  });

  it('20. Rejects with 409 Conflict when requested rooms exceed available units', async () => {
    // Available units = 5. Requesting 6 rooms must fail with 409.
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 6,
        adults: 6,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });

    assert.equal(res.status, 409);
    assert.match(res.body.message, /insufficient room inventory/i);

    // Verify inventory untouched
    for (const d of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`);
      assert.equal(inv!.availableUnits, 5);
    }
  });

  it('21. Rejects with 409 Conflict if ANY single date in the stay has insufficient units', async () => {
    // Exhaust day 2 inventory to 0
    const day2 = stayDates[1];
    testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${day2}`)!.availableUnits = 0;

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

    assert.equal(res.status, 409);
    assert.match(res.body.message, /insufficient room inventory/i);
  });

  // =========================================================================
  // 6. IDEMPOTENCY HANDLING
  // =========================================================================

  it('22. Returns cached response for identical request with same Idempotency-Key', async () => {
    const idempKey = 'client-uuid-1111-2222-3333';
    const payload = {
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
    };

    const res1 = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      headers: { 'idempotency-key': idempKey },
      body: payload,
    });
    assert.equal(res1.status, 201);
    const holdId1 = res1.body.data.hold.id;
    const ref1 = res1.body.data.booking.bookingReference;

    // Repeat identical request
    const res2 = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      headers: { 'idempotency-key': idempKey },
      body: payload,
    });
    assert.equal(res2.status, 201);
    assert.equal(res2.body.data.hold.id, holdId1);
    assert.equal(res2.body.data.booking.bookingReference, ref1);

    // Verify inventory was only deducted ONCE (from 5 to 4)
    for (const d of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`);
      assert.equal(inv!.availableUnits, 4);
    }
  });

  it('23. Rejects with 409 Conflict when same Idempotency-Key is reused with different payload', async () => {
    const idempKey = 'client-uuid-conflict-test';
    const payload1 = {
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
    };

    const res1 = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      headers: { 'idempotency-key': idempKey },
      body: payload1,
    });
    assert.equal(res1.status, 201);

    // Alter payload (different guest or rooms) with same key
    const payload2 = {
      ...payload1,
      numberOfRooms: 2,
      adults: 4,
    };

    const res2 = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      headers: { 'idempotency-key': idempKey },
      body: payload2,
    });
    assert.equal(res2.status, 409);
    assert.match(res2.body.message, /different request payload/i);
  });

  // =========================================================================
  // 7. RATE LIMITING
  // =========================================================================

  it('24. Attaches standard rate-limiting headers to hold creation responses', async () => {
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
    assert.ok(res.headers['ratelimit-limit']);
    assert.ok(res.headers['ratelimit-remaining']);
  });

  // =========================================================================
  // 8. HOLD INSPECTION & REMAINING TIME
  // =========================================================================

  it('25. Retrieves active hold details and remaining seconds', async () => {
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

    const getRes = await dispatchRequest(app, 'GET', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: touristToken,
    });

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.hold.id, holdId);
    assert.equal(getRes.body.data.hold.status, 'ACTIVE');
    assert.ok(getRes.body.data.remainingSeconds > 0 && getRes.body.data.remainingSeconds <= 900);
  });

  it('26. Returns 404 when querying another tourist hold (authorization barrier)', async () => {
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

    // Tourist 2 tries to access Tourist 1 hold
    const getRes = await dispatchRequest(app, 'GET', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: otherTouristToken,
    });

    assert.equal(getRes.status, 404);
  });

  // =========================================================================
  // 9. VOLUNTARY HOLD RELEASE & INVENTORY RESTORATION
  // =========================================================================

  it('27. Tourist can voluntarily release active hold and restore inventory', async () => {
    // 1. Create hold for 2 rooms (availableUnits: 5 -> 3)
    const createRes = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 2,
        adults: 4,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });
    const holdId = createRes.body.data.hold.id;
    const bookingId = createRes.body.data.booking.id;

    for (const d of stayDates) {
      assert.equal(testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`)!.availableUnits, 3);
    }

    // 2. Release hold
    const delRes = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: touristToken,
    });
    assert.equal(delRes.status, 200);
    assert.match(delRes.body.message, /released/i);

    // 3. Verify inventory restored (back to 5)
    for (const d of stayDates) {
      assert.equal(testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`)!.availableUnits, 5);
    }

    // 4. Verify booking status transitioned to CANCELLED
    const booking = testBookingsRepo.inMemoryBookings.get(bookingId);
    assert.equal(booking!.status, BOOKING_STATUSES.CANCELLED);

    // 5. Verify hold status transitioned to RELEASED
    const hold = testBookingsRepo.inMemoryHolds.get(holdId);
    assert.equal(hold!.status, INVENTORY_HOLD_STATUSES.RELEASED);
  });

  it('28. Cannot double-release an already released hold', async () => {
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

    // Release once
    const res1 = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: touristToken,
    });
    assert.equal(res1.status, 200);

    // Release twice
    const res2 = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: touristToken,
    });
    assert.equal(res2.status, 404);
  });

  // =========================================================================
  // 10. BOOKING RETRIEVAL & LISTING
  // =========================================================================

  it('29. Tourist can retrieve booking details by booking ID', async () => {
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
    const bookingId = createRes.body.data.booking.id;

    const res = await dispatchRequest(app, 'GET', `/api/v1/tourist/bookings/${bookingId}`, {
      token: touristToken,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, bookingId);
    assert.equal(res.body.data.status, BOOKING_STATUSES.AWAITING_PAYMENT);
  });

  it('30. Rejects retrieval of booking belonging to another tourist', async () => {
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
    const bookingId = createRes.body.data.booking.id;

    const res = await dispatchRequest(app, 'GET', `/api/v1/tourist/bookings/${bookingId}`, {
      token: otherTouristToken,
    });

    assert.equal(res.status, 404);
  });

  it('31. Lists bookings scoped to authenticated tourist', async () => {
    // Tourist 1 creates a booking
    await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
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

    const res1 = await dispatchRequest(app, 'GET', '/api/v1/tourist/bookings', {
      token: touristToken,
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.body.data.total, 1);
    assert.equal(res1.body.data.items.length, 1);

    // Tourist 2 has no bookings
    const res2 = await dispatchRequest(app, 'GET', '/api/v1/tourist/bookings', {
      token: otherTouristToken,
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.data.total, 0);
  });

  // =========================================================================
  // 11. AUTONOMOUS HOLD EXPIRY WORKER
  // =========================================================================

  it('32. Background expiry worker finds and restores expired holds', async () => {
    // 1. Create a hold
    const createRes = await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
      token: touristToken,
      body: {
        propertyId: propertyId.toString(),
        roomTypeId: roomTypeId.toString(),
        checkInDate,
        checkOutDate,
        numberOfRooms: 2,
        adults: 4,
        guestDetails: {
          primaryGuestName: 'Anoop Nair',
          email: 'anoop@example.com',
          phone: '+919876543210',
        },
      },
    });
    const holdId = createRes.body.data.hold.id;
    const bookingId = createRes.body.data.booking.id;

    for (const d of stayDates) {
      assert.equal(testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`)!.availableUnits, 3);
    }

    // 2. Fast forward hold expiration timestamp to the past
    const hold = testBookingsRepo.inMemoryHolds.get(holdId);
    hold!.expiresAt = new Date(Date.now() - 5000); // Expired 5 seconds ago

    // 3. Trigger expiry batch worker
    const result = await bookingHoldExpiryService.processExpiredHoldsBatch(50);
    assert.equal(result.scannedCount, 1);
    assert.equal(result.expiredCount, 1);
    assert.equal(result.restoredCount, 1);
    assert.equal(result.failedCount, 0);

    // 4. Verify inventory restored (back to 5)
    for (const d of stayDates) {
      assert.equal(testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${d}`)!.availableUnits, 5);
    }

    // 5. Verify hold transitioned to EXPIRED
    assert.equal(hold!.status, INVENTORY_HOLD_STATUSES.EXPIRED);

    // 6. Verify booking transitioned to EXPIRED
    const booking = testBookingsRepo.inMemoryBookings.get(bookingId);
    assert.equal(booking!.status, BOOKING_STATUSES.EXPIRED);
  });

  it('33. Background expiry worker does not touch active unexpired holds', async () => {
    await dispatchRequest(app, 'POST', '/api/v1/tourist/bookings/holds', {
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

    const result = await bookingHoldExpiryService.processExpiredHoldsBatch(50);
    assert.equal(result.scannedCount, 0);
    assert.equal(result.expiredCount, 0);
    assert.equal(result.restoredCount, 0);
  });

  // =========================================================================
  // 12. AUDIT TRAIL LOGGING
  // =========================================================================

  it('34. Records immutable audit log entries for created, released, and expired holds', async () => {
    // 1. Create Hold
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

    const createAudit = mockAudit.recordedLogs.find(
      (log) => log.action === ADMIN_AUDIT_ACTIONS.BOOKING_HOLD_CREATED,
    );
    assert.ok(createAudit);
    assert.equal(createAudit.targetEntityType, AUDIT_TARGET_ENTITY_TYPES.INVENTORY_HOLD);
    assert.equal(createAudit.targetEntityId.toString(), holdId);

    // 2. Release Hold
    await dispatchRequest(app, 'DELETE', `/api/v1/tourist/bookings/holds/${holdId}`, {
      token: touristToken,
    });

    const releaseAudit = mockAudit.recordedLogs.find(
      (log) => log.action === ADMIN_AUDIT_ACTIONS.BOOKING_HOLD_RELEASED,
    );
    assert.ok(releaseAudit);
    assert.equal(releaseAudit.targetEntityType, AUDIT_TARGET_ENTITY_TYPES.INVENTORY_HOLD);
    assert.equal(releaseAudit.targetEntityId.toString(), holdId);
  });

  it('35. Legacy status endpoint remains backward compatible', async () => {
    const res = await dispatchRequest(app, 'GET', '/api/v1/bookings');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.module, 'bookings');
  });
});
