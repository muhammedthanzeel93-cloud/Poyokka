/**
 * Day 27 — Reliability, Concurrency & High-Load Edge Cases Test Suite
 *
 * Covers:
 * 1. Simultaneous Last-Room Booking Race (Concurrency Protection & Anti-Overbooking)
 * 2. Concurrent Refresh Token Rotation (Atomic Rotation & Session Reuse Revocation)
 * 3. Duplicate Webhook Concurrency & Idempotency (Razorpay Duplicate Delivery Protection)
 * 4. Notification Outbox Worker Retry Backoff & Dead-Lettering (Exponential Backoff & Anti-Crash Loop)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  PROPERTY_STATUSES,
  ROOM_STATUSES,
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
  PAYMENT_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import { authService } from '../modules/auth/auth.service';
import { AuthRepository } from '../modules/auth/auth.repository';
import { propertyService } from '../modules/properties/property.service';
import { propertyRepository, PropertyRepository } from '../modules/properties/property.repository';
import { roomService } from '../modules/rooms/room.service';
import { roomRepository, RoomRepository } from '../modules/rooms/room.repository';
import { bookingsService } from '../modules/bookings/bookings.service';
import { BookingsRepository } from '../modules/bookings/bookings.repository';
import { paymentsService } from '../modules/payments/payments.service';
import { webhookService } from '../modules/payments/webhook.service';
import { PaymentsRepository } from '../modules/payments/payments.repository';
import { RazorpayPaymentProvider } from '../modules/payments/providers/razorpay.provider';
import { notificationService } from '../modules/notifications/notification.service';
import { NotificationRepository } from '../modules/notifications/notification.repository';
import { NotificationDeliveryWorker } from '../modules/notifications/delivery/delivery.worker';
import { INotificationProvider } from '../modules/notifications/providers/notification-provider.interface';
import { AuditLogService, RecordAdminAuditInput } from '../modules/admin/audit-log.service';
import { jwtService } from '../shared/security/jwt.service';
import { passwordService } from '../shared/security/password.service';
import { dispatchRequest as rawDispatchRequest } from './testUtils';
import { getTodayInKolkata } from '../modules/bookings/bookings.validation';

// Helper to wrap dispatchRequest with Bearer token injection
const dispatch = async (
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

// ============================================================================
// TEST DOUBLES
// ============================================================================

class InMemoryAuthRepo extends AuthRepository {
  public accounts = new Map<string, any>();
  public accountsById = new Map<string, any>();
  public touristProfiles = new Map<string, any>();
  public businessProfiles = new Map<string, any>();
  public sessions = new Map<string, any>();

  public override async withTransaction<T>(fn: (session?: any) => Promise<T>): Promise<T> {
    return fn({ inTransaction: () => true } as any);
  }

  public override async findAccountByEmail(email: string): Promise<any> {
    return this.accounts.get(email.toLowerCase()) || null;
  }

  public override async findAccountWithPassword(email: string): Promise<any> {
    return this.accounts.get(email.trim().toLowerCase()) || null;
  }

  public override async findAccountById(id: any): Promise<any> {
    return this.accountsById.get(id.toString()) || null;
  }

  public override async updateLastLogin(accountId: any): Promise<void> {
    const acc = this.accountsById.get(accountId.toString());
    if (acc) acc.lastLoginAt = new Date();
  }

  public override async createAccount(data: any): Promise<any> {
    const id = new Types.ObjectId();
    const normalized = data.email.toLowerCase();
    const doc = {
      _id: id,
      id: id.toString(),
      ...data,
      email: normalized,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.accounts.set(normalized, doc);
    this.accountsById.set(id.toString(), doc);
    return doc;
  }

  public override async createTouristProfile(data: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.touristProfiles.set(data.accountId.toString(), doc);
    return doc;
  }

  public override async findTouristProfile(accountId: any): Promise<any> {
    return this.touristProfiles.get(accountId.toString()) || null;
  }

  public async findProfile(accountId: any): Promise<any> {
    return this.touristProfiles.get(accountId.toString()) || this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async findBusinessProfile(accountId: any): Promise<any> {
    return this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async createSession(data: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      ...data,
      revokedAt: null as Date | null,
      revocationReason: null as string | null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isExpired() { return Date.now() >= this.expiresAt.getTime(); },
      isRevoked() { return this.revokedAt !== null; },
      isValid() { return !this.isExpired() && !this.isRevoked(); },
      revoke(reason?: string) {
        this.revokedAt = new Date();
        if (reason) this.revocationReason = reason;
      },
    };
    this.sessions.set(data.refreshTokenHash, doc);
    return doc;
  }

  public override async findSessionByHash(hash: string): Promise<any> {
    return this.sessions.get(hash) || null;
  }

  public override async rotateSessionAtomic(
    oldHash: string,
    newHash: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<any> {
    const oldSession = this.sessions.get(oldHash);
    const now = new Date();
    if (!oldSession || oldSession.revokedAt !== null || oldSession.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    oldSession.revokedAt = now;
    oldSession.revocationReason = 'ROTATED';
    oldSession.replacedByTokenHash = newHash;
    oldSession.lastUsedAt = now;

    const id = new Types.ObjectId();
    const newSession = {
      _id: id,
      accountId: oldSession.accountId,
      refreshTokenHash: newHash,
      familyId,
      replacedByTokenHash: null,
      lastUsedAt: null,
      revocationReason: null as string | null,
      deviceInformation: oldSession.deviceInformation,
      expiresAt,
      revokedAt: null as Date | null,
      createdAt: now,
      updatedAt: now,
      isExpired() { return Date.now() >= this.expiresAt.getTime(); },
      isRevoked() { return this.revokedAt !== null; },
      isValid() { return !this.isExpired() && !this.isRevoked(); },
      revoke(reason?: string) {
        this.revokedAt = new Date();
        if (reason) this.revocationReason = reason;
      },
    };

    this.sessions.set(newHash, newSession);
    return newSession;
  }

  public override async revokeFamilySessions(familyId: string, reason = 'REUSE_DETECTED'): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId) {
        session.revokedAt = now;
        session.revocationReason = reason;
        count++;
      }
    }
    return count;
  }
}

class InMemoryNotificationRepo extends NotificationRepository {
  public notifications = new Map<string, any>();
  public outbox = new Map<string, any>();
  public devices = new Map<string, any>();

  public override async upsertDeviceToken(accountId: any, deviceToken: string, platform: any, deviceId?: string): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      accountId: new Types.ObjectId(accountId.toString()),
      deviceToken,
      platform,
      deviceId,
      isActive: true,
      lastSeenAt: new Date(),
      createdAt: new Date(),
    };
    this.devices.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findActiveTokensByAccountId(accountId: any): Promise<string[]> {
    const idStr = accountId.toString();
    return Array.from(this.devices.values())
      .filter((d) => d.accountId.toString() === idStr && d.isActive)
      .map((d) => d.deviceToken);
  }

  public override async createNotification(params: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      recipientAccountId: new Types.ObjectId(params.recipientAccountId.toString()),
      notificationType: params.notificationType,
      title: params.title,
      body: params.body,
      deliveryStatus: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.set(doc._id.toString(), doc);
    return doc;
  }

  public override async createOutboxRecord(params: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      ...params,
      status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      attempts: 0,
      maxAttempts: params.maxAttempts || 3,
      createdAt: new Date(),
    };
    this.outbox.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findPendingOutboxBatch(batchSize = 50, referenceNow = new Date()): Promise<any[]> {
    return Array.from(this.outbox.values())
      .filter((o) => {
        if (o.status !== NOTIFICATION_DELIVERY_STATUSES.PENDING) return false;
        if (o.nextRetryAt && o.nextRetryAt.getTime() > referenceNow.getTime()) return false;
        return true;
      })
      .slice(0, batchSize);
  }

  public override async updateOutboxResult(outboxId: any, update: any): Promise<any> {
    const doc = this.outbox.get(outboxId.toString());
    if (doc) {
      Object.assign(doc, update);
    }
    return doc;
  }

  public override async updateDeliveryStatus(notificationId: any, status: any): Promise<any> {
    const doc = this.notifications.get(notificationId.toString());
    if (doc) {
      doc.deliveryStatus = status;
    }
    return doc;
  }
}

class FailingNotificationProvider implements INotificationProvider {
  public providerName = 'FIREBASE';
  public attemptsCount = 0;
  public async sendPush(_input: any): Promise<any> {
    this.attemptsCount++;
    return {
      success: false,
      successCount: 0,
      failureCount: 1,
      error: 'FCM 503 Service Unavailable',
      invalidTokens: [],
    };
  }
}

class MockAuditLogService extends AuditLogService {
  public recordedLogs: RecordAdminAuditInput[] = [];
  public override async recordAdminAction(input: RecordAdminAuditInput): Promise<any> {
    this.recordedLogs.push(input);
    return { id: new Types.ObjectId().toString(), ...input, createdAt: new Date().toISOString() };
  }
}

// ============================================================================
// SUITE EXECUTION
// ============================================================================

describe('DAY 27 — Reliability, Concurrency & High-Load Edge Cases', () => {
  let app: any;
  let authRepo: InMemoryAuthRepo;
  let propRepo: PropertyRepository;
  let roomRepo: RoomRepository;
  let bookingsRepo: BookingsRepository;
  let paymentsRepo: PaymentsRepository;
  let notifRepo: InMemoryNotificationRepo;
  let mockAudit: MockAuditLogService;
  let razorpayProvider: RazorpayPaymentProvider;

  const razorpayKeySecret = 'test_secret_32_characters_minimum_len';
  const razorpayWebhookSecret = 'test_webhook_secret_32_chars_min';

  beforeEach(() => {
    resetRateLimiter();

    authRepo = new InMemoryAuthRepo();
    propRepo = propertyRepository;
    propRepo.inMemoryStore.clear();
    roomRepo = roomRepository;
    roomRepo.inMemoryRoomTypes.clear();
    roomRepo.inMemoryInventory.clear();
    bookingsRepo = new BookingsRepository();
    paymentsRepo = new PaymentsRepository();
    notifRepo = new InMemoryNotificationRepo();
    mockAudit = new MockAuditLogService();

    razorpayProvider = new RazorpayPaymentProvider(
      'rzp_test_mock_key_id',
      razorpayKeySecret,
      razorpayWebhookSecret,
      true,
    );

    authMiddleware.setRepository(authRepo);
    authorizationMiddleware.setRepository(authRepo);
    authService.setRepository(authRepo);

    propertyService.setRepository(propRepo);
    propertyService.setAuditService(mockAudit);

    roomService.setRepository(roomRepo);
    roomService.setAuditService(mockAudit);

    bookingsService.setRepository(bookingsRepo);
    bookingsRepo.setRoomRepository(roomRepo);
    bookingsService.setPropertyRepository(propRepo);
    bookingsService.setRoomRepository(roomRepo);
    bookingsService.setAuditService(mockAudit);

    paymentsService.setRepository(paymentsRepo);
    paymentsService.setBookingsRepository(bookingsRepo);
    paymentsService.setPropertyRepository(propRepo);
    paymentsService.setProvider(razorpayProvider);
    paymentsService.setAuditService(mockAudit);

    webhookService.setRepository(paymentsRepo);
    webhookService.setProvider(razorpayProvider);
    webhookService.setAuditService(mockAudit);

    paymentsRepo.setBookingMemoryStores(bookingsRepo.inMemoryBookings, bookingsRepo.inMemoryHolds);
    notificationService.setRepository(notifRepo);

    app = createApp();
  });

  // ==========================================================================
  // 1. Simultaneous Last-Room Booking Race (Anti-Overbooking Concurrency)
  // ==========================================================================
  describe('1. Simultaneous Last-Room Booking Race', () => {
    it('grants hold to exactly one tourist and rejects concurrent request with 409 Conflict', async () => {
      const propId = new Types.ObjectId();
      const roomTypeId = new Types.ObjectId();
      const bizProfileId = new Types.ObjectId();

      propRepo.inMemoryStore.set(propId.toString(), {
        _id: propId,
        businessProfileId: bizProfileId,
        ownerAccountId: new Types.ObjectId(),
        name: 'The Only Cottage Homestay',
        status: PROPERTY_STATUSES.PUBLISHED,
        verificationStatus: 'VERIFIED',
      } as any);

      roomRepo.inMemoryRoomTypes.set(roomTypeId.toString(), {
        _id: roomTypeId,
        propertyId: propId,
        businessProfileId: bizProfileId,
        name: 'Solitary Villa',
        basePrice: 1000000,
        currency: 'INR',
        totalUnits: 1, // EXACTLY 1 UNIT AVAILABLE IN PROPERTY
        status: ROOM_STATUSES.ACTIVE,
      } as any);

      const today = getTodayInKolkata();
      const [y, m, d] = today.split('-').map(Number);
      const night1 = new Date(Date.UTC(y, m - 1, d + 20)).toISOString().split('T')[0];
      const night2 = new Date(Date.UTC(y, m - 1, d + 21)).toISOString().split('T')[0];
      const checkOutDate = new Date(Date.UTC(y, m - 1, d + 22)).toISOString().split('T')[0];
      const checkInDate = night1;

      // Seed exactly 1 unit available across both nights
      roomRepo.inMemoryInventory.set(`${roomTypeId}:${night1}`, {
        _id: new Types.ObjectId(),
        roomTypeId,
        date: night1,
        totalInventory: 1,
        availableUnits: 1,
        heldUnits: 0,
        bookedUnits: 0,
      } as any);
      roomRepo.inMemoryInventory.set(`${roomTypeId}:${night2}`, {
        _id: new Types.ObjectId(),
        roomTypeId,
        date: night2,
        totalInventory: 1,
        availableUnits: 1,
        heldUnits: 0,
        bookedUnits: 0,
      } as any);

      // Create 2 distinct tourists
      const tourist1Id = new Types.ObjectId();
      const tourist2Id = new Types.ObjectId();

      const token1 = jwtService.signAccessToken({
        id: tourist1Id.toString(),
        email: 'tourist1.race@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(tourist1Id.toString(), {
        _id: tourist1Id,
        email: 'tourist1.race@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const token2 = jwtService.signAccessToken({
        id: tourist2Id.toString(),
        email: 'tourist2.race@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(tourist2Id.toString(), {
        _id: tourist2Id,
        email: 'tourist2.race@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      // Both tourists fire hold request at the exact same millisecond
      const [holdRes1, holdRes2] = await Promise.all([
        dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
          token: token1,
          body: {
            propertyId: propId.toString(),
            roomTypeId: roomTypeId.toString(),
            checkInDate,
            checkOutDate,
            numberOfRooms: 1,
            adults: 2,
            children: 0,
            guestDetails: {
              primaryGuestName: 'Racer One',
              email: 'racer1@kerala.voyage',
              phone: '+919846011111',
            },
          },
        }),
        dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
          token: token2,
          body: {
            propertyId: propId.toString(),
            roomTypeId: roomTypeId.toString(),
            checkInDate,
            checkOutDate,
            numberOfRooms: 1,
            adults: 2,
            children: 0,
            guestDetails: {
              primaryGuestName: 'Racer Two',
              email: 'racer2@kerala.voyage',
              phone: '+919846022222',
            },
          },
        }),
      ]);

      const statuses = [holdRes1.status, holdRes2.status].sort();
      assert.deepEqual(
        statuses,
        [201, 409],
        `Expected exactly one 201 Created and one 409 Conflict, received: [${holdRes1.status}, ${holdRes2.status}]`,
      );

      // Authoritative State Check: exactly 1 unit held, 0 available, NEVER negative
      const inv1 = roomRepo.inMemoryInventory.get(`${roomTypeId}:${night1}`);
      const inv2 = roomRepo.inMemoryInventory.get(`${roomTypeId}:${night2}`);
      assert.ok(inv1);
      assert.ok(inv2);
      assert.equal(inv1.availableUnits, 0, 'Available units must not go negative');
      assert.equal(inv2.availableUnits, 0, 'Night 2 available units must be 0');

      const activeHolds = Array.from(bookingsRepo.inMemoryHolds.values()).filter(
        (h) => h.status === INVENTORY_HOLD_STATUSES.ACTIVE,
      );
      assert.equal(activeHolds.length, 1, 'Exactly 1 active hold must be registered');
    });
  });

  // ==========================================================================
  // 2. Concurrent Refresh Token Rotation
  // ==========================================================================
  describe('2. Concurrent Refresh Token Rotation', () => {
    it('handles concurrent refresh requests safely without ghost sessions', async () => {
      const rawPassword = 'Password123!';
      const hash = await passwordService.hash(rawPassword);
      const user = await authRepo.createAccount({
        email: 'concurrent.refresh@kerala.voyage',
        passwordHash: hash,
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });

      const loginRes = await dispatch(app, 'POST', '/api/v1/auth/login', {
        body: { email: user.email, password: rawPassword },
      });
      assert.equal(loginRes.status, 200);
      const originalRefreshToken = loginRes.body.data.refreshToken;

      // Two concurrent refresh requests with the same token
      const [res1, res2] = await Promise.all([
        dispatch(app, 'POST', '/api/v1/auth/refresh', {
          body: { refreshToken: originalRefreshToken },
        }),
        dispatch(app, 'POST', '/api/v1/auth/refresh', {
          body: { refreshToken: originalRefreshToken },
        }),
      ]);

      const statuses = [res1.status, res2.status];
      // One request must succeed with 200, or if both triggered collision, replay detection returned 401
      const successCount = statuses.filter((s) => s === 200).length;
      assert.ok(
        successCount <= 1,
        `At most one concurrent refresh can succeed, received: [${res1.status}, ${res2.status}]`,
      );

      // Ensure that reusing originalRefreshToken again is strictly rejected
      const finalReplay = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
        body: { refreshToken: originalRefreshToken },
      });
      assert.equal(finalReplay.status, 401, 'Replaying rotated token must be rejected with 401');
    });
  });

  // ==========================================================================
  // 3. Duplicate Webhook Concurrency & Deduplication
  // ==========================================================================
  describe('3. Duplicate Webhook Concurrency & Deduplication', () => {
    it('processes concurrent duplicate webhooks idempotently without double-confirming', async () => {
      const bookingId = new Types.ObjectId();
      const holdId = new Types.ObjectId();
      const paymentId = new Types.ObjectId();
      const touristId = new Types.ObjectId();

      bookingsRepo.inMemoryBookings.set(bookingId.toString(), {
        _id: bookingId,
        bookingReference: 'BK-RACE-RZP-01',
        touristAccountId: touristId,
        status: BOOKING_STATUSES.AWAITING_PAYMENT,
      } as any);

      bookingsRepo.inMemoryHolds.set(holdId.toString(), {
        _id: holdId,
        status: INVENTORY_HOLD_STATUSES.ACTIVE,
        expiresAt: new Date(Date.now() + 900000),
      } as any);

      paymentsRepo.inMemoryPayments.set(paymentId.toString(), {
        _id: paymentId,
        bookingId,
        holdId,
        touristAccountId: touristId,
        providerOrderId: 'order_concurrent_rzp_99',
        amountPaise: 3000000,
        status: PAYMENT_STATUSES.PENDING,
      } as any);

      const webhookBody = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_concurrent_captured_99',
              order_id: 'order_concurrent_rzp_99',
              amount: 3000000,
              currency: 'INR',
              status: 'captured',
              created_at: Math.floor(Date.now() / 1000),
            },
          },
        },
      };

      const rawPayload = JSON.stringify(webhookBody);
      const validSig = crypto
        .createHmac('sha256', razorpayWebhookSecret)
        .update(rawPayload)
        .digest('hex');

      // Dispatch 2 identical webhooks concurrently
      const [whRes1, whRes2] = await Promise.all([
        dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
          headers: {
            'x-razorpay-signature': validSig,
            'x-razorpay-event-id': 'evt_concurrent_dup_01',
            'content-type': 'application/json',
          },
          body: webhookBody,
        }),
        dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
          headers: {
            'x-razorpay-signature': validSig,
            'x-razorpay-event-id': 'evt_concurrent_dup_01',
            'content-type': 'application/json',
          },
          body: webhookBody,
        }),
      ]);

      // Both should return 200 OK
      assert.equal(whRes1.status, 200);
      assert.equal(whRes2.status, 200);

      // Verify the booking is confirmed and hold is consumed exactly once
      const booking = bookingsRepo.inMemoryBookings.get(bookingId.toString());
      assert.ok(booking);
      assert.equal(booking.status, BOOKING_STATUSES.CONFIRMED);

      const hold = bookingsRepo.inMemoryHolds.get(holdId.toString());
      assert.ok(hold);
      assert.equal(hold.status, INVENTORY_HOLD_STATUSES.CONSUMED);
    });
  });

  // ==========================================================================
  // 4. Outbox Worker Retry Backoff & Dead-Lettering
  // ==========================================================================
  describe('4. Outbox Worker Retry Backoff & Dead-Lettering', () => {
    it('applies exponential backoff and dead-letters after 3 consecutive failures', async () => {
      const recipientId = new Types.ObjectId();
      const failingProvider = new FailingNotificationProvider();

      // Register device for recipient
      await notifRepo.upsertDeviceToken(
        recipientId,
        'fcm_token_retry_test_999',
        'ANDROID',
        'pixel-retry-test',
      );

      const notif = await notifRepo.createNotification({
        recipientAccountId: recipientId,
        notificationType: 'BOOKING_CONFIRMED',
        title: 'Retry Test Notice',
        body: 'Testing backoff mechanics',
      });

      const outbox = await notifRepo.createOutboxRecord({
        notificationId: notif._id,
        recipientAccountId: recipientId,
        idempotencyKey: `evt_retry_${notif._id}`,
        eventType: 'BOOKING_CONFIRMED',
        payload: { title: 'Retry Test Notice', body: 'Testing backoff mechanics' },
        maxAttempts: 3,
      });

      const worker = new NotificationDeliveryWorker(notifRepo, failingProvider);

      // --- ATTEMPT 1 ---
      const batch1 = await worker.processPendingOutboxBatch(10, new Date());
      assert.equal(batch1.scannedCount, 1);
      assert.equal(batch1.failedCount, 1);
      assert.equal(batch1.deadLetterCount, 0);

      let record = notifRepo.outbox.get(outbox._id.toString());
      assert.equal(record.attempts, 1);
      assert.equal(record.status, NOTIFICATION_DELIVERY_STATUSES.PENDING);
      assert.ok(record.nextRetryAt instanceof Date);

      // Verify next run immediately before nextRetryAt does NOT pick it up
      const prematureRun = await worker.processPendingOutboxBatch(10, new Date(Date.now() - 1000));
      assert.equal(prematureRun.scannedCount, 0, 'Worker must not process items before nextRetryAt');

      // --- ATTEMPT 2 --- (Simulate clock advance past nextRetryAt)
      const batch2 = await worker.processPendingOutboxBatch(10, new Date(Date.now() + 100000));
      assert.equal(batch2.failedCount, 1);
      assert.equal(batch2.deadLetterCount, 0);

      record = notifRepo.outbox.get(outbox._id.toString());
      assert.equal(record.attempts, 2);
      assert.equal(record.status, NOTIFICATION_DELIVERY_STATUSES.PENDING);

      // --- ATTEMPT 3 --- (Reaches maxAttempts = 3 -> DEAD_LETTER)
      const batch3 = await worker.processPendingOutboxBatch(10, new Date(Date.now() + 200000));
      assert.equal(batch3.deadLetterCount, 1, 'Item reaching max retries must be dead-lettered');

      record = notifRepo.outbox.get(outbox._id.toString());
      assert.equal(record.attempts, 3);
      assert.equal(record.status, NOTIFICATION_DELIVERY_STATUSES.DEAD_LETTER);
      assert.ok(record.lastError.includes('FCM 503'));

      // Check notification deliveryStatus marked FAILED
      const finalNotif = notifRepo.notifications.get(notif._id.toString());
      assert.equal(finalNotif.deliveryStatus, NOTIFICATION_DELIVERY_STATUSES.FAILED);

      // --- Subsequent worker runs ignore dead-lettered items (no infinite loops) ---
      const subsequentRun = await worker.processPendingOutboxBatch(10, new Date(Date.now() + 300000));
      assert.equal(subsequentRun.scannedCount, 0, 'Dead-lettered items must never be rescanned');
    });
  });
});
