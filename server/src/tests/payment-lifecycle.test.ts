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
  ADMIN_AUDIT_ACTIONS,
  ADMIN_PERMISSIONS,
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
import { PaymentsRepository } from '../modules/payments/payments.repository';
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

describe('DAY 24 — Payment Integration, Payment Lifecycle & Webhook Security', () => {
  let app: any;
  let testAuthRepo: TestAuthRepository;
  let mockAudit: MockAuditService;
  let testBookingsRepo: BookingsRepository;
  let testRoomRepo: RoomRepository;
  let testPropRepo: PropertyRepository;
  let testPaymentsRepo: PaymentsRepository;
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
    testBookingsRepo = new BookingsRepository();
    testRoomRepo = new RoomRepository();
    testPropRepo = new PropertyRepository();
    testPaymentsRepo = new PaymentsRepository();
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
    paymentsService.setBookingsRepository(testBookingsRepo);
    paymentsService.setPropertyRepository(testPropRepo);
    paymentsService.setProvider(testProvider);
    paymentsService.setAuditService(mockAudit);

    webhookService.setRepository(testPaymentsRepo);
    webhookService.setProvider(testProvider);
    webhookService.setAuditService(mockAudit);

    // Link in-memory stores between bookings and payments
    testPaymentsRepo.setBookingMemoryStores(
      testBookingsRepo.inMemoryBookings,
      testBookingsRepo.inMemoryHolds,
    );

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
});
