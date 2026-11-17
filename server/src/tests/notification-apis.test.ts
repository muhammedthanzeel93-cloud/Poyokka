import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  NOTIFICATION_TYPES,
} from '@kerala-tourism/constants';
import { createApp } from '../loaders/app';
import { authMiddleware } from '../middlewares/auth.middleware';
import { authorizationMiddleware } from '../middlewares/authorization.middleware';
import { resetRateLimiter } from '../middlewares/rateLimiter';
import { AuthRepository } from '../modules/auth/auth.repository';
import { NotificationRepository } from '../modules/notifications/notification.repository';
import { notificationService } from '../modules/notifications/notification.service';
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

class InMemoryNotificationRepository extends NotificationRepository {
  public notifications: Map<string, any> = new Map();
  public preferences: Map<string, any> = new Map();

  public async createNotification(params: any): Promise<any> {
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
      deliveryStatus: params.deliveryStatus || 'PENDING',
      createdAt: params.createdAt || new Date(),
      updatedAt: new Date(),
    };
    this.notifications.set(doc._id.toString(), doc);
    return doc;
  }

  public async findNotificationsByAccountId(
    accountId: Types.ObjectId | string,
    filter: { isRead?: boolean; page: number; limit: number },
  ): Promise<{ items: any[]; total: number }> {
    const accIdStr = accountId.toString();
    let all = Array.from(this.notifications.values()).filter(
      (n) => n.recipientAccountId.toString() === accIdStr,
    );

    if (filter.isRead !== undefined) {
      all = all.filter((n) => n.isRead === filter.isRead);
    }

    all.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      if (diff !== 0) return diff;
      return b._id.toString() > a._id.toString() ? 1 : -1;
    });

    const total = all.length;
    const skip = (filter.page - 1) * filter.limit;
    const items = all.slice(skip, skip + filter.limit);

    return { items, total };
  }

  public async countUnreadByAccountId(accountId: Types.ObjectId | string): Promise<number> {
    const accIdStr = accountId.toString();
    return Array.from(this.notifications.values()).filter(
      (n) => n.recipientAccountId.toString() === accIdStr && !n.isRead,
    ).length;
  }

  public async markAsRead(
    notificationId: string | Types.ObjectId,
    accountId: Types.ObjectId | string,
  ): Promise<any | null> {
    const notif = this.notifications.get(notificationId.toString());
    if (!notif || notif.recipientAccountId.toString() !== accountId.toString()) {
      return null;
    }
    notif.isRead = true;
    notif.readAt = new Date();
    return notif;
  }

  public async markAllAsRead(accountId: Types.ObjectId | string): Promise<number> {
    const accIdStr = accountId.toString();
    let count = 0;
    for (const notif of this.notifications.values()) {
      if (notif.recipientAccountId.toString() === accIdStr && !notif.isRead) {
        notif.isRead = true;
        notif.readAt = new Date();
        count++;
      }
    }
    return count;
  }

  public async deleteNotification(
    notificationId: string | Types.ObjectId,
    accountId: Types.ObjectId | string,
  ): Promise<boolean> {
    const notif = this.notifications.get(notificationId.toString());
    if (!notif || notif.recipientAccountId.toString() !== accountId.toString()) {
      return false;
    }
    return this.notifications.delete(notificationId.toString());
  }

  public async getPreferences(accountId: Types.ObjectId | string): Promise<any> {
    const accIdStr = accountId.toString();
    let pref = this.preferences.get(accIdStr);
    if (!pref) {
      pref = {
        accountId: new Types.ObjectId(accIdStr),
        bookingUpdates: true,
        paymentUpdates: true,
        socialUpdates: true,
      };
      this.preferences.set(accIdStr, pref);
    }
    return pref;
  }

  public async updatePreferences(
    accountId: Types.ObjectId | string,
    updates: any,
  ): Promise<any> {
    const current = await this.getPreferences(accountId);
    const updated = {
      ...current,
      ...(updates.bookingUpdates !== undefined ? { bookingUpdates: updates.bookingUpdates } : {}),
      ...(updates.paymentUpdates !== undefined ? { paymentUpdates: updates.paymentUpdates } : {}),
      ...(updates.socialUpdates !== undefined ? { socialUpdates: updates.socialUpdates } : {}),
    };
    this.preferences.set(accountId.toString(), updated);
    return updated;
  }
}

describe('Tourist Notification Tray & Preferences APIs (Day 26)', () => {
  let app: any;
  let testAuthRepo: TestAuthRepository;
  let testNotifRepo: InMemoryNotificationRepository;

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
  let tokenB: string;

  beforeEach(() => {
    resetRateLimiter();

    testAuthRepo = new TestAuthRepository();
    testAuthRepo.accounts.set(touristA._id.toString(), touristA);
    testAuthRepo.accounts.set(touristB._id.toString(), touristB);

    authMiddleware.setRepository(testAuthRepo);
    authorizationMiddleware.setRepository(testAuthRepo);

    testNotifRepo = new InMemoryNotificationRepository();
    notificationService.setRepository(testNotifRepo);

    app = createApp();

    tokenA = jwtService.signAccessToken({
      id: touristA._id.toString(),
      email: touristA.email,
      accountType: touristA.accountType as any,
      status: touristA.status as any,
    });

    tokenB = jwtService.signAccessToken({
      id: touristB._id.toString(),
      email: touristB.email,
      accountType: touristB.accountType as any,
      status: touristB.status as any,
    });
  });

  it('1. GET /api/v1/tourist/notifications - Returns paginated list sorted newest-first scoped to caller', async () => {
    // Seed notifications for Tourist A and Tourist B
    await testNotifRepo.createNotification({
      recipientAccountId: touristA._id,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed A1',
      body: 'Your Wayanad stay is confirmed.',
    });
    await testNotifRepo.createNotification({
      recipientAccountId: touristA._id,
      notificationType: NOTIFICATION_TYPES.PAYMENT_CAPTURED,
      title: 'Payment Successful A2',
      body: 'Payment captured.',
    });
    await testNotifRepo.createNotification({
      recipientAccountId: touristB._id,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed B1',
      body: 'Tourist B notification.',
    });

    const res = await dispatchRequest(app, 'GET', '/api/v1/tourist/notifications?page=1&limit=10', {
      token: tokenA,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.pagination.total, 2);
    assert.equal(res.body.data.items[0].title, 'Payment Successful A2');
  });

  it('2. GET /api/v1/tourist/notifications/unread-count - Returns accurate unread count', async () => {
    await testNotifRepo.createNotification({
      recipientAccountId: touristA._id,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Unread 1',
      body: 'Body',
    });
    await testNotifRepo.createNotification({
      recipientAccountId: touristA._id,
      notificationType: NOTIFICATION_TYPES.PAYMENT_CAPTURED,
      title: 'Unread 2',
      body: 'Body',
    });

    const res = await dispatchRequest(app, 'GET', '/api/v1/tourist/notifications/unread-count', {
      token: tokenA,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.unreadCount, 2);
  });

  it('3. PATCH /api/v1/tourist/notifications/:id/read - Marks notification as read', async () => {
    const notif = await testNotifRepo.createNotification({
      recipientAccountId: touristA._id,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'To Read',
      body: 'Body',
    });

    const res = await dispatchRequest(app, 'PATCH', `/api/v1/tourist/notifications/${notif._id}/read`, {
      token: tokenA,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.notification.isRead, true);
    assert.ok(res.body.data.notification.readAt);

    // Verify unread count decremented
    const countRes = await dispatchRequest(app, 'GET', '/api/v1/tourist/notifications/unread-count', {
      token: tokenA,
    });
    assert.equal(countRes.body.data.unreadCount, 0);
  });

  it('4. PATCH /api/v1/tourist/notifications/:id/read - Prevents marking another user\'s notification with 404', async () => {
    const notifB = await testNotifRepo.createNotification({
      recipientAccountId: touristB._id,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'B Private',
      body: 'Body',
    });

    // Tourist A attempts to mark Tourist B's notification
    const res = await dispatchRequest(app, 'PATCH', `/api/v1/tourist/notifications/${notifB._id}/read`, {
      token: tokenA,
    });

    assert.equal(res.status, 404);
  });

  it('5. PATCH /api/v1/tourist/notifications/read-all - Marks all unread notifications of caller as read', async () => {
    await testNotifRepo.createNotification({ recipientAccountId: touristA._id, notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED, title: 'N1', body: 'B' });
    await testNotifRepo.createNotification({ recipientAccountId: touristA._id, notificationType: NOTIFICATION_TYPES.SOCIAL_LIKE, title: 'N2', body: 'B' });
    await testNotifRepo.createNotification({ recipientAccountId: touristB._id, notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED, title: 'B1', body: 'B' });

    const res = await dispatchRequest(app, 'PATCH', '/api/v1/tourist/notifications/read-all', {
      token: tokenA,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.modifiedCount, 2);

    // Verify Tourist B's notification remained unread
    const resB = await dispatchRequest(app, 'GET', '/api/v1/tourist/notifications/unread-count', {
      token: tokenB,
    });
    assert.equal(resB.body.data.unreadCount, 1);
  });

  it('6. DELETE /api/v1/tourist/notifications/:id - Deletes notification with 404 BOLA protection', async () => {
    const notifA = await testNotifRepo.createNotification({ recipientAccountId: touristA._id, notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED, title: 'Del', body: 'B' });
    const notifB = await testNotifRepo.createNotification({ recipientAccountId: touristB._id, notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED, title: 'Keep', body: 'B' });

    // Tourist A deletes own notification
    const delRes = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/notifications/${notifA._id}`, {
      token: tokenA,
    });
    assert.equal(delRes.status, 200);

    // Tourist A attempts to delete Tourist B's notification -> 404
    const bolaRes = await dispatchRequest(app, 'DELETE', `/api/v1/tourist/notifications/${notifB._id}`, {
      token: tokenA,
    });
    assert.equal(bolaRes.status, 404);
  });

  it('7. GET & PATCH /api/v1/tourist/notifications/preferences - Manages notification category opt-outs', async () => {
    // 1. Initial defaults
    const getRes = await dispatchRequest(app, 'GET', '/api/v1/tourist/notifications/preferences', {
      token: tokenA,
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.preferences.bookingUpdates, true);
    assert.equal(getRes.body.data.preferences.socialUpdates, true);

    // 2. Update preferences: disable social updates
    const patchRes = await dispatchRequest(app, 'PATCH', '/api/v1/tourist/notifications/preferences', {
      token: tokenA,
      body: {
        socialUpdates: false,
      },
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.data.preferences.socialUpdates, false);
    assert.equal(patchRes.body.data.preferences.bookingUpdates, true);
  });
});
