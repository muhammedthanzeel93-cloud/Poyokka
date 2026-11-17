/**
 * Day 27 — Cross-Module & OWASP API Top 10 Security Test Suite
 *
 * Comprehensive end-to-end security verification covering all 8 modules:
 * - API1: Broken Object Level Authorization (BOLA/IDOR)
 * - API2: Broken Authentication & Token Replay
 * - API3: Broken Object Property Level Authorization / Mass Assignment
 * - API4: Unrestricted Resource Consumption & Rate Limiting
 * - API5: Broken Function Level Authorization (BFLA)
 * - API6: Unrestricted Access to Sensitive Business Flows
 * - API7: Server-Side Request Forgery / Webhook Security
 * - API8: Security Misconfiguration & Data Leakage
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  BUSINESS_TYPES,
  PROPERTY_STATUSES,
  ROOM_CATEGORIES,
  ROOM_STATUSES,
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
  PAYMENT_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { env } from '../config/env';
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
import { authorizationController } from '../modules/authorization/authorization.controller';
import { NotificationRepository } from '../modules/notifications/notification.repository';
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

  public override async createAccount(data: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      ...data,
      email: data.email.toLowerCase(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.accounts.set(doc.email, doc);
    this.accountsById.set(doc._id.toString(), doc);
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

  public async findTouristProfileByAccountId(accountId: any): Promise<any> {
    return this.touristProfiles.get(accountId.toString()) || null;
  }

  public override async findTouristProfile(accountId: any): Promise<any> {
    return this.touristProfiles.get(accountId.toString()) || null;
  }

  public async findProfile(accountId: any, _accountType?: any): Promise<any> {
    return this.touristProfiles.get(accountId.toString()) || this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async findProfileByAccountId(accountId: any): Promise<any> {
    return this.touristProfiles.get(accountId.toString()) || this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async updateLastLogin(accountId: any): Promise<void> {
    const acc = this.accountsById.get(accountId.toString());
    if (acc) acc.lastLoginAt = new Date();
  }

  public override async findBusinessProfile(accountId: any): Promise<any> {
    return this.businessProfiles.get(accountId.toString()) || null;
  }

  public override async createBusinessProfile(data: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      ...data,
      isVerified: data.isVerified ?? false,
      verificationStatus: data.verificationStatus ?? 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.businessProfiles.set(data.accountId.toString(), doc);
    return doc;
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

  public async revokeAllSessionsForAccount(accountId: any): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.accountId.toString() === accountId.toString()) {
        session.revokedAt = new Date();
      }
    }
  }
}

class InMemoryNotificationRepo extends NotificationRepository {
  public notifications = new Map<string, any>();
  public outbox = new Map<string, any>();
  public devices = new Map<string, any>();
  public preferences = new Map<string, any>();

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

  public override async deactivateDeviceById(deviceId: string, accountId: any): Promise<boolean> {
    const idStr = accountId.toString();
    for (const dev of this.devices.values()) {
      if (dev.deviceId === deviceId && dev.accountId.toString() === idStr) {
        dev.isActive = false;
        return true;
      }
    }
    return false;
  }

  public override async createNotification(params: any): Promise<any> {
    const doc = {
      _id: new Types.ObjectId(),
      recipientAccountId: new Types.ObjectId(params.recipientAccountId.toString()),
      notificationType: params.notificationType,
      title: params.title,
      body: params.body,
      dataPayload: params.dataPayload || {},
      relatedResourceType: params.relatedResourceType,
      relatedResourceId: params.relatedResourceId,
      isRead: false,
      readAt: null,
      deliveryStatus: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findNotificationById(notificationId: any): Promise<any> {
    return this.notifications.get(notificationId.toString()) || null;
  }

  public override async countUnreadByAccountId(accountId: any): Promise<number> {
    const idStr = accountId.toString();
    return Array.from(this.notifications.values()).filter(
      (n) => n.recipientAccountId.toString() === idStr && !n.isRead,
    ).length;
  }

  public override async findNotificationsByAccountId(
    accountId: any,
    filter: { isRead?: boolean; page: number; limit: number },
  ): Promise<{ items: any[]; total: number }> {
    const idStr = accountId.toString();
    let all = Array.from(this.notifications.values()).filter(
      (n) => n.recipientAccountId.toString() === idStr,
    );
    if (filter.isRead !== undefined) {
      all = all.filter((n) => n.isRead === filter.isRead);
    }
    return { items: all, total: all.length };
  }

  public override async markAsRead(notificationId: any, accountId: any): Promise<any> {
    const notif = this.notifications.get(notificationId.toString());
    if (!notif || notif.recipientAccountId.toString() !== accountId.toString()) return null;
    notif.isRead = true;
    notif.readAt = new Date();
    return notif;
  }

  public override async deleteNotification(notificationId: any, accountId: any): Promise<boolean> {
    const notif = this.notifications.get(notificationId.toString());
    if (!notif || notif.recipientAccountId.toString() !== accountId.toString()) return false;
    this.notifications.delete(notificationId.toString());
    return true;
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

describe('DAY 27 — Cross-Module & OWASP API Top 10 Security Suite', () => {
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
    authorizationController.setRepository(authRepo);

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
  // OWASP API1: Broken Object Level Authorization (BOLA / IDOR)
  // ==========================================================================
  describe('OWASP API1: Broken Object Level Authorization (BOLA)', () => {
    it('prevents Tourist B from viewing Tourist A booking (404/403 anti-enumeration)', async () => {
      const touristAId = new Types.ObjectId();
      const touristBId = new Types.ObjectId();

      const tokenB = jwtService.signAccessToken({
        id: touristBId.toString(),
        email: 'touristB@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristBId.toString(), {
        _id: touristBId,
        email: 'touristB@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      // Seed a booking owned by Tourist A
      const bookingAId = new Types.ObjectId();
      bookingsRepo.inMemoryBookings.set(bookingAId.toString(), {
        _id: bookingAId,
        bookingReference: 'BK-TOURA-1234',
        touristAccountId: touristAId,
        propertyId: new Types.ObjectId(),
        roomTypeId: new Types.ObjectId(),
        businessProfileId: new Types.ObjectId(),
        checkInDate: '2026-12-01',
        checkOutDate: '2026-12-03',
        numberOfRooms: 1,
        adults: 2,
        children: 0,
        nights: 2,
        status: BOOKING_STATUSES.AWAITING_PAYMENT,
        createdAt: new Date(),
      } as any);

      const res = await dispatch(app, 'GET', `/api/v1/tourist/bookings/${bookingAId}`, {
        token: tokenB,
      });

      // Must be 404 to avoid enumeration of valid IDs
      assert.ok(
        res.status === 404 || res.status === 403,
        `Expected 404/403 BOLA rejection, got ${res.status}`,
      );
    });

    it('prevents Tourist B from initiating payment on Tourist A booking', async () => {
      const touristAId = new Types.ObjectId();
      const touristBId = new Types.ObjectId();

      const tokenB = jwtService.signAccessToken({
        id: touristBId.toString(),
        email: 'touristB@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristBId.toString(), {
        _id: touristBId,
        email: 'touristB@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const bookingAId = new Types.ObjectId();
      bookingsRepo.inMemoryBookings.set(bookingAId.toString(), {
        _id: bookingAId,
        bookingReference: 'BK-TOURA-9999',
        touristAccountId: touristAId,
        propertyId: new Types.ObjectId(),
        roomTypeId: new Types.ObjectId(),
        businessProfileId: new Types.ObjectId(),
        checkInDate: '2026-12-01',
        checkOutDate: '2026-12-03',
        status: BOOKING_STATUSES.AWAITING_PAYMENT,
      } as any);

      const res = await dispatch(app, 'POST', `/api/v1/tourist/bookings/${bookingAId}/payments`, {
        token: tokenB,
      });

      assert.ok(
        res.status === 404 || res.status === 403,
        `Expected 404/403 BOLA rejection, got ${res.status}`,
      );
    });

    it('prevents Tourist B from deleting Tourist A notification (404 anti-enumeration)', async () => {
      const touristAId = new Types.ObjectId();
      const touristBId = new Types.ObjectId();

      const tokenB = jwtService.signAccessToken({
        id: touristBId.toString(),
        email: 'touristB@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristBId.toString(), {
        _id: touristBId,
        email: 'touristB@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const notifA = await notifRepo.createNotification({
        recipientAccountId: touristAId,
        notificationType: 'BOOKING_CONFIRMED',
        title: 'Confidential Notice',
        body: 'Details for Tourist A only',
      });

      const res = await dispatch(app, 'DELETE', `/api/v1/tourist/notifications/${notifA._id}`, {
        token: tokenB,
      });

      assert.equal(res.status, 404, 'Attempting to delete another user notification must return 404');
    });

    it('prevents Business B from adding room types to Business A property (403 Forbidden)', async () => {
      const bizAId = new Types.ObjectId();
      const bizBId = new Types.ObjectId();

      const tokenBizB = jwtService.signAccessToken({
        id: bizBId.toString(),
        email: 'bizB@kerala.voyage',
        accountType: ACCOUNT_TYPES.BUSINESS,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(bizBId.toString(), {
        _id: bizBId,
        email: 'bizB@kerala.voyage',
        accountType: ACCOUNT_TYPES.BUSINESS,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);
      const bizBProfileId = new Types.ObjectId();
      authRepo.businessProfiles.set(bizBId.toString(), {
        _id: bizBProfileId,
        accountId: bizBId,
        businessName: 'Business B Stays',
        businessType: BUSINESS_TYPES.HOMESTAY,
        verificationStatus: 'VERIFIED',
        isVerified: true,
      } as any);

      // Seed property owned by Business A
      const propAId = new Types.ObjectId();
      propRepo.inMemoryStore.set(propAId.toString(), {
        _id: propAId,
        businessProfileId: bizAId,
        ownerAccountId: new Types.ObjectId(),
        name: 'Business A Luxury Villa',
        status: PROPERTY_STATUSES.PUBLISHED,
        verificationStatus: 'VERIFIED',
      } as any);

      const res = await dispatch(app, 'POST', `/api/v1/business/properties/${propAId}/rooms`, {
        token: tokenBizB,
        body: {
          name: 'Unauthorized Room Addition',
          roomCategory: ROOM_CATEGORIES.VILLA,
          maxAdults: 2,
          maxChildren: 1,
          maxOccupancy: 3,
          bedConfiguration: '1 King Bed',
          bedCount: 1,
          basePrice: 500000,
          totalUnits: 1,
          description: 'Unauthorized room attempt on another merchant property',
        },
      });

      assert.ok(
        res.status === 404 || res.status === 403,
        `Modifying another merchant property must return 404 anti-enumeration or 403 Forbidden, got ${res.status}`,
      );
    });
  });

  // ==========================================================================
  // OWASP API2: Broken Authentication
  // ==========================================================================
  describe('OWASP API2: Broken Authentication', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await dispatch(app, 'GET', '/api/v1/tourist/profile');
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });

    it('rejects malformed Bearer tokens with 401 Unauthorized', async () => {
      const res = await dispatch(app, 'GET', '/api/v1/tourist/profile', {
        headers: { authorization: 'Bearer this.is.not.a.valid.jwt.token' },
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });

    it('rejects tampered tokens signed with untrusted secret with 401', async () => {
      const tamperedToken = jwt.sign(
        { id: new Types.ObjectId().toString(), accountType: 'ADMIN' },
        'malicious_untrusted_secret_key_12345678',
        { expiresIn: '1h' },
      );

      const res = await dispatch(app, 'GET', '/api/v1/tourist/profile', {
        headers: { authorization: `Bearer ${tamperedToken}` },
      });
      assert.equal(res.status, 401);
    });

    it('rejects expired JWT tokens with 401 Unauthorized', async () => {
      const expiredToken = jwt.sign(
        { id: new Types.ObjectId().toString(), accountType: 'TOURIST' },
        env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_32_characters_minimum',
        { expiresIn: '-1s' },
      );

      const res = await dispatch(app, 'GET', '/api/v1/tourist/profile', {
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      assert.equal(res.status, 401);
    });

    it('detects refresh token replay, revokes active session family, and returns 401', async () => {
      const rawPassword = 'Password123!';
      const hash = await passwordService.hash(rawPassword);
      const tourist = await authRepo.createAccount({
        email: 'replay.victim@kerala.voyage',
        passwordHash: hash,
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });

      // Initial login creates session
      const loginRes = await dispatch(app, 'POST', '/api/v1/auth/login', {
        body: { email: tourist.email, password: rawPassword },
      });
      assert.equal(loginRes.status, 200);
      const originalRefreshToken = loginRes.body.data.refreshToken;

      // Legitimate rotation 1
      const refreshRes1 = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
        body: { refreshToken: originalRefreshToken },
      });
      assert.equal(refreshRes1.status, 200);
      const newRefreshToken = refreshRes1.body.data.refreshToken;
      assert.notEqual(newRefreshToken, originalRefreshToken);

      // Malicious replay of original refresh token
      const replayRes = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
        body: { refreshToken: originalRefreshToken },
      });
      assert.equal(replayRes.status, 401, 'Replaying rotated refresh token must fail with 401');

      // Subsequent attempt with new token also rejected because family was revoked
      const afterReplayRes = await dispatch(app, 'POST', '/api/v1/auth/refresh', {
        body: { refreshToken: newRefreshToken },
      });
      assert.equal(afterReplayRes.status, 401, 'Compromised token family must be permanently revoked');
    });
  });

  // ==========================================================================
  // OWASP API3: Mass Assignment / Object Property Level Authorization
  // ==========================================================================
  describe('OWASP API3: Mass Assignment Protection', () => {
    it('ignores or rejects privilege escalation fields during tourist registration', async () => {
      const res = await dispatch(app, 'POST', '/api/v1/auth/register/tourist', {
        body: {
          email: 'escalation.attempt@kerala.voyage',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          fullName: 'Attacker Attempt',
          // Malicious mass-assignment payload
          accountType: 'ADMIN',
          role: 'SUPERADMIN',
          isVerified: true,
          status: 'ACTIVE',
        },
      });

      if (res.status === 201) {
        // If accepted, verify escalated fields were completely stripped
        const createdAccount = await authRepo.findAccountByEmail('escalation.attempt@kerala.voyage');
        assert.equal(createdAccount.accountType, ACCOUNT_TYPES.TOURIST);
      } else {
        // If rejected by strict schema validation
        assert.equal(res.status, 400);
      }
    });

    it('rejects direct injection of status: APPROVED on property creation', async () => {
      const bizId = new Types.ObjectId();
      const tokenBiz = jwtService.signAccessToken({
        id: bizId.toString(),
        email: 'honest.biz@kerala.voyage',
        accountType: ACCOUNT_TYPES.BUSINESS,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(bizId.toString(), {
        _id: bizId,
        email: 'honest.biz@kerala.voyage',
        accountType: ACCOUNT_TYPES.BUSINESS,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);
      authRepo.businessProfiles.set(bizId.toString(), {
        _id: new Types.ObjectId(),
        accountId: bizId,
        businessName: 'Honest Stays',
        businessType: BUSINESS_TYPES.HOMESTAY,
        verificationStatus: 'VERIFIED',
        isVerified: true,
      } as any);

      const res = await dispatch(app, 'POST', '/api/v1/business/properties', {
        token: tokenBiz,
        body: {
          name: 'Direct Approval Exploit Villa',
          description: 'Attempting to bypass admin moderation barrier',
          propertyType: 'HOMESTAY',
          address: 'Alappuzha Backwaters',
          district: 'Alappuzha',
          contactEmail: 'exploit@kerala.voyage',
          contactPhone: '+919846011223',
          // Malicious override
          status: 'APPROVED',
          verificationStatus: 'VERIFIED',
        },
      });

      if (res.status === 201) {
        const prop = res.body.data.property || res.body.data;
        assert.notEqual(prop.status, 'APPROVED', 'Property must not be created directly in APPROVED status');
      } else {
        assert.equal(res.status, 400);
      }
    });
  });

  // ==========================================================================
  // OWASP API4: Unrestricted Resource Consumption & Rate Limiting
  // ==========================================================================
  describe('OWASP API4: Resource Consumption & Rate Limiting', () => {
    it('enforces rate limits on repeated login attempts', async () => {
      // 5 allowed attempts, 6th must receive 429 Too Many Requests
      const attempts = [];
      for (let i = 0; i < 6; i++) {
        attempts.push(
          await dispatch(app, 'POST', '/api/v1/auth/login', {
            body: { email: 'brute.force@kerala.voyage', password: 'WrongPassword123!' },
          }),
        );
      }

      const lastAttempt = attempts[attempts.length - 1];
      assert.equal(lastAttempt.status, 429, 'Excessive login requests must trigger 429 Too Many Requests');
      assert.ok(
        lastAttempt.headers['retry-after'] || lastAttempt.headers['Retry-After'],
        'Rate limit response must contain Retry-After header',
      );
    });

    it('rejects unbounded pagination limits exceeding max schema constraints (400)', async () => {
      const res = await dispatch(app, 'GET', '/api/v1/destinations?limit=5000&page=1');
      assert.equal(res.status, 400, 'Unbounded pagination query (limit=5000) must return 400 Bad Request');
    });
  });

  // ==========================================================================
  // OWASP API5: Broken Function Level Authorization (BFLA)
  // ==========================================================================
  describe('OWASP API5: Broken Function Level Authorization (BFLA)', () => {
    it('blocks Tourist from invoking Admin moderation review endpoints (403)', async () => {
      const touristId = new Types.ObjectId();
      const touristToken = jwtService.signAccessToken({
        id: touristId.toString(),
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristId.toString(), {
        _id: touristId,
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const res = await dispatch(
        app,
        'POST',
        `/api/v1/admin/moderation/submissions/${new Types.ObjectId()}/review`,
        {
          token: touristToken,
          body: { action: 'APPROVE', moderationNotes: 'Attacker unauthorized approval' },
        },
      );

      assert.equal(res.status, 403, 'Tourist accessing Admin moderation must return 403 Forbidden');
    });

    it('blocks Tourist from creating business properties (403)', async () => {
      const touristId = new Types.ObjectId();
      const touristToken = jwtService.signAccessToken({
        id: touristId.toString(),
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristId.toString(), {
        _id: touristId,
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const res = await dispatch(app, 'POST', '/api/v1/business/properties', {
        token: touristToken,
        body: {
          name: 'Tourist Impersonating Business',
          description: 'Should fail authorization',
          propertyType: 'HOMESTAY',
          address: 'Kumarakom Pier',
          district: 'Kottayam',
          contactEmail: 'tourist@kerala.voyage',
          contactPhone: '+919846011224',
        },
      });

      assert.equal(res.status, 403, 'Tourist invoking business routes must return 403 Forbidden');
    });

    it('blocks unverified Business from publishing or managing inventory (403)', async () => {
      const unverifiedBizId = new Types.ObjectId();
      const unverifiedBizToken = jwtService.signAccessToken({
        id: unverifiedBizId.toString(),
        email: 'unverified@kerala.voyage',
        accountType: ACCOUNT_TYPES.BUSINESS,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(unverifiedBizId.toString(), {
        _id: unverifiedBizId,
        email: 'unverified@kerala.voyage',
        accountType: ACCOUNT_TYPES.BUSINESS,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);
      authRepo.businessProfiles.set(unverifiedBizId.toString(), {
        _id: new Types.ObjectId(),
        accountId: unverifiedBizId,
        businessName: 'Unverified Homestay',
        businessType: BUSINESS_TYPES.HOMESTAY,
        isVerified: false, // Barrier NOT passed
        verificationStatus: 'PENDING',
      } as any);

      const res = await dispatch(app, 'POST', '/api/v1/business/properties', {
        token: unverifiedBizToken,
        body: {
          name: 'Unverified Property Post',
          description: 'Testing verification barrier',
          propertyType: 'HOMESTAY',
          address: 'Kumarakom Pier',
          district: 'Kottayam',
          contactEmail: 'pier@kerala.voyage',
          contactPhone: '+919846011224',
        },
      });

      assert.equal(res.status, 403, 'Unverified business must be rejected by verification barrier with 403');
    });
  });

  // ==========================================================================
  // OWASP API6: Sensitive Business Flows & Logic Validation
  // ==========================================================================
  describe('OWASP API6: Sensitive Business Flow Integrity', () => {
    it('rejects invalid stay dates (checkOutDate <= checkInDate) with 400 Bad Request', async () => {
      const touristId = new Types.ObjectId();
      const touristToken = jwtService.signAccessToken({
        id: touristId.toString(),
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristId.toString(), {
        _id: touristId,
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const res = await dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
        token: touristToken,
        body: {
          propertyId: new Types.ObjectId().toString(),
          roomTypeId: new Types.ObjectId().toString(),
          checkInDate: '2026-12-05',
          checkOutDate: '2026-12-04', // Invalid checkout before checkin
          numberOfRooms: 1,
          adults: 2,
          children: 0,
          guestDetails: {
            primaryGuestName: 'Invalid Date Guest',
            email: 'invalid@kerala.voyage',
            phone: '+919846012345',
          },
        },
      });

      assert.equal(res.status, 400, 'Checkout date before checkin must return 400 Bad Request');
    });

    it('rejects negative or zero room allocations with 400 Bad Request', async () => {
      const touristId = new Types.ObjectId();
      const touristToken = jwtService.signAccessToken({
        id: touristId.toString(),
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristId.toString(), {
        _id: touristId,
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const res = await dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
        token: touristToken,
        body: {
          propertyId: new Types.ObjectId().toString(),
          roomTypeId: new Types.ObjectId().toString(),
          checkInDate: '2026-12-05',
          checkOutDate: '2026-12-07',
          numberOfRooms: 0, // Invalid room count
          adults: 2,
          children: 0,
          guestDetails: {
            primaryGuestName: 'Zero Room Guest',
            email: 'zero@kerala.voyage',
            phone: '+919846012345',
          },
        },
      });

      assert.equal(res.status, 400, 'Holding 0 rooms must return 400 Bad Request');
    });

    it('enforces server-authoritative pricing (ignores client-supplied price manipulation)', async () => {
      const touristId = new Types.ObjectId();
      const touristToken = jwtService.signAccessToken({
        id: touristId.toString(),
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristId.toString(), {
        _id: touristId,
        email: 'tourist@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const propId = new Types.ObjectId();
      const roomTypeId = new Types.ObjectId();
      const bizProfileId = new Types.ObjectId();

      propRepo.inMemoryStore.set(propId.toString(), {
        _id: propId,
        businessProfileId: bizProfileId,
        ownerAccountId: new Types.ObjectId(),
        name: 'Munnar Mist Haven',
        status: PROPERTY_STATUSES.PUBLISHED,
        verificationStatus: 'VERIFIED',
      } as any);

      roomRepo.inMemoryRoomTypes.set(roomTypeId.toString(), {
        _id: roomTypeId,
        propertyId: propId,
        businessProfileId: bizProfileId,
        name: 'Presidential Suite',
        basePrice: 5000000, // 50,000 INR = 5,000,000 paise
        currency: 'INR',
        totalUnits: 5,
        status: ROOM_STATUSES.ACTIVE,
      } as any);

      // Seed inventory for both nights of the stay (d+10 and d+11)
      const todayKolkata = getTodayInKolkata();
      const [y, m, d] = todayKolkata.split('-').map(Number);
      const night1 = new Date(Date.UTC(y, m - 1, d + 10)).toISOString().split('T')[0];
      const night2 = new Date(Date.UTC(y, m - 1, d + 11)).toISOString().split('T')[0];
      const outDate = new Date(Date.UTC(y, m - 1, d + 12)).toISOString().split('T')[0];
      const checkInDate = night1;
      const checkOutDate = outDate;

      roomRepo.inMemoryInventory.set(`${roomTypeId}:${night1}`, {
        _id: new Types.ObjectId(),
        roomTypeId,
        date: night1,
        totalInventory: 5,
        availableUnits: 5,
        heldUnits: 0,
        bookedUnits: 0,
      } as any);
      roomRepo.inMemoryInventory.set(`${roomTypeId}:${night2}`, {
        _id: new Types.ObjectId(),
        roomTypeId,
        date: night2,
        totalInventory: 5,
        availableUnits: 5,
        heldUnits: 0,
        bookedUnits: 0,
      } as any);

      // 1. Client attempts to inject manipulated price fields in hold body -> rejected by strict schema (400)
      const hackRes = await dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
        token: touristToken,
        body: {
          propertyId: propId.toString(),
          roomTypeId: roomTypeId.toString(),
          checkInDate,
          checkOutDate,
          numberOfRooms: 1,
          adults: 2,
          children: 0,
          guestDetails: {
            primaryGuestName: 'Price Hack Attempt',
            email: 'hacker@kerala.voyage',
            phone: '+919846012345',
          },
          // Injected client price manipulation
          basePricePaise: 100,
          totalPricePaise: 100,
        },
      });
      assert.equal(hackRes.status, 400, 'Client price injection must be rejected by strict schema validation');

      // 2. Legitimate hold calculates price strictly from backend roomType (10,000,000 paise)
      const holdRes = await dispatch(app, 'POST', '/api/v1/tourist/bookings/holds', {
        token: touristToken,
        body: {
          propertyId: propId.toString(),
          roomTypeId: roomTypeId.toString(),
          checkInDate,
          checkOutDate,
          numberOfRooms: 1,
          adults: 2,
          children: 0,
          guestDetails: {
            primaryGuestName: 'Honest Guest',
            email: 'honest@kerala.voyage',
            phone: '+919846012345',
          },
        },
      });

      assert.equal(holdRes.status, 201);
      // Server calculates 2 nights * 5,000,000 = 10,000,000 paise
      const calculatedTotal = holdRes.body.data.booking.priceSnapshot.totalPaise;
      assert.equal(calculatedTotal, 10000000, 'Server must enforce authoritative pricing calculation');
    });
  });

  // ==========================================================================
  // OWASP API7: Server-Side Request Forgery & Webhook Security
  // ==========================================================================
  describe('OWASP API7: Webhook Security & Signature Verification', () => {
    it('rejects webhook requests without x-razorpay-signature header with 400', async () => {
      const res = await dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
        body: { event: 'payment.captured' },
      });
      assert.equal(res.status, 400, 'Missing webhook signature must return 400 Bad Request');
    });

    it('rejects webhook requests with forged or invalid HMAC signature with 400', async () => {
      const payload = JSON.stringify({ event: 'payment.captured', id: 'evt_fake_01' });
      const forgedSig = crypto.createHmac('sha256', 'wrong_secret_12345678').update(payload).digest('hex');

      const res = await dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
        headers: {
          'x-razorpay-signature': forgedSig,
          'content-type': 'application/json',
        },
        body: { event: 'payment.captured', id: 'evt_fake_01' },
      });

      assert.equal(res.status, 400, 'Forged HMAC signature must return 400 Bad Request');
    });

    it('enforces webhook idempotency on duplicate event delivery', async () => {
      const bookingId = new Types.ObjectId();
      const holdId = new Types.ObjectId();
      const paymentId = new Types.ObjectId();
      const touristId = new Types.ObjectId();

      bookingsRepo.inMemoryBookings.set(bookingId.toString(), {
        _id: bookingId,
        bookingReference: 'BK-IDEMP-01',
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
        providerOrderId: 'order_idemp_test_99',
        amountPaise: 2000000,
        status: PAYMENT_STATUSES.PENDING,
      } as any);

      const webhookBody = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_idemp_captured_99',
              order_id: 'order_idemp_test_99',
              amount: 2000000,
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

      // First webhook delivery
      const res1 = await dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
        headers: {
          'x-razorpay-signature': validSig,
          'x-razorpay-event-id': 'evt_idemp_single_id',
          'content-type': 'application/json',
        },
        body: webhookBody,
      });
      assert.equal(res1.status, 200);

      // Duplicate delivery of the exact same event
      const res2 = await dispatch(app, 'POST', '/api/v1/webhooks/razorpay', {
        headers: {
          'x-razorpay-signature': validSig,
          'x-razorpay-event-id': 'evt_idemp_single_id',
          'content-type': 'application/json',
        },
        body: webhookBody,
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.status, 'ALREADY_PROCESSED');
    });
  });

  // ==========================================================================
  // OWASP API8: Security Misconfiguration & Data Leakage
  // ==========================================================================
  describe('OWASP API8: Security Misconfiguration & Data Leakage', () => {
    it('never leaks Argon2id password hash or salt in profile responses', async () => {
      const rawPassword = 'SecretPassword123!';
      const hash = await passwordService.hash(rawPassword);
      const tourist = await authRepo.createAccount({
        email: 'leakage.check@kerala.voyage',
        passwordHash: hash,
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      await authRepo.createTouristProfile({
        accountId: tourist._id,
        fullName: 'Leakage Tester',
      });

      const token = jwtService.signAccessToken({
        id: tourist._id.toString(),
        email: tourist.email,
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });

      const res = await dispatch(app, 'GET', '/api/v1/tourist/profile', { token });
      assert.equal(res.status, 200);

      const jsonStr = JSON.stringify(res.body);
      assert.ok(!jsonStr.includes('passwordHash'), 'Password hash must never be in response');
      assert.ok(!jsonStr.includes('$argon2id$'), 'Argon2id signature must never be in response');
    });

    it('masks FCM device tokens in API responses (never reveals raw token string)', async () => {
      const touristId = new Types.ObjectId();
      const touristToken = jwtService.signAccessToken({
        id: touristId.toString(),
        email: 'fcm.mask@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      });
      authRepo.accountsById.set(touristId.toString(), {
        _id: touristId,
        email: 'fcm.mask@kerala.voyage',
        accountType: ACCOUNT_TYPES.TOURIST,
        status: ACCOUNT_STATUSES.ACTIVE,
      } as any);

      const rawSecretToken = 'fcm_super_sensitive_device_token_raw_data_string_2026';
      const res = await dispatch(app, 'POST', '/api/v1/tourist/devices', {
        token: touristToken,
        body: {
          deviceToken: rawSecretToken,
          platform: 'ANDROID',
          deviceId: 'device-mask-test-01',
        },
      });

      assert.equal(res.status, 201);
      const jsonStr = JSON.stringify(res.body);
      assert.ok(!jsonStr.includes(rawSecretToken), 'Raw device token must never be leaked in API response');
      assert.ok(jsonStr.includes('...'), 'Response must contain masked representation');
    });

    it('returns structured JSON errors for non-existent routes without exposing stack traces', async () => {
      const res = await dispatch(app, 'GET', '/api/v1/non-existent-secret-admin-path');
      assert.equal(res.status, 404);
      assert.equal(res.body.success, false);
      assert.ok(!res.body.stack, 'Stack trace must never be leaked in error responses');
    });
  });
});
