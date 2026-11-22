import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'crypto';
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
  PAYMENT_STATUSES,
  PAYMENT_PROVIDERS,
  REFUND_STATUSES,
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
  PaymentModel,
  PaymentWebhookEventModel,
} from '../shared/models';
import { RefundModel } from '../modules/payments/refund.model';
import { InternalServerError } from '../shared/errors/AppError';
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
import { paymentsRepository } from '../modules/payments/payments.repository';
import { paymentsService } from '../modules/payments/payments.service';
import { webhookService } from '../modules/payments/webhook.service';
import { RazorpayPaymentProvider } from '../modules/payments/providers/razorpay.provider';
import { getTodayInKolkata } from '../modules/bookings/bookings.validation';

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

describe('DAY 24 — Payment Replica Set Integration Tests (ACID Transactions & Webhooks)', () => {
  let mongodProcess: ChildProcess | null = null;
  let mongoPort: number;
  let mongoUri: string;
  let dbPath: string;
  let app: any;

  const testKeySecret = 'replica_test_secret_key_32chars';
  const testWebhookSecret = 'replica_test_webhook_secret_32chars';
  let testProvider: RazorpayPaymentProvider;

  // Identity
  const touristId = new Types.ObjectId();
  const touristEmail = 'tourist.payment.replica@keralatourism.local';
  let touristToken: string;

  const merchantAccountId = new Types.ObjectId();
  const businessProfileId = new Types.ObjectId();
  const propertyId = new Types.ObjectId();
  const roomTypeId = new Types.ObjectId();

  const today = getTodayInKolkata();
  const [yearStr, monthStr, dayStr] = today.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const d = parseInt(dayStr, 10);

  const checkInDate = new Date(Date.UTC(y, m - 1, d + 15)).toISOString().split('T')[0];
  const checkOutDate = new Date(Date.UTC(y, m - 1, d + 18)).toISOString().split('T')[0]; // 3 nights
  const stayDates = [
    new Date(Date.UTC(y, m - 1, d + 15)).toISOString().split('T')[0],
    new Date(Date.UTC(y, m - 1, d + 16)).toISOString().split('T')[0],
    new Date(Date.UTC(y, m - 1, d + 17)).toISOString().split('T')[0],
  ];

  before(async () => {
    mongoPort = await getAvailablePort();
    dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mongo-payment-replica-'));

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

    mongoUri = `mongodb://127.0.0.1:${mongoPort}/kerala_tourism_payment_replica?replicaSet=rs0`;
    await mongoose.connect(mongoUri);

    testProvider = new RazorpayPaymentProvider(
      'rzp_test_mock_replica_key',
      testKeySecret,
      testWebhookSecret,
      true,
    );

    // Ensure models and services use real database connection
    authMiddleware.setRepository(authRepository);
    authorizationMiddleware.setRepository(authRepository);
    bookingsService.setRepository(bookingsRepository);
    bookingsService.setPropertyRepository(propertyRepository);
    bookingsService.setRoomRepository(roomRepository);
    paymentsService.setRepository(paymentsRepository);
    paymentsService.setBookingsRepository(bookingsRepository);
    paymentsService.setPropertyRepository(propertyRepository);
    paymentsService.setProvider(testProvider);
    webhookService.setRepository(paymentsRepository);
    webhookService.setProvider(testProvider);

    app = createApp();

    // Seed Tourist
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

    // Seed Merchant Account & Business Profile
    await AccountModel.create({
      _id: merchantAccountId,
      email: 'merchant.payment.replica@keralatourism.local',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaA',
      accountType: ACCOUNT_TYPES.BUSINESS,
      status: ACCOUNT_STATUSES.ACTIVE,
    });
    await BusinessProfileModel.create({
      _id: businessProfileId,
      accountId: merchantAccountId,
      businessName: 'Munnar Tea Hills Resort',
      businessType: BUSINESS_TYPES.RESORT,
      contactNumber: '+919876543210',
      address: {
        line1: 'Pallivasal Tea Estate',
        city: 'Munnar',
        postalCode: '685612',
        district: 'Idukki',
      },
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    });

    // Seed Published Property
    await PropertyModel.create({
      _id: propertyId,
      businessProfileId,
      accountId: merchantAccountId,
      createdBy: merchantAccountId,
      updatedBy: merchantAccountId,
      name: 'Munnar Tea Hills Resort',
      slug: 'munnar-tea-hills-resort',
      propertyType: 'RESORT',
      shortDescription: 'Luxury tea estate resort',
      description: 'A beautiful luxury resort nestled in the tea hills of Munnar.',
      address: 'Pallivasal Tea Estate Road',
      district: 'Idukki',
      city: 'Munnar',
      state: 'Kerala',
      postalCode: '685612',
      location: {
        type: 'Point',
        coordinates: [77.06, 10.088],
      },
      checkInTime: '14:00',
      checkOutTime: '11:00',
      contactEmail: 'contact@munnarteahills.com',
      contactPhone: '+919876543210',
      facilities: ['WIFI', 'RESTAURANT', 'SWIMMING_POOL'],
      starRating: 5,
      status: PROPERTY_STATUSES.PUBLISHED,
      supportsHourly: false,
      supportsDaily: true,
      publishedAt: new Date(),
    });

    // Seed Room Type
    await RoomTypeModel.create({
      _id: roomTypeId,
      propertyId,
      businessProfileId,
      accountId: merchantAccountId,
      name: 'Valley View Cottage',
      slug: 'valley-view-cottage',
      roomCategory: ROOM_CATEGORIES.COTTAGE,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
      bedConfiguration: '1 King Bed',
      bedCount: 1,
      roomSize: 500,
      roomSizeUnit: 'SQ_FT',
      facilities: ['WIFI', 'AIR_CONDITIONING', 'BALCONY'],
      basePrice: 600000, // 6000.00 INR in paise per night
      currency: 'INR',
      pricingUnit: ROOM_PRICING_UNITS.PER_NIGHT,
      status: ROOM_STATUSES.ACTIVE,
      totalUnits: 5,
    });

    // Seed Daily Inventory
    for (const dateStr of stayDates) {
      await RoomInventoryModel.create({
        propertyId,
        roomTypeId,
        businessProfileId,
        date: new Date(`${dateStr}T00:00:00.000Z`),
        totalUnits: 5,
        availableUnits: 4,
        blockedUnits: 0,
        maintenanceUnits: 0,
      });
    }

    await Promise.all([
      BookingModel.init(),
      InventoryHoldModel.init(),
      PaymentModel.init(),
      PaymentWebhookEventModel.init(),
      RoomInventoryModel.init(),
    ]);
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongodProcess) {
      mongodProcess.kill('SIGKILL');
    }
    try {
      fs.rmSync(dbPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  beforeEach(async () => {
    resetRateLimiter();
    await PaymentModel.deleteMany({});
    await PaymentWebhookEventModel.deleteMany({});
    await BookingModel.deleteMany({});
    await InventoryHoldModel.deleteMany({});
  });

  // Helper to seed a fresh active booking & hold on MongoDB
  const seedBookingAndHold = async () => {
    const bId = new Types.ObjectId();
    const hId = new Types.ObjectId();
    const bRef = `BKG-${Date.now().toString(36).toUpperCase()}`;

    const holdDoc = await InventoryHoldModel.create({
      _id: hId,
      bookingId: bId,
      roomTypeId,
      propertyId,
      businessProfileId,
      touristAccountId: touristId,
      numberOfRooms: 1,
      stayDates,
      status: INVENTORY_HOLD_STATUSES.ACTIVE,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
    });

    const bookingDoc = await BookingModel.create({
      _id: bId,
      bookingReference: bRef,
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
      holdId: hId,
      priceSnapshot: {
        basePricePaise: 600000,
        basePriceInr: 6000,
        numberOfRooms: 1,
        numberOfNights: 3,
        dailyBreakdown: stayDates.map((date) => ({ date, pricePaise: 600000, priceInr: 6000 })),
        subtotalPaise: 1800000,
        subtotalInr: 18000,
        taxesPaise: 0,
        taxesInr: 0,
        totalPaise: 1800000,
        totalInr: 18000,
        currency: 'INR',
      },
      guestDetails: {
        primaryGuestName: 'Kavya Menon',
        email: 'kavya.menon@example.com',
        phone: '+919876543211',
      },
    });

    return { booking: bookingDoc, hold: holdDoc };
  };

  it('1. Executes atomic ACID transaction on MongoDB for payment capture, hold consumption, and booking confirmation', async () => {
    const { booking, hold } = await seedBookingAndHold();

    // 1. Initiate payment
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${booking._id}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(initRes.status, 201);
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_replica_acid_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${providerPaymentId}`)
      .digest('hex');

    // 2. Verify payment
    const verifyRes = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: providerPaymentId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.body.data.isConfirmed, true);

    // 3. Directly inspect real documents in MongoDB
    const persistedPayment = await PaymentModel.findById(paymentId);
    assert.ok(persistedPayment);
    assert.strictEqual(persistedPayment.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(persistedPayment.providerPaymentId, providerPaymentId);
    assert.ok(persistedPayment.paidAt);

    const persistedHold = await InventoryHoldModel.findById(hold._id);
    assert.ok(persistedHold);
    assert.strictEqual(persistedHold.status, INVENTORY_HOLD_STATUSES.CONSUMED);

    const persistedBooking = await BookingModel.findById(booking._id);
    assert.ok(persistedBooking);
    assert.strictEqual(persistedBooking.status, BOOKING_STATUSES.CONFIRMED);
    assert.ok(persistedBooking.confirmedAt);
    assert.strictEqual(persistedBooking.paymentId?.toString(), paymentId);
  });

  it('2. Ingests webhook on MongoDB replica set and updates PaymentWebhookEventModel with PROCESSED', async () => {
    const { booking } = await seedBookingAndHold();

    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${booking._id}/payments`, {
      token: touristToken,
    });
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_replica_webhook_01';

    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: orderId,
            amount: 1800000,
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

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_replica_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);

    // Verify webhook event document persisted in MongoDB
    const eventDoc = await PaymentWebhookEventModel.findOne({ providerEventId: 'evt_replica_01' });
    assert.ok(eventDoc);
    assert.strictEqual(eventDoc.processingStatus, 'PROCESSED');
    assert.strictEqual(eventDoc.provider, PAYMENT_PROVIDERS.RAZORPAY);
  });

  it('3. Concurrency Race: Simultaneous checkout verification and webhook delivery confirm booking exactly once', async () => {
    const { booking } = await seedBookingAndHold();

    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${booking._id}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(initRes.status, 201);
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_concurrent_race_99';

    // 1. Signature for checkout callback
    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${providerPaymentId}`)
      .digest('hex');

    // 2. Webhook payload
    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: orderId,
            amount: 1800000,
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

    // Fire both simultaneously
    const [verifyRes, webhookRes] = await Promise.all([
      dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
        token: touristToken,
        body: {
          paymentId,
          razorpay_order_id: orderId,
          razorpay_payment_id: providerPaymentId,
          razorpay_signature: validSignature,
        },
      }),
      dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
        headers: {
          'x-razorpay-signature': validWebhookSig,
          'x-razorpay-event-id': 'evt_concurrent_race_99',
          'content-type': 'application/json',
        },
        body: webhookBody,
      }),
    ]);

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(webhookRes.status, 200);

    // Verify final state in database: strictly one confirmation
    const finalBooking = await BookingModel.findById(booking._id);
    assert.ok(finalBooking);
    assert.strictEqual(finalBooking.status, BOOKING_STATUSES.CONFIRMED);

    const finalPayment = await PaymentModel.findById(paymentId);
    assert.ok(finalPayment);
    assert.strictEqual(finalPayment.status, PAYMENT_STATUSES.CAPTURED);
  });

  it('4. Late Payment Race on Replica Set: Expired hold is not consumed and booking is not confirmed', async () => {
    const { booking, hold } = await seedBookingAndHold();

    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${booking._id}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(initRes.status, 201);
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_late_replica_55';

    // Simulate hold expiring in MongoDB
    await InventoryHoldModel.updateOne(
      { _id: hold._id },
      { $set: { status: INVENTORY_HOLD_STATUSES.EXPIRED, expiresAt: new Date(Date.now() - 5000) } },
    );
    await BookingModel.updateOne(
      { _id: booking._id },
      { $set: { status: BOOKING_STATUSES.EXPIRED } },
    );

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${providerPaymentId}`)
      .digest('hex');

    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: providerPaymentId,
        razorpay_signature: validSignature,
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.isConfirmed, false);

    // Verify MongoDB state: booking remains EXPIRED, hold remains EXPIRED
    const checkBooking = await BookingModel.findById(booking._id);
    assert.strictEqual(checkBooking?.status, BOOKING_STATUSES.EXPIRED);

    const checkHold = await InventoryHoldModel.findById(hold._id);
    assert.strictEqual(checkHold?.status, INVENTORY_HOLD_STATUSES.EXPIRED);

    // Payment marked as CAPTURED with reconciliation flag
    const checkPayment = await PaymentModel.findById(paymentId);
    assert.strictEqual(checkPayment?.status, PAYMENT_STATUSES.CAPTURED);
    assert.strictEqual(checkPayment?.reconciliationStatus, 'FLAGGED_FOR_MANUAL_REVIEW');
    assert.strictEqual(checkPayment?.failureCode, 'LATE_PAYMENT_HOLD_EXPIRED');
  });

  it('5. Real Replica Set Multi-Document Transaction: Atomic commit on processed refund across collections', async () => {
    const { booking } = await seedBookingAndHold();

    // 1. Initiate and capture payment in MongoDB
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${booking._id}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(initRes.status, 201);
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_replica_refund_01';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${providerPaymentId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: providerPaymentId,
        razorpay_signature: validSignature,
      },
    });

    // 2. Persist a PENDING refund and reserve pending balance in MongoDB
    const refundRef = `RFND-${Date.now()}`;
    const providerRefundId = 'rfnd_replica_proc_01';
    const refundDoc = await RefundModel.create({
      refundReference: refundRef,
      paymentId: new Types.ObjectId(paymentId),
      bookingId: booking._id,
      touristAccountId: touristId,
      adminAccountId: new Types.ObjectId(),
      provider: PAYMENT_PROVIDERS.RAZORPAY,
      providerPaymentId,
      providerRefundId,
      amountPaise: 600000,
      currency: 'INR',
      status: REFUND_STATUSES.PENDING,
      reason: 'Replica set transaction commit test',
    });

    await PaymentModel.updateOne(
      { _id: new Types.ObjectId(paymentId) },
      { $set: { pendingRefundPaise: 600000, cumulativeRefundedPaise: 0 } },
    );

    // 3. Dispatch refund.processed webhook
    const webhookBody = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: providerRefundId,
            payment_id: providerPaymentId,
            amount: 600000,
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

    const res = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'x-razorpay-event-id': 'evt_replica_refund_proc_01',
        'content-type': 'application/json',
      },
      body: webhookBody,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PROCESSED');

    // 4. Verify atomic MongoDB persistence across collections
    const persistedRefund = await RefundModel.findById(refundDoc._id);
    assert.ok(persistedRefund);
    assert.strictEqual(persistedRefund.status, REFUND_STATUSES.PROCESSED);
    assert.ok(persistedRefund.processedAt);

    const persistedPayment = await PaymentModel.findById(paymentId);
    assert.ok(persistedPayment);
    assert.strictEqual(persistedPayment.pendingRefundPaise, 0);
    assert.strictEqual(persistedPayment.cumulativeRefundedPaise, 600000);

    const eventDoc = await PaymentWebhookEventModel.findOne({ providerEventId: 'evt_replica_refund_proc_01' });
    assert.ok(eventDoc);
    assert.strictEqual(eventDoc.processingStatus, 'PROCESSED');
  });

  it('6. Real Replica Set Multi-Document Transaction: Rollback on database failure aborts across collections', async () => {
    const { booking } = await seedBookingAndHold();

    // 1. Initiate and capture payment in MongoDB
    const initRes = await dispatchRequest(app, 'POST', `/api/v1/tourist/bookings/${booking._id}/payments`, {
      token: touristToken,
    });
    assert.strictEqual(initRes.status, 201);
    const paymentId = initRes.body.data.payment.id;
    const orderId = initRes.body.data.checkoutData.orderId;
    const providerPaymentId = 'pay_replica_rollback_02';

    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${providerPaymentId}`)
      .digest('hex');

    await dispatchRequest(app, 'POST', '/api/v1/tourist/payments/verify', {
      token: touristToken,
      body: {
        paymentId,
        razorpay_order_id: orderId,
        razorpay_payment_id: providerPaymentId,
        razorpay_signature: validSignature,
      },
    });

    // 2. Persist a PENDING refund and reserve pending balance in MongoDB
    const refundRef = `RFND-${Date.now()}`;
    const providerRefundId = 'rfnd_replica_rollback_02';
    const refundDoc = await RefundModel.create({
      refundReference: refundRef,
      paymentId: new Types.ObjectId(paymentId),
      bookingId: booking._id,
      touristAccountId: touristId,
      adminAccountId: new Types.ObjectId(),
      provider: PAYMENT_PROVIDERS.RAZORPAY,
      providerPaymentId,
      providerRefundId,
      amountPaise: 600000,
      currency: 'INR',
      status: REFUND_STATUSES.PENDING,
      reason: 'Replica set transaction abort test',
    });

    await PaymentModel.updateOne(
      { _id: new Types.ObjectId(paymentId) },
      { $set: { pendingRefundPaise: 600000, cumulativeRefundedPaise: 0 } },
    );

    // 3. Stub settleRefundBalance on paymentsRepository to throw an error inside the transaction
    const origSettle = paymentsRepository.settleRefundBalance.bind(paymentsRepository);
    let failAttempt = true;
    paymentsRepository.settleRefundBalance = async (...args: any[]) => {
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
            payment_id: providerPaymentId,
            amount: 600000,
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

    try {
      // 4. Webhook returns 500 on transaction failure
      const res1 = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
        headers: {
          'x-razorpay-signature': validWebhookSig,
          'x-razorpay-event-id': 'evt_replica_rollback_fail_02',
          'content-type': 'application/json',
        },
        body: webhookBody,
      });

      assert.strictEqual(res1.status, 500);

      // 5. CRITICAL ACID ASSERTION: In MongoDB, the aborted transaction rolled back the refund document!
      // Refund status must still be PENDING (NOT PROCESSED)!
      const uncommittedRefund = await RefundModel.findById(refundDoc._id);
      assert.ok(uncommittedRefund);
      assert.strictEqual(uncommittedRefund.status, REFUND_STATUSES.PENDING);

      // In MongoDB, the payment document must still have pendingRefundPaise = 600000, cumulative = 0
      const uncommittedPayment = await PaymentModel.findById(paymentId);
      assert.ok(uncommittedPayment);
      assert.strictEqual(uncommittedPayment.pendingRefundPaise, 600000);
      assert.strictEqual(uncommittedPayment.cumulativeRefundedPaise, 0);

      // 6. Restore DB and retry webhook -> succeeds atomically
      failAttempt = false;
      const res2 = await dispatchRequest(app, 'POST', '/api/v1/webhooks/razorpay', {
        headers: {
          'x-razorpay-signature': validWebhookSig,
          'x-razorpay-event-id': 'evt_replica_rollback_retry_02',
          'content-type': 'application/json',
        },
        body: webhookBody,
      });

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.data.status, 'PROCESSED');

      // 7. Verify post-retry committed state in MongoDB
      const finalRefund = await RefundModel.findById(refundDoc._id);
      assert.ok(finalRefund);
      assert.strictEqual(finalRefund.status, REFUND_STATUSES.PROCESSED);

      const finalPayment = await PaymentModel.findById(paymentId);
      assert.ok(finalPayment);
      assert.strictEqual(finalPayment.pendingRefundPaise, 0);
      assert.strictEqual(finalPayment.cumulativeRefundedPaise, 600000);
    } finally {
      paymentsRepository.settleRefundBalance = origSettle;
    }
  });
});
