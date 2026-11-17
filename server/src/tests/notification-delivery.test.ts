import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_RULES,
  DEVICE_PLATFORMS,
} from '@kerala-tourism/constants';
import {
  NotificationRepository,
  CreateNotificationParams,
} from '../modules/notifications/notification.repository';
import { NotificationService } from '../modules/notifications/notification.service';
import { NotificationDeliveryWorker } from '../modules/notifications/delivery/delivery.worker';
import { FirebaseNotificationProvider } from '../modules/notifications/providers/firebase.provider';
import {
  INotificationProvider,
} from '../modules/notifications/providers/notification-provider.interface';
import { PushDeliveryResult } from '@kerala-tourism/shared-types';

class InMemoryDeliveryRepository extends NotificationRepository {
  public notifications: Map<string, any> = new Map();
  public outbox: Map<string, any> = new Map();
  public devices: Map<string, any> = new Map();
  public preferences: Map<string, any> = new Map();

  public override async upsertDeviceToken(
    accountId: Types.ObjectId | string,
    deviceToken: string,
    platform: any,
    deviceId?: string,
  ): Promise<any> {
    const existing = Array.from(this.devices.values()).find(
      (d) => d.deviceToken === deviceToken,
    );
    if (existing) {
      existing.accountId = new Types.ObjectId(accountId.toString());
      existing.platform = platform;
      existing.deviceId = deviceId;
      existing.isActive = true;
      existing.lastSeenAt = new Date();
      return existing;
    }

    const doc = {
      _id: new Types.ObjectId(),
      accountId: new Types.ObjectId(accountId.toString()),
      deviceToken,
      platform,
      deviceId,
      isActive: true,
      registeredAt: new Date(),
      lastSeenAt: new Date(),
    };
    this.devices.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findActiveTokensByAccountId(
    accountId: Types.ObjectId | string,
  ): Promise<string[]> {
    const accIdStr = accountId.toString();
    return Array.from(this.devices.values())
      .filter((d) => d.accountId.toString() === accIdStr && d.isActive)
      .map((d) => d.deviceToken);
  }

  public override async deactivateTokens(
    tokens: string[],
    reason: string = 'FCM_UNREGISTERED',
  ): Promise<number> {
    let count = 0;
    for (const doc of this.devices.values()) {
      if (tokens.includes(doc.deviceToken) && doc.isActive) {
        doc.isActive = false;
        doc.invalidatedAt = new Date();
        doc.invalidReason = reason;
        count++;
      }
    }
    return count;
  }

  public override async createNotification(params: CreateNotificationParams): Promise<any> {
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
      deliveryStatus: params.deliveryStatus || NOTIFICATION_DELIVERY_STATUSES.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.set(doc._id.toString(), doc);
    return doc;
  }

  public override async updateDeliveryStatus(
    notificationId: string | Types.ObjectId,
    deliveryStatus: string,
  ): Promise<void> {
    const doc = this.notifications.get(notificationId.toString());
    if (doc) {
      doc.deliveryStatus = deliveryStatus;
    }
  }

  public override async createOutboxRecord(params: any): Promise<any> {
    const existing = Array.from(this.outbox.values()).find(
      (o) => o.idempotencyKey === params.idempotencyKey,
    );
    if (existing) {
      return null;
    }

    const doc = {
      _id: new Types.ObjectId(),
      notificationId: new Types.ObjectId(params.notificationId.toString()),
      recipientAccountId: new Types.ObjectId(params.recipientAccountId.toString()),
      idempotencyKey: params.idempotencyKey,
      eventType: params.eventType,
      payload: params.payload,
      status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      attempts: 0,
      maxAttempts: params.maxAttempts || NOTIFICATION_RULES.MAX_RETRY_ATTEMPTS,
      nextRetryAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.outbox.set(doc._id.toString(), doc);
    return doc;
  }

  public override async findPendingOutboxBatch(
    limit: number,
    referenceNow: Date = new Date(),
  ): Promise<any[]> {
    return Array.from(this.outbox.values())
      .filter((o) => o.status === NOTIFICATION_DELIVERY_STATUSES.PENDING && o.nextRetryAt <= referenceNow)
      .slice(0, limit);
  }

  public override async updateOutboxResult(
    outboxId: string | Types.ObjectId,
    params: any,
  ): Promise<void> {
    const doc = this.outbox.get(outboxId.toString());
    if (doc) {
      if (params.status) doc.status = params.status;
      if (params.attempts !== undefined) doc.attempts = params.attempts;
      if (params.nextRetryAt !== undefined) doc.nextRetryAt = params.nextRetryAt;
      if (params.lastError !== undefined) doc.lastError = params.lastError;
      if (params.processedAt !== undefined) doc.processedAt = params.processedAt;
    }
  }

  public override async getPreferences(accountId: Types.ObjectId | string): Promise<any> {
    const accIdStr = accountId.toString();
    const existing = this.preferences.get(accIdStr);
    if (existing) return existing;

    const def = {
      _id: new Types.ObjectId(),
      accountId: new Types.ObjectId(accIdStr),
      bookingUpdates: true,
      paymentUpdates: true,
      socialUpdates: true,
    };
    this.preferences.set(accIdStr, def);
    return def;
  }

  public override async updatePreferences(
    accountId: Types.ObjectId | string,
    updates: any,
  ): Promise<any> {
    const current = await this.getPreferences(accountId);
    if (updates.bookingUpdates !== undefined) current.bookingUpdates = updates.bookingUpdates;
    if (updates.paymentUpdates !== undefined) current.paymentUpdates = updates.paymentUpdates;
    if (updates.socialUpdates !== undefined) current.socialUpdates = updates.socialUpdates;
    return current;
  }
}

describe('Notification Delivery Worker & Lifecycle (Day 26)', () => {
  let repo: InMemoryDeliveryRepository;
  let service: NotificationService;
  let worker: NotificationDeliveryWorker;
  let provider: FirebaseNotificationProvider;

  const testRecipientId = new Types.ObjectId();
  const validDeviceToken = 'fcm_valid_mock_token_1234567890';
  const invalidDeviceToken = 'invalid_unregistered_token_9999999';

  beforeEach(() => {
    repo = new InMemoryDeliveryRepository();
    service = new NotificationService(repo);
    provider = new FirebaseNotificationProvider();
    worker = new NotificationDeliveryWorker(repo, provider);
  });

  it('1. Event publication creates in-app notification and pending outbox record', async () => {
    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed!',
      body: 'Your reservation at Wayanad Resort is confirmed.',
      idempotencyKey: 'evt_booking_confirmed_101',
      relatedResourceType: 'BOOKING',
      relatedResourceId: 'bk_101',
    });

    assert.equal(repo.notifications.size, 1);
    assert.equal(repo.outbox.size, 1);

    const [outboxItem] = Array.from(repo.outbox.values());
    assert.equal(outboxItem.idempotencyKey, 'evt_booking_confirmed_101');
    assert.equal(outboxItem.status, NOTIFICATION_DELIVERY_STATUSES.PENDING);
    assert.equal(outboxItem.attempts, 0);

    const [notif] = Array.from(repo.notifications.values());
    assert.equal(notif.title, 'Booking Confirmed!');
    assert.equal(notif.deliveryStatus, NOTIFICATION_DELIVERY_STATUSES.PENDING);
  });

  it('2. Processes pending outbox item with active device token and marks delivered', async () => {
    // Register active device
    await repo.upsertDeviceToken(
      testRecipientId,
      validDeviceToken,
      DEVICE_PLATFORMS.ANDROID,
    );

    // Publish event
    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed!',
      body: 'Stay confirmed',
      idempotencyKey: 'evt_booking_202',
    });

    // Run worker batch
    const batchResult = await worker.processPendingOutboxBatch(10);

    assert.equal(batchResult.scannedCount, 1);
    assert.equal(batchResult.deliveredCount, 1);
    assert.equal(batchResult.failedCount, 0);
    assert.equal(batchResult.deadLetterCount, 0);

    const [outboxItem] = Array.from(repo.outbox.values());
    assert.equal(outboxItem.status, NOTIFICATION_DELIVERY_STATUSES.DELIVERED);

    const [notif] = Array.from(repo.notifications.values());
    assert.equal(notif.deliveryStatus, NOTIFICATION_DELIVERY_STATUSES.DELIVERED);
  });

  it('3. Automatically deactivates invalid device tokens returned by provider', async () => {
    // Register device with invalid prefix token recognized by mock provider
    await repo.upsertDeviceToken(
      testRecipientId,
      invalidDeviceToken,
      DEVICE_PLATFORMS.IOS,
    );

    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.PAYMENT_CAPTURED,
      title: 'Payment Received',
      body: 'INR 4500 received.',
      idempotencyKey: 'evt_pay_303',
    });

    const batchResult = await worker.processPendingOutboxBatch(10);

    assert.equal(batchResult.scannedCount, 1);
    assert.equal(batchResult.invalidTokensCleanedCount, 1);

    // Verify token deactivated in database
    const activeTokens = await repo.findActiveTokensByAccountId(testRecipientId);
    assert.equal(activeTokens.length, 0);
  });

  it('4. Schedules bounded exponential backoff retry on temporary provider failure', async () => {
    await repo.upsertDeviceToken(
      testRecipientId,
      validDeviceToken,
      DEVICE_PLATFORMS.ANDROID,
    );

    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed',
      body: 'Stay confirmed',
      idempotencyKey: 'evt_retry_404',
    });

    // Mock failing provider (transient failure)
    const mockFailingProvider: INotificationProvider = {
      providerName: 'FCM',
      sendPush: async (): Promise<PushDeliveryResult> => ({
        success: false,
        deliveredCount: 0,
        failedCount: 1,
        invalidTokens: [],
        error: 'messaging/server-unavailable',
      }),
    };

    worker.setProvider(mockFailingProvider);

    const batchResult = await worker.processPendingOutboxBatch(10);

    assert.equal(batchResult.scannedCount, 1);
    assert.equal(batchResult.failedCount, 1);
    assert.equal(batchResult.deadLetterCount, 0);

    const [outboxItem] = Array.from(repo.outbox.values());
    assert.equal(outboxItem.status, NOTIFICATION_DELIVERY_STATUSES.PENDING);
    assert.equal(outboxItem.attempts, 1);
    assert.ok(outboxItem.nextRetryAt.getTime() > Date.now());
  });

  it('5. Moves to DEAD_LETTER status after exceeding maximum retry attempts', async () => {
    await repo.upsertDeviceToken(
      testRecipientId,
      validDeviceToken,
      DEVICE_PLATFORMS.ANDROID,
    );

    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed',
      body: 'Stay confirmed',
      idempotencyKey: 'evt_dead_letter_505',
    });

    // Advance attempts to 4 (so next attempt = 5 = maxAttempts)
    const [outboxItem] = Array.from(repo.outbox.values());
    outboxItem.attempts = 4;

    const mockFailingProvider: INotificationProvider = {
      providerName: 'FCM',
      sendPush: async (): Promise<PushDeliveryResult> => ({
        success: false,
        deliveredCount: 0,
        failedCount: 1,
        invalidTokens: [],
        error: 'DEADLINE_EXCEEDED',
      }),
    };

    worker.setProvider(mockFailingProvider);

    const batchResult = await worker.processPendingOutboxBatch(10);

    assert.equal(batchResult.scannedCount, 1);
    assert.equal(batchResult.deadLetterCount, 1);
    assert.equal(batchResult.failedCount, 0);

    assert.equal(outboxItem.status, NOTIFICATION_DELIVERY_STATUSES.DEAD_LETTER);
    assert.equal(outboxItem.attempts, 5);

    const [notif] = Array.from(repo.notifications.values());
    assert.equal(notif.deliveryStatus, NOTIFICATION_DELIVERY_STATUSES.FAILED);
  });

  it('6. Deduplicates events with identical idempotency key', async () => {
    // First trigger
    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed',
      body: 'Stay confirmed',
      idempotencyKey: 'webhook_pay_captured_rec_777',
    });

    // Second trigger with same idempotency key (e.g. duplicate webhook retry)
    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed Duplicate',
      body: 'Stay confirmed',
      idempotencyKey: 'webhook_pay_captured_rec_777',
    });

    // Total outbox records must be exactly 1
    assert.equal(repo.outbox.size, 1);
  });

  it('7. Respects user opt-out preferences and suppresses self-action notifications', async () => {
    // 1. Opt out of booking updates
    await repo.updatePreferences(testRecipientId, { bookingUpdates: false });

    await service.publishEvent({
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed',
      body: 'Stay confirmed',
      idempotencyKey: 'opt_out_event_1',
    });

    // Suppressed by preference
    assert.equal(repo.notifications.size, 0);
    assert.equal(repo.outbox.size, 0);

    // 2. Self-action suppression
    await service.publishEvent({
      callerAccountId: testRecipientId,
      recipientAccountId: testRecipientId,
      notificationType: NOTIFICATION_TYPES.SOCIAL_LIKE,
      title: 'Liked your post',
      body: 'Someone liked your post',
      idempotencyKey: 'self_action_event_2',
    });

    // Suppressed because caller == recipient
    assert.equal(repo.notifications.size, 0);
    assert.equal(repo.outbox.size, 0);
  });
});
