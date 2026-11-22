import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
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
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_WEBHOOK_STATUSES,
  NOTIFICATION_TYPES,
  ADMIN_AUDIT_ACTIONS,
  ADMIN_PERMISSIONS,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { InternalServerError } from '../shared/errors/AppError';
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
import { PaymentsRepository } from '../modules/payments/payments.repository';
import { RefundsRepository } from '../modules/payments/refund.repository';
import { NotificationService } from '../modules/notifications/notification.service';
import { paymentsService } from '../modules/payments/payments.service';
import { webhookService } from '../modules/payments/webhook.service';
import { RazorpayPaymentProvider } from '../modules/payments/providers/razorpay.provider';
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
  public adminProfiles: Map<string, any> = new Map();

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

  public async findAdminProfile(accountId: string | Types.ObjectId): Promise<any | null> {
    return this.adminProfiles.get(accountId.toString()) || null;
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

class MockNotificationService extends NotificationService {
  public publishedEvents: any[] = [];

  public async publishEvent(input: any): Promise<any> {
    this.publishedEvents.push(input);
    return { success: true };
  }
}

describe('DAY 24 — Payment Integration, Payment Lifecycle & Webhook Security', () => {
  let app: any;
  let testAuthRepo: TestAuthRepository;
  let mockAudit: MockAuditService;
  let mockNotif: MockNotificationService;
  let testBookingsRepo: BookingsRepository;
  let testRoomRepo: RoomRepository;
  let testPropRepo: PropertyRepository;
  let testPaymentsRepo: PaymentsRepository;
  let testRefundsRepo: RefundsRepository;
  let testProvider: RazorpayPaymentProvider;

  const testKeySecret = 'test_secret_key_32chars_minimum_length';
  const testWebhookSecret = 'test_webhook_secret_32chars_minimum';

  // Tourist 1 Credentials
  const touristId = new Types.ObjectId();
  const touristEmail = 'tourist@keralatourism.local';
  let touristToken: string;

  // Tourist 2 Credentials (for authorization isolation)
  const otherTouristId = new Types.ObjectId();
  const otherTouristEmail = 'other.tourist@keralatourism.local';
  let otherTouristToken: string;

  // Suspended Tourist Credentials
  const suspendedTouristId = new Types.ObjectId();
  const suspendedTouristEmail = 'suspended@keralatourism.local';
  let suspendedTouristToken: string;

  // Admin Credentials
  const adminId = new Types.ObjectId();
  const adminEmail = 'admin@keralatourism.local';
  let adminToken: string;

  const unauthorizedAdminId = new Types.ObjectId();
  const unauthorizedAdminEmail = 'unauthorized.admin@keralatourism.local';
  let unauthorizedAdminToken: string;

  // Merchant & Property Identity
  const merchantAccountId = new Types.ObjectId();
  const businessProfileId = new Types.ObjectId();
  const propertyId = new Types.ObjectId();
  const roomTypeId = new Types.ObjectId();

  // Booking & Hold References
  const bookingId = new Types.ObjectId();
  const holdId = new Types.ObjectId();
  const bookingRef = 'BKG-20261120-TEST01';

  const today = getTodayInKolkata();
  const [yearStr, monthStr, dayStr] = today.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);

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
    mockNotif = new MockNotificationService();
    testBookingsRepo = new BookingsRepository();
    testRoomRepo = new RoomRepository();
    testPropRepo = new PropertyRepository();
    testPaymentsRepo = new PaymentsRepository();
    testRefundsRepo = new RefundsRepository();
    testProvider = new RazorpayPaymentProvider(
      'rzp_test_mock_key_id',
      testKeySecret,
      testWebhookSecret,
      true, // simulated test mode
    );

    // Wire auth middleware
    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);

    // Wire bookings service & repo
    bookingsService.setRepository(testBookingsRepo);
    testBookingsRepo.setRoomRepository(testRoomRepo);
    bookingsService.setPropertyRepository(testPropRepo);
    bookingsService.setRoomRepository(testRoomRepo);
    bookingsService.setAuditService(mockAudit);

    // Wire payments service & webhook service
    paymentsService.setRepository(testPaymentsRepo);
    paymentsService.setRefundsRepository(testRefundsRepo);
    paymentsService.setBookingsRepository(testBookingsRepo);
    paymentsService.setPropertyRepository(testPropRepo);
    paymentsService.setProvider(testProvider);
    paymentsService.setAuditService(mockAudit);
    paymentsService.setNotificationService(mockNotif);

    webhookService.setRepository(testPaymentsRepo);
    webhookService.setRefundsRepository(testRefundsRepo);
    webhookService.setBookingsRepository(testBookingsRepo);
    webhookService.setProvider(testProvider);
    webhookService.setAuditService(mockAudit);
    webhookService.setNotificationService(mockNotif);

    // Link in-memory stores between bookings and payments
    testPaymentsRepo.setBookingMemoryStores(
      testBookingsRepo.inMemoryBookings,
      testBookingsRepo.inMemoryHolds,
    );
    testPaymentsRepo.setRefundsRepositoryRef(testRefundsRepo);

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

    // Seed Suspended Tourist
    testAuthRepo.accounts.set(suspendedTouristId.toString(), {
      _id: suspendedTouristId,
      email: suspendedTouristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.SUSPENDED,
    });
    suspendedTouristToken = jwtService.signAccessToken({
      id: suspendedTouristId.toString(),
      email: suspendedTouristEmail,
      accountType: ACCOUNT_TYPES.TOURIST,
      status: ACCOUNT_STATUSES.SUSPENDED,
    });

    // Seed Authorized Admin (with MANAGE_BOOKINGS & HANDLE_DISPUTES)
    testAuthRepo.accounts.set(adminId.toString(), {
      _id: adminId,
      email: adminEmail,
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.adminProfiles.set(adminId.toString(), {
      _id: new Types.ObjectId(),
      accountId: adminId,
      permissions: [
        ADMIN_PERMISSIONS.MANAGE_BOOKINGS,
        ADMIN_PERMISSIONS.HANDLE_DISPUTES,
        ADMIN_PERMISSIONS.VIEW_DASHBOARD,
      ],
    });
    adminToken = jwtService.signAccessToken({
      id: adminId.toString(),
      email: adminEmail,
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });

    // Seed Unauthorized Admin (missing required permissions)
    testAuthRepo.accounts.set(unauthorizedAdminId.toString(), {
      _id: unauthorizedAdminId,
      email: unauthorizedAdminEmail,
      accountType: ACCOUNT_TYPES.ADMIN,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    testAuthRepo.adminProfiles.set(unauthorizedAdminId.toString(), {
      _id: new Types.ObjectId(),
      accountId: unauthorizedAdminId,
      permissions: [ADMIN_PERMISSIONS.VIEW_ANALYTICS],
    });
    unauthorizedAdminToken = jwtService.signAccessToken({
      id: unauthorizedAdminId.toString(),
      email: unauthorizedAdminEmail,
      accountType: ACCOUNT_TYPES.ADMIN,
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

    // Seed Active Room Type (5000.00 INR = 500000 paise per night)
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
      galleryMediaIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed Initial Inventory
    for (const dateStr of stayDates) {
      testRoomRepo.inMemoryInventory.set(`${roomTypeId.toString()}:${dateStr}`, {
        _id: new Types.ObjectId(),
        propertyId,
        roomTypeId,
        businessProfileId,
        date: new Date(`${dateStr}T00:00:00.000Z`),
        totalUnits: 5,
        availableUnits: 4, // 1 unit held
        blockedUnits: 0,
        maintenanceUnits: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Seed Active Inventory Hold (expires in 15 minutes)
    testBookingsRepo.inMemoryHolds.set(holdId.toString(), {
      _id: holdId,
      bookingId,
      roomTypeId,
      propertyId,
      businessProfileId,
      touristAccountId: touristId,
      numberOfRooms: 1,
      stayDates,
      status: INVENTORY_HOLD_STATUSES.ACTIVE,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min in future
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed Awaiting Payment Booking (3 nights * 5000 INR = 15000 INR = 1500000 paise)
    testBookingsRepo.inMemoryBookings.set(bookingId.toString(), {
      _id: bookingId,
      bookingReference: bookingRef,
      touristAccountId: touristId,
      propertyId,
      roomTypeId,
      businessProfileId,
      checkInDate,
      checkOutDate,
      numberOfRooms: 1,
      adults: 2,
      children: 0,
      nights: 3,
      status: BOOKING_STATUSES.AWAITING_PAYMENT,
      holdId,
      paidAt: null,
      confirmedAt: null,
      paymentId: null,
      paymentReference: null,
      priceSnapshot: {
        basePricePaise: 500000,
        basePriceInr: 5000,
        numberOfRooms: 1,
        numberOfNights: 3,
        dailyBreakdown: stayDates.map((date) => ({
          date,
          pricePaise: 500000,
          priceInr: 5000,
        })),
        subtotalPaise: 1500000,
        subtotalInr: 15000,
        taxesPaise: 0,
        taxesInr: 0,
        totalPaise: 1500000,
        totalInr: 15000,
        currency: 'INR',
      },
      guestDetails: {
        primaryGuestName: 'Aarav Patel',
        email: 'aarav.patel@example.com',
        phone: '+919876543210',
        specialRequests: 'Quiet room with forest view',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  // ===========================================================================
  // SECTION 1: PAYMENT INITIATION
  // ===========================================================================

  it('1. Rejects payment initiation when unauthenticated', async () => {
    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`);
    assert.strictEqual(res.status, 401);
  });

  it('2. Rejects payment initiation for suspended tourist account', async () => {
    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: suspendedTouristToken,
    });
    assert.strictEqual(res.status, 403);
  });

  it('3. Rejects payment initiation for another tourist booking (404 concealment)', async () => {
    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: otherTouristToken,
    });
    assert.strictEqual(res.status, 404);
  });

  it('4. Rejects payment initiation when inventory hold is expired', async () => {
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    hold.expiresAt = new Date(Date.now() - 60000); // 1 min in past

    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /expired/i);
  });

  it('5. Rejects payment initiation when inventory hold was released', async () => {
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    hold.status = INVENTORY_HOLD_STATUSES.RELEASED;

    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /no longer active/i);
  });

  it('6. Rejects payment initiation when booking is not in AWAITING_PAYMENT', async () => {
    const booking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    booking.status = BOOKING_STATUSES.CANCELLED;

    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /not eligible/i);
  });

  it('7. Creates payment initiation with authoritative amount from server price snapshot', async () => {
    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
      body: {
        amount: 100, // Client attempt to pay 1 INR instead of 15000 INR
        currency: 'USD',
      },
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    const { payment, checkoutData } = res.body.data;

    // Verify amount is authoritatively 1500000 paise (15000 INR), NOT client-supplied 100
    assert.strictEqual(payment.amountPaise, 1500000);
    assert.strictEqual(payment.amountInr, 15000);
    assert.strictEqual(payment.currency, 'INR');
    assert.strictEqual(payment.status, PAYMENT_STATUSES.PENDING);
    assert.strictEqual(payment.bookingId, bookingId.toString());
    assert.ok(payment.paymentReference.startsWith('PAY-'));

    // Verify checkout data
    assert.strictEqual(checkoutData.amountPaise, 1500000);
    assert.strictEqual(checkoutData.currency, 'INR');
    assert.ok(checkoutData.orderId.startsWith('order_'));
    assert.strictEqual(checkoutData.prefill.name, 'Aarav Patel');
  });

  it('8. Supports idempotent payment initiation via Idempotency-Key header', async () => {
    const idempKey = 'idemp_test_payment_12345';

    const res1 = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
      headers: { 'idempotency-key': idempKey },
    });
    assert.strictEqual(res1.status, 201);
    const orderId1 = res1.body.data.checkoutData.orderId;

    // Repeat identical request with same idempotency key
    const res2 = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
      headers: { 'idempotency-key': idempKey },
    });
    assert.strictEqual(res2.status, 201);
    const orderId2 = res2.body.data.checkoutData.orderId;

    assert.strictEqual(orderId1, orderId2);
  });

  it('9. Attaches rate-limiting headers to payment initiation responses', async () => {
    const res = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['ratelimit-remaining'] || res.headers['x-ratelimit-remaining']);
  });

  // ===========================================================================
  // SECTION 2: PAYMENT VERIFICATION & ATOMIC BOOKING CONFIRMATION
  // ===========================================================================

  it('10. Rejects payment verification when unauthenticated', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      body: {
        paymentId: new Types.ObjectId().toString(),
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123',
      },
    });
    assert.strictEqual(res.status, 401);
  });

  it('11. Rejects payment verification for another tourist payment (404 concealment)', async () => {
    // Initiate payment as Tourist 1
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;

    // Tourist 2 tries to verify
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: otherTouristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: 'pay_test_01',
        razorpay_signature: 'fake_sig',
      },
    });
    assert.strictEqual(res.status, 404);
  });

  it('12. Rejects payment verification with invalid cryptographic signature and marks payment FAILED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: 'pay_test_01',
        razorpay_signature: 'invalid_tampered_signature_hex',
      },
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /signature/i);

    // Verify payment was marked as FAILED in repository
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.FAILED);
    assert.strictEqual(storedPayment.failureCode, 'INVALID_SIGNATURE');
  });

  it('13. Rejects payment verification when provider order ID does not match internal record', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: 'order_completely_wrong_id',
        razorpay_payment_id: 'pay_test_01',
        razorpay_signature: 'some_sig',
      },
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /order ID mismatch/i);
  });

  it('14. Valid checkout signature atomically captures payment, consumes hold, and confirms booking', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_test_valid_01';

    // Compute genuine Razorpay HMAC-SHA256 signature
    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.isConfirmed, true);

    // Verify payment state
    const payment = res.body.data.payment;
    assert.strictEqual(payment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(payment.providerPaymentId, paymentProviderId);
    assert.ok(payment.paidAt);

    // Verify hold was consumed
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    assert.strictEqual(hold.status, INVENTORY_HOLD_STATUSES.CONSUMED);

    // Verify booking is confirmed
    const booking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(booking.status, BOOKING_STATUSES.CONFIRMED);
    assert.ok(booking.confirmedAt);
    assert.ok(booking.paidAt);
    assert.strictEqual(booking.paymentId?.toString(), paymentId);
  });

  it('14a. Rejects payment verification when gateway reports payment is authorized but not captured', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_test_auth_only_01';

    // Mock gateway payment to report 'authorized' instead of 'captured'
    testProvider.setSimulatedPayment(paymentProviderId, {
      providerPaymentId: paymentProviderId,
      providerOrderId: orderId,
      amountPaise: 1500000,
      currency: 'INR',
      status: 'authorized',
      method: 'card',
    });

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /not captured/i);
  });

  it('14b. Rejects payment verification when gateway reports amount mismatch', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_test_amount_mismatch_01';

    // Mock gateway payment to report tampered amount (1000 INR instead of 15000 INR)
    testProvider.setSimulatedPayment(paymentProviderId, {
      providerPaymentId: paymentProviderId,
      providerOrderId: orderId,
      amountPaise: 100000,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
    });

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /amount mismatch/i);
  });

  it('14c. Rejects payment verification when gateway reports currency mismatch', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_test_currency_mismatch_01';

    // Mock gateway payment to report USD instead of INR
    testProvider.setSimulatedPayment(paymentProviderId, {
      providerPaymentId: paymentProviderId,
      providerOrderId: orderId,
      amountPaise: 1500000,
      currency: 'USD',
      status: 'captured',
      method: 'card',
    });

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /currency mismatch/i);
  });

  it('15. Repeated payment verification is idempotent and does not double-confirm', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_test_idemp_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    const res1 = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });
    assert.strictEqual(res1.status, 200);

    // Repeat same verification
    const res2 = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.booking.status, BOOKING_STATUSES.CONFIRMED);
  });

  // ===========================================================================
  // SECTION 3: CRITICAL LATE PAYMENT RECONCILIATION
  // ===========================================================================

  it('16. Critical late payment: captures payment with reconciliation flag, does NOT confirm booking, and does NOT consume expired hold', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_test_late_01';

    // Simulate hold expiring before payment verification
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    hold.status = INVENTORY_HOLD_STATUSES.EXPIRED;
    hold.expiresAt = new Date(Date.now() - 10000);

    const booking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    booking.status = BOOKING_STATUSES.EXPIRED;

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.isConfirmed, false);
    assert.match(res.body.data.message, /flagged for manual reconciliation/i);

    // Verify payment was marked as CAPTURED with reconciliation flag
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(storedPayment.reconciliationStatus, 'FLAGGED_FOR_MANUAL_REVIEW');
    assert.strictEqual(storedPayment.failureCode, 'LATE_PAYMENT_HOLD_EXPIRED');

    // Verify hold remained EXPIRED and booking remained EXPIRED (preventing overbooking)
    assert.strictEqual(hold.status, INVENTORY_HOLD_STATUSES.EXPIRED);
    assert.strictEqual(booking.status, BOOKING_STATUSES.EXPIRED);
  });

  // ===========================================================================
  // SECTION 4: WEBHOOK PROCESSING
  // ===========================================================================

  it('17. Rejects webhook request when signature header is missing', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      body: { event: 'payment.captured' },
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /missing/i);
  });

  it('18. Rejects webhook request with invalid HMAC signature', async () => {
    const rawPayload = JSON.stringify({ event: 'payment.captured' });
    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': 'invalid_signature_hex_code',
        'content-type': 'application/json',
      },
      body: JSON.parse(rawPayload),
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid webhook signature/i);
  });

  it('19. Processes valid payment.captured webhook, confirms booking and consumes hold', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_webhook_captured_99';

    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: orderId,
            amount: 1500000,
            currency: 'INR',
            status: 'captured',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    };

    const rawStr = JSON.stringify(webhookBody);
    const validWebhookSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawStr)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_test_captured_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PROCESSED');

    // Verify booking confirmed and hold consumed
    const booking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(booking.status, BOOKING_STATUSES.CONFIRMED);

    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    assert.strictEqual(hold.status, INVENTORY_HOLD_STATUSES.CONSUMED);
  });

  it('19a. Rejects payment.captured webhook when amount in webhook payload differs from booking price snapshot', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_webhook_tampered_amt_01';

    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: orderId,
            amount: 50000, // 500 INR instead of 15000 INR
            currency: 'INR',
            status: 'captured',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    };

    const rawStr = JSON.stringify(webhookBody);
    const validWebhookSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawStr)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_test_tampered_amt_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'AMOUNT_MISMATCH');

    // Confirm booking was NOT confirmed with tampered amount
    const booking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.notStrictEqual(booking.status, BOOKING_STATUSES.CONFIRMED);
  });

  it('20. Deduplicates repeated webhook event with identical event ID', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const orderId = initRes.body.data.checkoutData.orderId;

    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_dup_01',
            order_id: orderId,
            amount: 1500000,
            currency: 'INR',
          },
        },
      },
    };

    const rawStr = JSON.stringify(webhookBody);
    const validWebhookSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawStr)
      .digest('hex');

    const res1 = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_dedup_test_999',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.data.status, 'PROCESSED');

    // Send exact same webhook again
    const res2 = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_dedup_test_999',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.status, 'ALREADY_PROCESSED');
  });

  it('21. Processes payment.failed webhook event and marks payment as FAILED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;

    const webhookBody = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_failed_01',
            order_id: orderId,
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment failed due to card decline',
          },
        },
      },
    };

    const rawStr = JSON.stringify(webhookBody);
    const validWebhookSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawStr)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_failed_test_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PROCESSED');

    const payment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(payment.status, PAYMENT_STATUSES.FAILED);
    assert.strictEqual(payment.failureCode, 'BAD_REQUEST_ERROR');
  });

  it('22. Out-of-order protection: payment.failed webhook cannot downgrade an already CAPTURED payment', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;

    // First mark as CAPTURED
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    storedPayment.status = PAYMENT_STATUSES.CAPTURED;

    const webhookBody = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_out_of_order_01',
            order_id: orderId,
            error_code: 'GATEWAY_ERROR',
          },
        },
      },
    };

    const rawStr = JSON.stringify(webhookBody);
    const validWebhookSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawStr)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_ooo_test_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);
    // Confirm status is still CAPTURED
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.CAPTURED);
  });

  it('23. Safe handling of webhook for unknown payment order', async () => {
    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_unregistered_order',
            order_id: 'order_non_existent_9999',
            amount: 50000,
          },
        },
      },
    };

    const rawStr = JSON.stringify(webhookBody);
    const validWebhookSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawStr)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_unknown_order_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PAYMENT_NOT_FOUND');
  });

  // ===========================================================================
  // SECTION 5: PAYMENT READ APIS & BACKWARD COMPATIBILITY
  // ===========================================================================

  it('24. Tourist can retrieve own payment details by payment ID', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;

    const res = await dispatchRequest(app, 'GET', `/api/v1/tourist/payments/${paymentId}`, {
      token: touristToken,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.id, paymentId);
    assert.strictEqual(res.body.data.touristAccountId, touristId.toString());
  });

  it('25. Rejects retrieval of payment belonging to another tourist (404 concealment)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;

    const res = await dispatchRequest(app, 'GET', `/api/v1/tourist/payments/${paymentId}`, {
      token: otherTouristToken,
    });

    assert.strictEqual(res.status, 404);
  });

  it('26. Tourist can retrieve payment details by booking ID', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;

    const res = await dispatchRequest(app, 'GET', `/api/v1/tourist/bookings/${bookingId}/payment`, {
      token: touristToken,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.id, paymentId);
    assert.strictEqual(res.body.data.bookingId, bookingId.toString());
  });

  it('27. Legacy status endpoint remains backward compatible', async () => {
    const res = await dispatchRequest(app, 'GET', '/api/v1/payments');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.module, 'payments');
    assert.strictEqual(res.body.data.status, 'ready');
  });

  it('28. Records immutable audit log entries for payment actions', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_audit_test_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const actions = mockAudit.recordedLogs.map((l) => l.action);
    assert.ok(actions.includes(ADMIN_AUDIT_ACTIONS.PAYMENT_INITIATED));
    assert.ok(actions.includes(ADMIN_AUDIT_ACTIONS.PAYMENT_CAPTURED));
    assert.ok(actions.includes(ADMIN_AUDIT_ACTIONS.BOOKING_CONFIRMED));
  });

  // ===========================================================================
  // SECTION 6: ADMINISTRATIVE REFUND & RECONCILIATION MANAGEMENT (T01.3)
  // ===========================================================================

  it('29. Rejects admin refund request when unauthenticated', async () => {
    const dummyPaymentId = new Types.ObjectId().toString();
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${dummyPaymentId}/refund`, {
      body: { reason: 'Unauthenticated attempt' },
    });
    assert.strictEqual(res.status, 401);
  });

  it('30. Rejects admin refund request when user is not an admin', async () => {
    const dummyPaymentId = new Types.ObjectId().toString();
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${dummyPaymentId}/refund`, {
      token: touristToken,
      body: { reason: 'Tourist attempt to refund' },
    });
    assert.strictEqual(res.status, 403);
  });

  it('31. Rejects admin refund request when admin lacks MANAGE_BOOKINGS or HANDLE_DISPUTES permissions', async () => {
    const dummyPaymentId = new Types.ObjectId().toString();
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${dummyPaymentId}/refund`, {
      token: unauthorizedAdminToken,
      body: { reason: 'Unauthorized admin attempt' },
    });
    assert.strictEqual(res.status, 403);
  });

  it('32. Rejects refund request for non-existent payment ID', async () => {
    const nonExistentId = new Types.ObjectId().toString();
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${nonExistentId}/refund`, {
      token: adminToken,
      body: { reason: 'Refund for missing payment' },
    });
    assert.strictEqual(res.status, 404);
  });

  it('33. Rejects refund request for uncaptured payment (e.g. CREATED status)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'Attempt to refund uncaptured payment' },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'PAYMENT_NOT_CAPTURED');
  });

  it('34. Rejects refund when requested refund amount exceeds captured amount', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_excess_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: {
        amountPaise: 99999999, // Exceeds payment amount of 1500000 paise
        reason: 'Attempted excess refund',
      },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_REFUND_AMOUNT');
  });

  it('35. Successfully processes full admin refund on captured payment, records audit log and updates payment/booking', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_admin_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundReason = 'Guest cancelled reservation within free cancellation window';
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: refundReason },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.refundId.startsWith('rfnd_'));
    assert.strictEqual(res.body.data.amountPaise, 1500000);
    assert.strictEqual(res.body.data.payment.status, PAYMENT_STATUSES.REFUNDED);
    assert.strictEqual(res.body.data.payment.refundReason, refundReason);
    assert.ok(res.body.data.payment.refundedAt);

    // Verify stored state
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.REFUNDED);
    assert.strictEqual(storedPayment.refundAmountPaise, 1500000);
    assert.strictEqual(storedPayment.refundReason, refundReason);
    assert.strictEqual(storedPayment.reconciliationStatus, 'REFUNDED');

    // Associated booking updated to CANCELLED
    const storedBooking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(storedBooking.status, BOOKING_STATUSES.CANCELLED);

    // Verify Audit Log
    const refundLogs = mockAudit.recordedLogs.filter((l) => l.action === ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED);
    assert.strictEqual(refundLogs.length, 1);
    assert.strictEqual(refundLogs[0].targetEntityId.toString(), paymentId);
    assert.strictEqual(refundLogs[0].reason, refundReason);
  });

  it('36. Successfully processes refund on late payment flagged with FLAGGED_FOR_MANUAL_REVIEW', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_late_refund_01';

    // Simulate hold expired
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    hold.status = INVENTORY_HOLD_STATUSES.EXPIRED;
    hold.expiresAt = new Date(Date.now() - 5000);

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Check payment is captured with FLAGGED_FOR_MANUAL_REVIEW
    const flaggedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(flaggedPayment.reconciliationStatus, 'FLAGGED_FOR_MANUAL_REVIEW');

    // Admin processes reconciliation refund
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'Hold expired reconciliation refund to guest' },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.payment.status, PAYMENT_STATUSES.REFUNDED);
    assert.strictEqual(res.body.data.payment.reconciliationStatus, 'REFUNDED');

    const updatedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(updatedPayment.status, PAYMENT_STATUSES.REFUNDED);
    assert.strictEqual(updatedPayment.reconciliationStatus, 'REFUNDED');
  });

  it('37. Rejects repeated refund request on already refunded payment (idempotent guard)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_double_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // First refund succeeds
    const firstRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'First refund' },
    });
    assert.strictEqual(firstRes.status, 200);

    // Second refund fails
    const secondRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'Duplicate second refund attempt' },
    });
    assert.strictEqual(secondRes.status, 400);
    assert.strictEqual(secondRes.body.error.code, 'PAYMENT_ALREADY_REFUNDED');
  });

  it('38. Admin can retrieve payment details and list payments by reconciliationStatus', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;

    // Get payment by ID
    const getRes = await dispatchRequest(app, 'GET', `/api/v1/admin/payments/${paymentId}`, {
      token: adminToken,
    });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.data.id, paymentId);

    // List payments
    const listRes = await dispatchRequest(app, 'GET', '/api/v1/admin/payments', {
      token: adminToken,
    });
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.body.data.payments.length >= 1);
  });

  it('39. Rejects refund request when payment record lacks providerPaymentId (400 MISSING_PROVIDER_PAYMENT_ID)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_missing_provider_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Manually simulate a corrupt/missing providerPaymentId on captured payment
    const stored = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    stored.providerPaymentId = null as any;

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'Refund attempt with missing provider ID' },
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'MISSING_PROVIDER_PAYMENT_ID');
  });

  it('40. Successfully processes partial refund, keeps payment in CAPTURED status, and decrements remaining balance', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_partial_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Request partial refund of 500,000 paise (5,000 INR) out of 1,500,000 paise (15,000 INR)
    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: {
        amountPaise: 500000,
        reason: 'Partial goodwill refund for room inconvenience',
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.refund.amountPaise, 500000);
    assert.strictEqual(res.body.data.refund.status, REFUND_STATUSES.PROCESSED);
    assert.strictEqual(res.body.data.payment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(res.body.data.payment.cumulativeRefundedPaise, 500000);
    assert.strictEqual(res.body.data.remainingRefundablePaise, 1000000);

    // Stored payment verified
    const stored = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(stored.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(stored.cumulativeRefundedPaise, 500000);
    assert.strictEqual(stored.reconciliationStatus, 'PARTIALLY_REFUNDED');

    // Associated booking remains CONFIRMED because not fully refunded
    const storedBooking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(storedBooking.status, BOOKING_STATUSES.CONFIRMED);
  });

  it('41. Rejects second partial refund when sum of partial refunds exceeds total captured amount', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_cumul_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // First partial refund of 1,000,000 paise (leaving 500,000 paise)
    const firstRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: {
        amountPaise: 1000000,
        reason: 'First partial refund',
      },
    });
    assert.strictEqual(firstRes.status, 200);

    // Second partial refund of 600,000 paise exceeds remaining 500,000 paise
    const secondRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: {
        amountPaise: 600000,
        reason: 'Excess second partial refund',
      },
    });
    assert.strictEqual(secondRes.status, 400);
    assert.strictEqual(secondRes.body.error.code, 'INVALID_REFUND_AMOUNT');
  });

  it('42. Duplicate idempotencyKey returns existing refund without second provider call (idempotent replay)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_idemp_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const idempotencyKey = 'idemp_key_unique_test_12345';

    // First refund with idempotencyKey
    const firstRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: {
        amountPaise: 300000,
        reason: 'First call with key',
        idempotencyKey,
      },
    });
    assert.strictEqual(firstRes.status, 200);
    const firstRefundId = firstRes.body.data.refund.id;

    // Second refund with the exact same idempotencyKey
    const secondRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: {
        amountPaise: 300000,
        reason: 'Duplicate call with same key',
        idempotencyKey,
      },
    });
    assert.strictEqual(secondRes.status, 200);
    assert.strictEqual(secondRes.body.data.refund.id, firstRefundId);
    assert.ok(
      secondRes.body.message.includes('idempotent replay') ||
      secondRes.body.data.message.includes('idempotent replay'),
    );

    // Check that only 1 refund record exists for this key
    const allRefunds = Array.from(testRefundsRepo.inMemoryRefunds.values());
    const matchingRefunds = allRefunds.filter((r) => r.idempotencyKey === idempotencyKey);
    assert.strictEqual(matchingRefunds.length, 1);
  });

  it('43. Rejects concurrent refund requests when cumulative amount exceeds refundable balance', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_concurrent_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Fire 2 concurrent refund requests for 1,000,000 paise each on 1,500,000 paise balance
    const [res1, res2] = await Promise.all([
      dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
        token: adminToken,
        body: { amountPaise: 1000000, reason: 'Concurrent request 1', idempotencyKey: 'concurrent_1' },
      }),
      dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
        token: adminToken,
        body: { amountPaise: 1000000, reason: 'Concurrent request 2', idempotencyKey: 'concurrent_2' },
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.strictEqual(statuses[0], 200);
    assert.ok(
      [400, 409].includes(statuses[1]),
      `Expected concurrent failure status to be 400 or 409, got ${statuses[1]}`,
    );
  });

  it('44. Preserves REFUND_PENDING payment status when provider returns pending', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_gateway_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Pending gateway settlement refund' },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.refund.status, REFUND_STATUSES.PENDING);
    assert.strictEqual(res.body.data.payment.status, PAYMENT_STATUSES.REFUND_PENDING);

    const stored = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(stored.status, PAYMENT_STATUSES.REFUND_PENDING);
    assert.strictEqual(stored.pendingRefundPaise, 500000);
  });

  it('45. Releases reserved balance and preserves CAPTURED status when provider refund fails', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_fail_refund_gateway_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Failing refund test' },
    });

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error.code, 'PAYMENT_GATEWAY_ERROR');

    const stored = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(stored.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(stored.pendingRefundPaise, 0);
    assert.strictEqual(stored.cumulativeRefundedPaise || 0, 0);
  });

  it('46. Preserves REFUND_PENDING status and reserved balance upon provider network timeout without double refund', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_timeout_refund_gateway_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Timeout refund test' },
    });

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error.code, 'PAYMENT_GATEWAY_TIMEOUT');

    const stored = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(stored.status, PAYMENT_STATUSES.REFUND_PENDING);
    assert.strictEqual(stored.pendingRefundPaise, 500000);
  });

  it('47. Dispatches guest notification and records immutable audit log for refund', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_notif_audit_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const res = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'Notification and audit verification refund' },
    });

    assert.strictEqual(res.status, 200);

    // Verify Notification
    const refundNotifs = mockNotif.publishedEvents.filter(
      (e) => e.notificationType === NOTIFICATION_TYPES.PAYMENT_REFUNDED,
    );
    assert.strictEqual(refundNotifs.length, 1);
    assert.strictEqual(refundNotifs[0].recipientAccountId, touristId.toString());

    // Verify Audit Log
    const refundAudits = mockAudit.recordedLogs.filter(
      (l) => l.action === ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
    );
    assert.ok(refundAudits.length >= 1);
    assert.strictEqual(refundAudits[0].actorAccountId.toString(), adminId.toString());
    assert.strictEqual(refundAudits[0].targetEntityId.toString(), paymentId);
  });

  it('48. Full refund of late captured payment does NOT restore inventory twice (zero phantom inventory restoration)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_late_zero_phantom_01';

    // Simulate hold expired (so hold is EXPIRED and units were already released back to inventory)
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    hold.status = INVENTORY_HOLD_STATUSES.EXPIRED;
    hold.expiresAt = new Date(Date.now() - 5000);

    // Initial inventory had 4 available, 1 held.
    // Expiring the hold returned that 1 unit back, so available units is 5 for all stay dates.
    for (const dateStr of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${dateStr}`)!;
      inv.availableUnits = 5;
    }

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    // Late payment verification captures payment with FLAGGED_FOR_MANUAL_REVIEW
    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Admin processes full refund on the late payment
    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { reason: 'Late payment reconciliation refund to guest' },
    });
    assert.strictEqual(refundRes.status, 200);

    // CRITICAL SECURITY ASSERTION: Available units must remain exactly 5, NOT 6!
    for (const dateStr of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${dateStr}`)!;
      assert.strictEqual(inv.availableUnits, 5, `Inventory on ${dateStr} was incremented beyond initial capacity!`);
    }
  });

  it('49. Admin can list refunds for a payment (GET /api/v1/admin/payments/:paymentId/refunds)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_list_refunds_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Issue two partial refunds
    await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 300000, reason: 'Partial 1' },
    });
    await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 400000, reason: 'Partial 2' },
    });

    const res = await dispatchRequest(app, 'GET', `/api/v1/admin/payments/${paymentId}/refunds`, {
      token: adminToken,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.refunds.length, 2);
    assert.strictEqual(res.body.data.total, 2);
  });

  it('50. Admin can retrieve refund by ID (GET /api/v1/admin/payments/refunds/:refundId)', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_get_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Retrieve test refund' },
    });
    assert.strictEqual(refundRes.status, 200);
    const refundId = refundRes.body.data.refund.id;

    const res = await dispatchRequest(app, 'GET', `/api/v1/admin/payments/refunds/${refundId}`, {
      token: adminToken,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.id, refundId);
    assert.strictEqual(res.body.data.amountPaise, 500000);
  });

  // ===========================================================================
  // SECTION 7: ADVERSARIAL REFUND WEBHOOK PROCESSING (T01.3-R1)
  // ===========================================================================

  const dispatchWebhook = async (body: any, eventId?: string, signature?: string) => {
    const rawStr = JSON.stringify(body);
    const sig =
      signature !== undefined
        ? signature
        : crypto.createHmac('sha256', testWebhookSecret).update(rawStr).digest('hex');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (sig) {
      headers['x-razorpay-signature'] = sig;
    }
    if (eventId) {
      headers['x-razorpay-event-id'] = eventId;
    }
    return dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers,
      body,
    });
  };

  it('51. Valid refund.processed event updates refund to PROCESSED and settles payment balance', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Admin initiates partial refund (5,000 INR) -> pending at gateway
    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Webhook test refund' },
    });
    assert.strictEqual(refundRes.status, 200);
    assert.strictEqual(refundRes.body.data.refund.status, REFUND_STATUSES.PENDING);
    assert.strictEqual(refundRes.body.data.payment.status, PAYMENT_STATUSES.REFUND_PENDING);
    const refundRecordId = refundRes.body.data.refund.id;
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            status: 'processed',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_rfnd_proc_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PROCESSED');

    // Stored refund is PROCESSED
    const storedRefund = testRefundsRepo.inMemoryRefunds.get(refundRecordId)!;
    assert.strictEqual(storedRefund.status, REFUND_STATUSES.PROCESSED);

    // Stored payment is CAPTURED, cumulativeRefundedPaise is 500,000, pending is 0
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
    assert.strictEqual(storedPayment.pendingRefundPaise, 0);

    // Audit log and notification
    const auditLogs = mockAudit.recordedLogs.filter((l) => l.action === ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED);
    assert.ok(auditLogs.length >= 1);
    const notifs = mockNotif.publishedEvents.filter((n) => n.notificationType === NOTIFICATION_TYPES.PAYMENT_REFUNDED);
    assert.ok(notifs.length >= 1);
  });

  it('52. Valid refund.failed event updates refund to FAILED and releases reserved balance', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_02';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Failed refund webhook test' },
    });
    assert.strictEqual(refundRes.status, 200);
    const refundRecordId = refundRes.body.data.refund.id;
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            error_code: 'BANK_ACCOUNT_CLOSED',
            error_description: 'Beneficiary bank account was closed',
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_rfnd_fail_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PROCESSED');

    // Stored refund is FAILED
    const storedRefund = testRefundsRepo.inMemoryRefunds.get(refundRecordId)!;
    assert.strictEqual(storedRefund.status, REFUND_STATUSES.FAILED);
    assert.strictEqual(storedRefund.failureCode, 'BANK_ACCOUNT_CLOSED');

    // Stored payment released reservation: pending is 0, status is CAPTURED
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(storedPayment.pendingRefundPaise, 0);
    assert.strictEqual(storedPayment.cumulativeRefundedPaise || 0, 0);
  });

  it('53. Rejects refund webhook request with invalid HMAC signature', async () => {
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_sig_test_01',
            amount: 500000,
          },
        },
      },
    };
    const res = await dispatchWebhook(webhookBody, 'evt_bad_sig_01', 'bad_signature_digest_0000');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid webhook signature/i);
  });

  it('54. Duplicate refund.processed event with identical event ID is idempotent', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_03';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Duplicate processed webhook test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    // First delivery
    const res1 = await dispatchWebhook(webhookBody, 'evt_dup_proc_test_01');
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.data.status, 'PROCESSED');

    // Duplicate delivery with identical event ID
    const res2 = await dispatchWebhook(webhookBody, 'evt_dup_proc_test_01');
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.status, 'ALREADY_PROCESSED');

    // Balance incremented only once
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
  });

  it('55. Duplicate refund.failed event with identical event ID is idempotent', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_04';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Duplicate failed webhook test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            error_code: 'GATEWAY_ERROR',
          },
        },
      },
    };

    const res1 = await dispatchWebhook(webhookBody, 'evt_dup_fail_test_01');
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.data.status, 'PROCESSED');

    const res2 = await dispatchWebhook(webhookBody, 'evt_dup_fail_test_01');
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.status, 'ALREADY_PROCESSED');

    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.pendingRefundPaise, 0);
  });

  it('56. refund.processed event arriving after refund was already processed returns ALREADY_PROCESSED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_sync_refund_wh_05';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Synchronous admin refund processes immediately in simulated provider
    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Synchronous refund' },
    });
    assert.strictEqual(refundRes.body.data.refund.status, REFUND_STATUSES.PROCESSED);
    const providerRefundId = refundRes.body.data.refundId;

    // Subsequent webhook arrives with a new event ID
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_already_proc_wh_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'ALREADY_PROCESSED');

    // Balance remains 500,000, not doubled
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
  });

  it('57. refund.failed event arriving after refund was already failed returns ALREADY_FAILED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_06';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Test already failed' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            error_code: 'BANK_TIMEOUT',
          },
        },
      },
    };

    // First webhook marks as failed
    await dispatchWebhook(webhookBody, 'evt_first_fail_01');

    // Second webhook with new event ID detects already FAILED
    const res2 = await dispatchWebhook(webhookBody, 'evt_second_fail_02');
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.status, 'ALREADY_FAILED');
  });

  it('58. Conflicting processed and failed events are rejected without corrupting state', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_07';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Conflict test' },
    });
    const providerRefundId = refundRes.body.data.refundId;
    const refundRecordId = refundRes.body.data.refund.id;

    // Step A: Process the refund
    const procBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };
    await dispatchWebhook(procBody, 'evt_proc_first_01');

    // Step B: Now send conflicting refund.failed for the already PROCESSED refund
    const failBody = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            error_code: 'LATE_FAILURE',
          },
        },
      },
    };
    const conflictRes = await dispatchWebhook(failBody, 'evt_conflict_fail_01');
    assert.strictEqual(conflictRes.status, 200);
    assert.strictEqual(conflictRes.body.data.status, 'CONFLICT');

    // Refund MUST remain PROCESSED, cumulativeRefundedPaise MUST remain 500,000
    const storedRefund = testRefundsRepo.inMemoryRefunds.get(refundRecordId)!;
    assert.strictEqual(storedRefund.status, REFUND_STATUSES.PROCESSED);
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
  });

  it('59. Webhook with unknown provider refund ID returns REFUND_NOT_FOUND without mutating balances', async () => {
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_unknown_99999999',
            payment_id: 'pay_nonexistent_99',
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_unknown_rfnd_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'REFUND_NOT_FOUND');
  });

  it('60. Webhook with incorrect provider payment ID returns PAYMENT_MISMATCH', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_08';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Payment mismatch test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    // Send webhook claiming wrong payment ID
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: 'pay_wrong_attacker_id_99',
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_pay_mismatch_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PAYMENT_MISMATCH');

    // Balance remains in pending state
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.pendingRefundPaise, 500000);
    assert.strictEqual(storedPayment.cumulativeRefundedPaise || 0, 0);
  });

  it('61. Webhook with incorrect refund amount returns AMOUNT_MISMATCH', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_09';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Amount mismatch test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 600000, // Tampered amount
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_amt_mismatch_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'AMOUNT_MISMATCH');
  });

  it('62. Webhook with incorrect currency returns CURRENCY_MISMATCH', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_10';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Currency mismatch test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'USD',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_curr_mismatch_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'CURRENCY_MISMATCH');
  });

  it('63. Concurrent duplicate webhook delivery settles balance exactly once', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_11';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Concurrent webhook test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const [resA, resB] = await Promise.all([
      dispatchWebhook(webhookBody, 'evt_conc_wh_A'),
      dispatchWebhook(webhookBody, 'evt_conc_wh_B'),
    ]);

    const statuses = [resA.body.data.status, resB.body.data.status].sort();
    assert.strictEqual(statuses[0], 'ALREADY_PROCESSED');
    assert.strictEqual(statuses[1], 'PROCESSED');

    // Stored balance is incremented only once
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
    assert.strictEqual(storedPayment.pendingRefundPaise, 0);
  });

  it('64. Webhook arriving while synchronous settlement completed returns ALREADY_PROCESSED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_sync_settle_wh_12';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Sync race test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_sync_race_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'ALREADY_PROCESSED');

    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
  });

  it('65. Database failure during settlement updates webhook to FAILED and returns 500', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_13';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'DB failure settlement test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    // Stub settleRefundBalance to throw DB error
    const origSettle = testPaymentsRepo.settleRefundBalance.bind(testPaymentsRepo);
    testPaymentsRepo.settleRefundBalance = async () => {
      throw new InternalServerError('Simulated database connection loss during settlement', 'DB_CONNECTION_ERROR');
    };

    try {
      const webhookBody = {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: providerRefundId,
              payment_id: paymentProviderId,
              amount: 500000,
              currency: 'INR',
            },
          },
        },
      };

      const res = await dispatchWebhook(webhookBody, 'evt_db_fail_settle_01');
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error.code, 'INTERNAL_SERVER_ERROR');

      const webhookEvent = await testPaymentsRepo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, 'evt_db_fail_settle_01');
      assert.strictEqual(webhookEvent?.processingStatus, PAYMENT_WEBHOOK_STATUSES.FAILED);
    } finally {
      testPaymentsRepo.settleRefundBalance = origSettle;
    }
  });

  it('66. Database failure during release updates webhook to FAILED and returns 500', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_14';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'DB failure release test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    // Stub releaseRefundBalance to throw DB error
    const origRelease = testPaymentsRepo.releaseRefundBalance.bind(testPaymentsRepo);
    testPaymentsRepo.releaseRefundBalance = async () => {
      throw new InternalServerError('Simulated database connection loss during release', 'DB_CONNECTION_ERROR');
    };

    try {
      const webhookBody = {
        event: 'refund.failed',
        payload: {
          refund: {
            entity: {
              id: providerRefundId,
              payment_id: paymentProviderId,
              amount: 500000,
              currency: 'INR',
              error_code: 'BANK_REJECTED',
            },
          },
        },
      };

      const res = await dispatchWebhook(webhookBody, 'evt_db_fail_release_01');
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error.code, 'INTERNAL_SERVER_ERROR');

      const webhookEvent = await testPaymentsRepo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, 'evt_db_fail_release_01');
      assert.strictEqual(webhookEvent?.processingStatus, PAYMENT_WEBHOOK_STATUSES.FAILED);
    } finally {
      testPaymentsRepo.releaseRefundBalance = origRelease;
    }
  });

  it('67. Partial refund webhook keeps payment CAPTURED and booking CONFIRMED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_15';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Partial refund webhook test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_partial_wh_01');
    assert.strictEqual(res.status, 200);

    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
    assert.strictEqual(storedPayment.reconciliationStatus, 'PARTIALLY_REFUNDED');

    const storedBooking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(storedBooking.status, BOOKING_STATUSES.CONFIRMED);
  });

  it('68. Full refund webhook transitions payment to REFUNDED and booking to CANCELLED', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_16';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Full refund: 1,500,000 paise
    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 1500000, reason: 'Full refund webhook test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 1500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_full_wh_01');
    assert.strictEqual(res.status, 200);

    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.status, PAYMENT_STATUSES.REFUNDED);
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 1500000);
    assert.strictEqual(storedPayment.reconciliationStatus, 'REFUNDED');

    const storedBooking = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(storedBooking.status, BOOKING_STATUSES.CANCELLED);
  });

  it('69. Full refund webhook on late payment with expired hold does NOT restore inventory twice', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_17';

    // Hold expired before verification -> late payment
    const hold = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    hold.status = INVENTORY_HOLD_STATUSES.EXPIRED;
    hold.expiresAt = new Date(Date.now() - 5000);

    for (const dateStr of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${dateStr}`)!;
      inv.availableUnits = 5;
    }

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 1500000, reason: 'Late payment full refund' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 1500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_late_wh_full_01');
    assert.strictEqual(res.status, 200);

    // CRITICAL SECURITY ASSERTION: Available units must remain exactly 5, NOT 6!
    for (const dateStr of stayDates) {
      const inv = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${dateStr}`)!;
      assert.strictEqual(inv.availableUnits, 5, `Inventory on ${dateStr} was incremented beyond initial capacity!`);
    }
  });

  it('70. Webhook with duplicate event ID delivered three times processes once and deduplicates subsequent deliveries', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_18';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Triple delivery test' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const eventId = 'evt_triple_delivery_test_99';
    const res1 = await dispatchWebhook(webhookBody, eventId);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.data.status, 'PROCESSED');

    const res2 = await dispatchWebhook(webhookBody, eventId);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.status, 'ALREADY_PROCESSED');

    const res3 = await dispatchWebhook(webhookBody, eventId);
    assert.strictEqual(res3.status, 200);
    assert.strictEqual(res3.body.data.status, 'ALREADY_PROCESSED');

    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.cumulativeRefundedPaise, 500000);
  });

  it('71. Rejects refund webhook when provider refund ID is missing (MISSING_PROVIDER_REFUND_ID)', async () => {
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            payment_id: 'pay_dummy_123',
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_missing_rfnd_id_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'FAILED');

    const webhookEvent = await testPaymentsRepo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, 'evt_missing_rfnd_id_01');
    assert.strictEqual(webhookEvent?.processingStatus, PAYMENT_WEBHOOK_STATUSES.FAILED);
    assert.strictEqual(webhookEvent?.failureCode, 'MISSING_PROVIDER_REFUND_ID');
  });

  it('72. Rejects refund webhook when provider payment ID is missing (MISSING_PROVIDER_PAYMENT_ID)', async () => {
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_missing_pay_id_01',
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_missing_pay_id_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'FAILED');

    const webhookEvent = await testPaymentsRepo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, 'evt_missing_pay_id_01');
    assert.strictEqual(webhookEvent?.processingStatus, PAYMENT_WEBHOOK_STATUSES.FAILED);
    assert.strictEqual(webhookEvent?.failureCode, 'MISSING_PROVIDER_PAYMENT_ID');
  });

  it('73. Rejects refund webhook when refund amount is missing or invalid (MISSING_REFUND_AMOUNT)', async () => {
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_invalid_amt_01',
            payment_id: 'pay_valid_01',
            amount: -500, // Invalid negative amount
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_invalid_amt_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'FAILED');

    const webhookEvent = await testPaymentsRepo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, 'evt_invalid_amt_01');
    assert.strictEqual(webhookEvent?.processingStatus, PAYMENT_WEBHOOK_STATUSES.FAILED);
    assert.strictEqual(webhookEvent?.failureCode, 'MISSING_REFUND_AMOUNT');
  });

  it('74. Rejects refund webhook when currency is missing (MISSING_CURRENCY)', async () => {
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_missing_curr_01',
            payment_id: 'pay_valid_02',
            amount: 500000,
            currency: '',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_missing_curr_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'FAILED');

    const webhookEvent = await testPaymentsRepo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, 'evt_missing_curr_01');
    assert.strictEqual(webhookEvent?.processingStatus, PAYMENT_WEBHOOK_STATUSES.FAILED);
    assert.strictEqual(webhookEvent?.failureCode, 'MISSING_CURRENCY');
  });

  it('75. Ambiguous refund lookup rejected: does not match arbitrary pending refund on payment without deterministic ID', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_75';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Ambiguous test' },
    });

    // Send webhook with different providerRefundId and no matching reference
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_completely_unrelated_random',
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_ambiguous_check_01');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'REFUND_NOT_FOUND');

    // Balance must NOT have been settled!
    const storedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(storedPayment.pendingRefundPaise, 500000);
    assert.strictEqual(storedPayment.cumulativeRefundedPaise || 0, 0);
  });

  it('76. Invariant check: settleRefundBalance throws INSUFFICIENT_PENDING_REFUND_BALANCE when pending < amount', async () => {
    const dummyPaymentId = new Types.ObjectId();
    testPaymentsRepo.inMemoryPayments.set(dummyPaymentId.toString(), {
      _id: dummyPaymentId,
      paymentReference: 'KL-PAY-TEST-76',
      bookingId,
      holdId,
      touristAccountId: touristId,
      propertyId,
      amountPaise: 1500000,
      currency: 'INR',
      status: PAYMENT_STATUSES.CAPTURED,
      pendingRefundPaise: 200000, // Only 200,000 reserved
      cumulativeRefundedPaise: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await assert.rejects(
      async () => {
        await testPaymentsRepo.settleRefundBalance(dummyPaymentId, 500000, 'rfnd_inv_76');
      },
      (err: any) => {
        assert.strictEqual(err.code, 'INSUFFICIENT_PENDING_REFUND_BALANCE');
        return true;
      },
    );

    // Assert balance was NOT modified
    const p = testPaymentsRepo.inMemoryPayments.get(dummyPaymentId.toString())!;
    assert.strictEqual(p.pendingRefundPaise, 200000);
    assert.strictEqual(p.cumulativeRefundedPaise, 0);
  });

  it('77. Invariant check: releaseRefundBalance throws INSUFFICIENT_PENDING_REFUND_BALANCE when pending < amount', async () => {
    const dummyPaymentId = new Types.ObjectId();
    testPaymentsRepo.inMemoryPayments.set(dummyPaymentId.toString(), {
      _id: dummyPaymentId,
      paymentReference: 'KL-PAY-TEST-77',
      bookingId,
      holdId,
      touristAccountId: touristId,
      propertyId,
      amountPaise: 1500000,
      currency: 'INR',
      status: PAYMENT_STATUSES.CAPTURED,
      pendingRefundPaise: 100000, // Only 100,000 reserved
      cumulativeRefundedPaise: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await assert.rejects(
      async () => {
        await testPaymentsRepo.releaseRefundBalance(dummyPaymentId, 500000);
      },
      (err: any) => {
        assert.strictEqual(err.code, 'INSUFFICIENT_PENDING_REFUND_BALANCE');
        return true;
      },
    );

    // Assert balance was NOT modified
    const p = testPaymentsRepo.inMemoryPayments.get(dummyPaymentId.toString())!;
    assert.strictEqual(p.pendingRefundPaise, 100000);
  });

  it('78. Invariant check: settleRefundBalance throws EXCESS_CUMULATIVE_REFUND when cumulative + amount > captured', async () => {
    const dummyPaymentId = new Types.ObjectId();
    testPaymentsRepo.inMemoryPayments.set(dummyPaymentId.toString(), {
      _id: dummyPaymentId,
      paymentReference: 'KL-PAY-TEST-78',
      bookingId,
      holdId,
      touristAccountId: touristId,
      propertyId,
      amountPaise: 1500000, // Total captured: 1,500,000
      currency: 'INR',
      status: PAYMENT_STATUSES.CAPTURED,
      pendingRefundPaise: 500000,
      cumulativeRefundedPaise: 1200000, // 1,200,000 + 500,000 = 1,700,000 > 1,500,000
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await assert.rejects(
      async () => {
        await testPaymentsRepo.settleRefundBalance(dummyPaymentId, 500000, 'rfnd_inv_78');
      },
      (err: any) => {
        assert.strictEqual(err.code, 'EXCESS_CUMULATIVE_REFUND');
        return true;
      },
    );

    // Assert balance was NOT modified
    const p = testPaymentsRepo.inMemoryPayments.get(dummyPaymentId.toString())!;
    assert.strictEqual(p.pendingRefundPaise, 500000);
    assert.strictEqual(p.cumulativeRefundedPaise, 1200000);
  });

  it('79. Multi-document transactional rollback on database failure during settlement with successful retry', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_79';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Rollback test 79' },
    });
    const refundId = refundRes.body.data.refund.id;
    const providerRefundId = refundRes.body.data.refundId;

    // Simulate database failure during settlement
    const origSettle = testPaymentsRepo.settleRefundBalance.bind(testPaymentsRepo);
    let failAttempt = true;
    testPaymentsRepo.settleRefundBalance = async (...args: any[]) => {
      if (failAttempt) {
        throw new InternalServerError('Simulated DB disconnect during settlement', 'DB_CONNECTION_ERROR');
      }
      return origSettle(...(args as [any, any, any, any, any]));
    };

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    try {
      const res1 = await dispatchWebhook(webhookBody, 'evt_settle_rollback_fail_79');
      assert.strictEqual(res1.status, 500);

      // Verify transaction atomicity: refund status must NOT be PROCESSED (rolled back to pending/processing)!
      const rolledBackRefund = await testRefundsRepo.findRefundById(refundId);
      assert.strictEqual(rolledBackRefund?.status, REFUND_STATUSES.PENDING);

      // Balance must remain reserved (not settled)
      const rolledBackPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
      assert.strictEqual(rolledBackPayment.pendingRefundPaise, 500000);
      assert.strictEqual(rolledBackPayment.cumulativeRefundedPaise || 0, 0);

      // Now restore DB connection and retry
      failAttempt = false;
      const res2 = await dispatchWebhook(webhookBody, 'evt_settle_rollback_retry_79');
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.status, 'PROCESSED');

      // Verify post-retry success
      const completedRefund = await testRefundsRepo.findRefundById(refundId);
      assert.strictEqual(completedRefund?.status, REFUND_STATUSES.PROCESSED);

      const completedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
      assert.strictEqual(completedPayment.pendingRefundPaise, 0);
      assert.strictEqual(completedPayment.cumulativeRefundedPaise, 500000);
    } finally {
      testPaymentsRepo.settleRefundBalance = origSettle;
    }
  });

  it('80. Multi-document transactional rollback on database failure during release with successful retry', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_80';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Rollback test 80' },
    });
    const refundId = refundRes.body.data.refund.id;
    const providerRefundId = refundRes.body.data.refundId;

    // Simulate database failure during release
    const origRelease = testPaymentsRepo.releaseRefundBalance.bind(testPaymentsRepo);
    let failAttempt = true;
    testPaymentsRepo.releaseRefundBalance = async (...args: any[]) => {
      if (failAttempt) {
        throw new InternalServerError('Simulated DB disconnect during release', 'DB_CONNECTION_ERROR');
      }
      return origRelease(...(args as [any, any, any]));
    };

    const webhookBody = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            error_code: 'BANK_REJECTED',
          },
        },
      },
    };

    try {
      const res1 = await dispatchWebhook(webhookBody, 'evt_release_rollback_fail_80');
      assert.strictEqual(res1.status, 500);

      // Verify transaction atomicity: refund status must NOT be FAILED (rolled back)!
      const rolledBackRefund = await testRefundsRepo.findRefundById(refundId);
      assert.strictEqual(rolledBackRefund?.status, REFUND_STATUSES.PENDING);

      // Balance must remain reserved
      const rolledBackPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
      assert.strictEqual(rolledBackPayment.pendingRefundPaise, 500000);

      // Restore DB connection and retry
      failAttempt = false;
      const res2 = await dispatchWebhook(webhookBody, 'evt_release_rollback_retry_80');
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.status, 'PROCESSED');

      // Verify post-retry success
      const completedRefund = await testRefundsRepo.findRefundById(refundId);
      assert.strictEqual(completedRefund?.status, REFUND_STATUSES.FAILED);

      const completedPayment = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
      assert.strictEqual(completedPayment.pendingRefundPaise, 0);
    } finally {
      testPaymentsRepo.releaseRefundBalance = origRelease;
    }
  });

  it('81. Database failure during refund status transition rolls back without modifying balance', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_81';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Transition fail test 81' },
    });
    const refundId = refundRes.body.data.refund.id;
    const providerRefundId = refundRes.body.data.refundId;

    const origTrans = testRefundsRepo.transitionRefundStatus.bind(testRefundsRepo);
    let failAttempt = true;
    testRefundsRepo.transitionRefundStatus = async (...args: any[]) => {
      if (failAttempt) {
        throw new InternalServerError('Simulated DB failure during status transition', 'DB_CONNECTION_ERROR');
      }
      return origTrans(...(args as [any, any, any, any, any]));
    };

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    try {
      const res1 = await dispatchWebhook(webhookBody, 'evt_trans_fail_81');
      assert.strictEqual(res1.status, 500);

      // Verify refund status untouched and balance untouched
      const refundDoc = await testRefundsRepo.findRefundById(refundId);
      assert.strictEqual(refundDoc?.status, REFUND_STATUSES.PENDING);

      const p = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
      assert.strictEqual(p.pendingRefundPaise, 500000);
      assert.strictEqual(p.cumulativeRefundedPaise || 0, 0);

      // Restore and retry
      failAttempt = false;
      const res2 = await dispatchWebhook(webhookBody, 'evt_trans_retry_81');
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.status, 'PROCESSED');
    } finally {
      testRefundsRepo.transitionRefundStatus = origTrans;
    }
  });

  it('82. Concurrent processed and failed webhooks race: processed succeeds, failed returns CONFLICT without corrupting balance', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_82';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Race test 82' },
    });
    const refundId = refundRes.body.data.refund.id;
    const providerRefundId = refundRes.body.data.refundId;

    const processedBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    const failedBody = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
            error_code: 'GATEWAY_ERROR',
          },
        },
      },
    };

    // First process successfully
    const procRes = await dispatchWebhook(processedBody, 'evt_race_proc_82');
    assert.strictEqual(procRes.status, 200);
    assert.strictEqual(procRes.body.data.status, 'PROCESSED');

    // Conflicting failed event must return CONFLICT
    const failRes = await dispatchWebhook(failedBody, 'evt_race_fail_82');
    assert.strictEqual(failRes.status, 200);
    assert.strictEqual(failRes.body.data.status, 'CONFLICT');

    // Refund remains PROCESSED, balance remains settled
    const refundDoc = await testRefundsRepo.findRefundById(refundId);
    assert.strictEqual(refundDoc?.status, REFUND_STATUSES.PROCESSED);

    const paymentDoc = testPaymentsRepo.inMemoryPayments.get(paymentId)!;
    assert.strictEqual(paymentDoc.cumulativeRefundedPaise, 500000);
    assert.strictEqual(paymentDoc.pendingRefundPaise, 0);
  });

  it('83. Audit log and guest notifications are isolated from aborted transaction', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_83';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 500000, reason: 'Isolation test 83' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const auditCountBefore = mockAudit.recordedLogs.length;
    const notifCountBefore = mockNotif.publishedEvents.length;

    // Stub settle to fail
    const origSettle = testPaymentsRepo.settleRefundBalance.bind(testPaymentsRepo);
    testPaymentsRepo.settleRefundBalance = async () => {
      throw new InternalServerError('Simulated DB error in audit isolation test', 'DB_CONNECTION_ERROR');
    };

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 500000,
            currency: 'INR',
          },
        },
      },
    };

    try {
      const res = await dispatchWebhook(webhookBody, 'evt_audit_isolation_83');
      assert.strictEqual(res.status, 500);

      // Verify NO audit log was added for payment refunded
      const refundedAudits = mockAudit.recordedLogs.slice(auditCountBefore).filter((l) => l.action === ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED);
      assert.strictEqual(refundedAudits.length, 0);

      // Verify NO guest notification was dispatched
      const refundedNotifs = mockNotif.publishedEvents.slice(notifCountBefore).filter((n) => n.notificationType === NOTIFICATION_TYPES.PAYMENT_REFUNDED);
      assert.strictEqual(refundedNotifs.length, 0);
    } finally {
      testPaymentsRepo.settleRefundBalance = origSettle;
    }
  });

  it('84. Full refund booking cancellation transitions booking to CANCELLED and restores consumed hold', async () => {
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${bookingId}/payments`, {
      token: touristToken,
    });
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const paymentProviderId = 'pay_pending_refund_wh_84';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentProviderId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentProviderId,
        razorpay_signature: validSignature,
      },
    });

    // Verify hold was consumed upon verification
    const holdBefore = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    assert.strictEqual(holdBefore.status, INVENTORY_HOLD_STATUSES.CONSUMED);

    // Initial units was 4, hold consumed 1
    const invDay1 = testRoomRepo.inMemoryInventory.get(`${roomTypeId.toString()}:${stayDates[0]}`)!;
    const unitsBeforeRefund = invDay1.availableUnits;

    // Full refund: 1,500,000 paise
    const refundRes = await dispatchRequest(app, 'POST', `/api/v1/admin/payments/${paymentId}/refund`, {
      token: adminToken,
      body: { amountPaise: 1500000, reason: 'Full refund restore test 84' },
    });
    const providerRefundId = refundRes.body.data.refundId;

    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: paymentProviderId,
            amount: 1500000,
            currency: 'INR',
          },
        },
      },
    };

    const res = await dispatchWebhook(webhookBody, 'evt_full_restore_hold_84');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PROCESSED');

    // Booking must be CANCELLED
    const bookingDoc = testBookingsRepo.inMemoryBookings.get(bookingId.toString())!;
    assert.strictEqual(bookingDoc.status, BOOKING_STATUSES.CANCELLED);

    // Hold must be RELEASED
    const holdAfter = testBookingsRepo.inMemoryHolds.get(holdId.toString())!;
    assert.strictEqual(holdAfter.status, INVENTORY_HOLD_STATUSES.RELEASED);

    // Inventory units must have been restored by 1 unit
    const unitsAfterRefund = invDay1.availableUnits;
    assert.strictEqual(unitsAfterRefund, unitsBeforeRefund + 1);
  });
});
