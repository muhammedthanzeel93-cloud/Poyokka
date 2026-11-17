import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  DEVICE_PLATFORMS,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import { AuthRepository } from '../modules/auth/auth.repository';
import { NotificationRepository } from '../modules/notifications/notification.repository';
import { NotificationService, notificationService } from '../modules/notifications/notification.service';
import { NotificationController } from '../modules/notifications/notification.controller';
import { IAccountDocument } from '../shared/models';
import { jwtService } from '../shared/security/jwt.service';
import { dispatchRequest as rawDispatchRequest } from './testUtils';

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

// In-Memory Test Auth Repository
class TestAuthRepository extends AuthRepository {
  public accounts: Map<string, any> = new Map();

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
}

// In-Memory Test Notification Repository
class InMemoryNotificationRepository extends NotificationRepository {
  public devices: Map<string, any> = new Map();
  public notifications: Map<string, any> = new Map();
  public outbox: Map<string, any> = new Map();
  public preferences: Map<string, any> = new Map();

  public async upsertDeviceToken(
    accountId: Types.ObjectId | string,
    deviceToken: string,
    platform: any,
    deviceId?: string,
  ): Promise<any> {
    const accIdStr = accountId.toString();
    const tokenKey = deviceToken.trim();

    // Check if device token already exists
    let existingDoc: any = null;
    for (const doc of this.devices.values()) {
      if (doc.deviceToken === tokenKey) {
        existingDoc = doc;
        break;
      }
    }

    if (existingDoc) {
      existingDoc.accountId = new Types.ObjectId(accIdStr);
      existingDoc.platform = platform;
      existingDoc.deviceId = deviceId ? deviceId.trim() : existingDoc.deviceId;
      existingDoc.isActive = true;
      existingDoc.lastSeenAt = new Date();
      existingDoc.invalidatedAt = null;
      existingDoc.invalidReason = undefined;
      return existingDoc;
    }

    const newDoc = {
      _id: new Types.ObjectId(),
      accountId: new Types.ObjectId(accIdStr),
      deviceToken: tokenKey,
      platform,
      provider: 'FCM',
      deviceId: deviceId ? deviceId.trim() : undefined,
      isActive: true,
      lastSeenAt: new Date(),
      invalidatedAt: null,
      invalidReason: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.devices.set(newDoc._id.toString(), newDoc);
    return newDoc;
  }

  public async findDevicesByAccountId(accountId: Types.ObjectId | string): Promise<any[]> {
    const accIdStr = accountId.toString();
    return Array.from(this.devices.values())
      .filter((d) => d.accountId.toString() === accIdStr && d.isActive)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  public async deactivateDeviceById(
    deviceId: string | Types.ObjectId,
    accountId: Types.ObjectId | string,
    reason: string = 'USER_UNREGISTERED',
  ): Promise<boolean> {
    const devIdStr = deviceId.toString();
    const accIdStr = accountId.toString();

    const device = this.devices.get(devIdStr);
    if (!device || device.accountId.toString() !== accIdStr || !device.isActive) {
      return false;
    }

    device.isActive = false;
    device.invalidatedAt = new Date();
    device.invalidReason = reason;
    return true;
  }

  public async deactivateTokens(tokens: string[], reason: string = 'FCM_UNREGISTERED'): Promise<number> {
    let count = 0;
    const tokenSet = new Set(tokens);
    for (const dev of this.devices.values()) {
      if (tokenSet.has(dev.deviceToken) && dev.isActive) {
        dev.isActive = false;
        dev.invalidatedAt = new Date();
        dev.invalidReason = reason;
        count++;
      }
    }
    return count;
  }
}

describe('Device Registration & Management Security Suite (Day 26)', () => {
  let app: any;
  let testAuthRepo: TestAuthRepository;
  let testNotifRepo: InMemoryNotificationRepository;
  let testNotifService: NotificationService;
  let testNotifController: NotificationController;

  const touristA = {
    _id: new Types.ObjectId(),
    email: 'tourist.a@example.com',
    accountType: ACCOUNT_TYPES.TOURIST,
    status: ACCOUNT_STATUSES.ACTIVE,
  };

  const touristB = {
    _id: new Types.ObjectId(),
    email: 'tourist.b@example.com',
    accountType: ACCOUNT_TYPES.TOURIST,
    status: ACCOUNT_STATUSES.ACTIVE,
  };

  let tokenA: string;

  beforeEach(() => {
    resetRateLimiter();

    testAuthRepo = new TestAuthRepository();
    testAuthRepo.accounts.set(touristA._id.toString(), touristA);
    testAuthRepo.accounts.set(touristB._id.toString(), touristB);

    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);

    testNotifRepo = new InMemoryNotificationRepository();
    notificationService.setRepository(testNotifRepo);
    testNotifService = new NotificationService(testNotifRepo);
    testNotifController = new NotificationController(testNotifService);
    void testNotifController;

    // Wire up app
    app = createApp();

    tokenA = jwtService.signAccessToken({
      id: touristA._id.toString(),
      email: touristA.email,
      accountType: touristA.accountType as any,
      status: touristA.status as any,
    });
  });

  it('1. POST /api/v1/tourist/devices - Successfully registers valid device token with masking', async () => {
    const rawToken = 'fcm_valid_device_token_abc123456789xyz_long_token';
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/devices', {
      token: tokenA,
      body: {
        deviceToken: rawToken,
        platform: DEVICE_PLATFORMS.ANDROID,
        deviceId: 'pixel_7_pro_hw_id',
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.message, 'Device registered successfully');
    assert.equal(res.body.data.device.platform, 'ANDROID');
    assert.equal(res.body.data.device.isActive, true);

    // Verify token masking: full raw token must NEVER be exposed
    assert.notEqual(res.body.data.device.maskedToken, rawToken);
    assert.match(res.body.data.device.maskedToken, /^fcm_.*\.\.\..*/);
  });

  it('2. POST /api/v1/tourist/devices - Duplicate token registration is idempotent and updates lastSeenAt', async () => {
    const rawToken = 'fcm_idempotent_duplicate_token_12345678';
    const res1 = await dispatchRequest(app, 'POST', '/api/v1/tourist/devices', {
      token: tokenA,
      body: {
        deviceToken: rawToken,
        platform: DEVICE_PLATFORMS.IOS,
      },
    });
    assert.equal(res1.status, 201);
    const deviceId1 = res1.body.data.device.id;

    // Second registration with same token
    const res2 = await dispatchRequest(app, 'POST', '/api/v1/tourist/devices', {
      token: tokenA,
      body: {
        deviceToken: rawToken,
        platform: DEVICE_PLATFORMS.IOS,
      },
    });
    assert.equal(res2.status, 201);
    const deviceId2 = res2.body.data.device.id;

    assert.equal(deviceId1, deviceId2, 'Duplicate token registration must upsert existing record');
    assert.equal(testNotifRepo.devices.size, 1);
  });

  it('3. POST /api/v1/tourist/devices - Rejects unauthenticated caller with 401', async () => {
    const res = await dispatchRequest(app, 'POST', '/api/v1/tourist/devices', {
      body: {
        deviceToken: 'fcm_unauth_token_12345678',
        platform: DEVICE_PLATFORMS.ANDROID,
      },
    });

    assert.equal(res.status, 401);
  });

  it('4. POST /api/v1/tourist/devices - Rejects invalid platform or short token with 400', async () => {
    // Invalid platform
    const res1 = await dispatchRequest(app, 'POST', '/api/v1/tourist/devices', {
      token: tokenA,
      body: {
        deviceToken: 'fcm_valid_long_token_12345678',
        platform: 'WINDOWS_PHONE',
      },
    });
    assert.equal(res1.status, 400);

    // Too short token (< 10 chars)
    const res2 = await dispatchRequest(app, 'POST', '/api/v1/tourist/devices', {
      token: tokenA,
      body: {
        deviceToken: 'short',
        platform: DEVICE_PLATFORMS.ANDROID,
      },
    });
    assert.equal(res2.status, 400);
  });

  it('5. GET /api/v1/tourist/devices - Lists only authenticated caller\'s active devices with masked tokens', async () => {
    await testNotifRepo.upsertDeviceToken(touristA._id, 'fcm_token_tourist_a_12345678', DEVICE_PLATFORMS.ANDROID);
    await testNotifRepo.upsertDeviceToken(touristB._id, 'fcm_token_tourist_b_12345678', DEVICE_PLATFORMS.IOS);

    const resA = await dispatchRequest(app, 'GET', '/api/v1/tourist/devices', {
      token: tokenA,
    });

    assert.equal(resA.status, 200);
    assert.equal(resA.body.data.items.length, 1);
    assert.match(resA.body.data.items[0].maskedToken, /^fcm_.*\.\.\..*/);
    assert.doesNotMatch(resA.body.data.items[0].maskedToken, /tourist_b/);
  });

  it('6. DELETE /api/v1/tourist/devices/:deviceId - Successfully unregisters own device', async () => {
    const dev = await testNotifRepo.upsertDeviceToken(touristA._id, 'fcm_to_delete_token_12345678', DEVICE_PLATFORMS.ANDROID);

    const res = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/devices/${dev._id}`, {
      token: tokenA,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.message, 'Device unregistered successfully');

    // Verify it is no longer listed as active
    const listRes = await dispatchRequest(app, 'GET', '/api/v1/tourist/devices', {
      token: tokenA,
    });
    assert.equal(listRes.body.data.items.length, 0);
  });

  it('7. DELETE /api/v1/tourist/devices/:deviceId - Prevents BOLA cross-account device removal with 404', async () => {
    // Device belongs to Tourist B
    const devB = await testNotifRepo.upsertDeviceToken(touristB._id, 'fcm_token_b_private_12345678', DEVICE_PLATFORMS.IOS);

    // Tourist A attempts to delete Tourist B's device
    const res = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/devices/${devB._id}`, {
      token: tokenA,
    });

    assert.equal(res.status, 404);
    assert.equal(testNotifRepo.devices.get(devB._id.toString()).isActive, true, 'Tourist B device must remain active');
  });
});
