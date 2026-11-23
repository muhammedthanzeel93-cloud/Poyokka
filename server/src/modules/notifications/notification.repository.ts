import mongoose, { ClientSession, Model, Types } from 'mongoose';
import {
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_RULES,
} from '@kerala-tourism/constants';
import {
  DevicePlatform,
  NotificationDeliveryStatus,
  NotificationType,
} from '@kerala-tourism/shared-types';
import {
  NotificationModel,
  INotificationDocument,
  DeviceTokenModel,
  IDeviceTokenDocument,
  NotificationOutboxModel,
  INotificationOutboxDocument,
  NotificationPreferenceModel,
  INotificationPreferenceDocument,
} from '../../shared/models';

export interface CreateNotificationParams {
  recipientAccountId: Types.ObjectId | string;
  notificationType: NotificationType;
  title: string;
  body: string;
  dataPayload?: Record<string, string>;
  relatedResourceType?: 'BOOKING' | 'PAYMENT' | 'POST' | 'ACCOUNT';
  relatedResourceId?: string;
  deliveryStatus?: NotificationDeliveryStatus;
}

export interface CreateOutboxParams {
  notificationId: Types.ObjectId | string;
  recipientAccountId: Types.ObjectId | string;
  idempotencyKey: string;
  eventType: string;
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
  };
}

export class NotificationRepository {
  public inMemoryNotifications = new Map<string, any>();
  public inMemoryOutbox = new Map<string, any>();
  public inMemoryDeviceTokens = new Map<string, any>();

  constructor(
    private readonly notifModel: Model<INotificationDocument> = NotificationModel,
    private readonly deviceModel: Model<IDeviceTokenDocument> = DeviceTokenModel,
    private readonly outboxModel: Model<INotificationOutboxDocument> = NotificationOutboxModel,
    private readonly prefModel: Model<INotificationPreferenceDocument> = NotificationPreferenceModel,
  ) {}

  // ==========================================================================
  // DEVICE TOKEN METHODS
  // ==========================================================================

  public async upsertDeviceToken(
    accountId: Types.ObjectId | string,
    deviceToken: string,
    platform: DevicePlatform,
    deviceId?: string,
  ): Promise<IDeviceTokenDocument> {
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;

    if (mongoose.connection.readyState !== 1) {
      const doc = {
        _id: new Types.ObjectId(),
        accountId: accId,
        deviceToken: deviceToken.trim(),
        platform,
        deviceId: deviceId ? deviceId.trim() : undefined,
        isActive: true,
        lastSeenAt: new Date(),
        invalidatedAt: null,
        invalidReason: undefined,
      };
      this.inMemoryDeviceTokens.set(deviceToken.trim(), doc);
      return doc as unknown as IDeviceTokenDocument;
    }

    const updated = await this.deviceModel.findOneAndUpdate(
      { deviceToken: deviceToken.trim() },
      {
        $set: {
          accountId: accId,
          platform,
          deviceId: deviceId ? deviceId.trim() : undefined,
          isActive: true,
          lastSeenAt: new Date(),
          invalidatedAt: null,
          invalidReason: undefined,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return updated;
  }

  public async findActiveTokensByAccountId(
    accountId: Types.ObjectId | string,
  ): Promise<string[]> {
    if (mongoose.connection.readyState !== 1) {
      const accIdStr = accountId.toString();
      const tokens: string[] = [];
      for (const doc of this.inMemoryDeviceTokens.values()) {
        if (doc.accountId.toString() === accIdStr && doc.isActive) {
          tokens.push(doc.deviceToken);
        }
      }
      return tokens;
    }
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;
    const records = await this.deviceModel
      .find({ accountId: accId, isActive: true })
      .select('deviceToken')
      .lean();

    return records.map((r) => r.deviceToken);
  }

  public async findDeviceById(
    deviceId: string | Types.ObjectId,
  ): Promise<IDeviceTokenDocument | null> {
    if (!Types.ObjectId.isValid(deviceId)) {
      return null;
    }
    if (mongoose.connection.readyState !== 1) {
      for (const doc of this.inMemoryDeviceTokens.values()) {
        if (doc._id.toString() === deviceId.toString()) {
          return doc as unknown as IDeviceTokenDocument;
        }
      }
      return null;
    }
    return this.deviceModel.findById(deviceId);
  }

  public async findDevicesByAccountId(
    accountId: Types.ObjectId | string,
  ): Promise<IDeviceTokenDocument[]> {
    const accIdStr = accountId.toString();
    if (mongoose.connection.readyState !== 1) {
      const res: IDeviceTokenDocument[] = [];
      for (const doc of this.inMemoryDeviceTokens.values()) {
        if (doc.accountId.toString() === accIdStr && doc.isActive) {
          res.push(doc as unknown as IDeviceTokenDocument);
        }
      }
      return res;
    }
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;
    return this.deviceModel
      .find({ accountId: accId, isActive: true })
      .sort({ lastSeenAt: -1 });
  }

  public async deactivateDeviceById(
    deviceId: string | Types.ObjectId,
    accountId: Types.ObjectId | string,
    reason: string = 'USER_UNREGISTERED',
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(deviceId)) {
      return false;
    }
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;

    if (mongoose.connection.readyState !== 1) {
      for (const doc of this.inMemoryDeviceTokens.values()) {
        if (
          doc._id.toString() === deviceId.toString() &&
          doc.accountId.toString() === accId.toString() &&
          doc.isActive
        ) {
          doc.isActive = false;
          doc.invalidatedAt = new Date();
          doc.invalidReason = reason;
          return true;
        }
      }
      return false;
    }

    const res = await this.deviceModel.updateOne(
      { _id: deviceId, accountId: accId, isActive: true },
      {
        $set: {
          isActive: false,
          invalidatedAt: new Date(),
          invalidReason: reason,
        },
      },
    );

    return res.modifiedCount > 0;
  }

  public async deactivateTokens(
    tokens: string[],
    reason: string = 'FCM_UNREGISTERED',
  ): Promise<number> {
    if (tokens.length === 0) return 0;

    if (mongoose.connection.readyState !== 1) {
      let count = 0;
      for (const token of tokens) {
        const doc = this.inMemoryDeviceTokens.get(token);
        if (doc && doc.isActive) {
          doc.isActive = false;
          doc.invalidatedAt = new Date();
          doc.invalidReason = reason;
          count++;
        }
      }
      return count;
    }

    const res = await this.deviceModel.updateMany(
      { deviceToken: { $in: tokens } },
      {
        $set: {
          isActive: false,
          invalidatedAt: new Date(),
          invalidReason: reason,
        },
      },
    );

    return res.modifiedCount;
  }

  // ==========================================================================
  // NOTIFICATION METHODS
  // ==========================================================================

  public async createNotification(
    params: CreateNotificationParams,
    session?: ClientSession,
  ): Promise<INotificationDocument> {
    const recipientId =
      typeof params.recipientAccountId === 'string'
        ? new Types.ObjectId(params.recipientAccountId)
        : params.recipientAccountId;

    if (mongoose.connection.readyState !== 1) {
      const doc = {
        _id: new Types.ObjectId(),
        recipientAccountId: recipientId,
        notificationType: params.notificationType,
        title: params.title,
        body: params.body,
        dataPayload: params.dataPayload || {},
        relatedResourceType: params.relatedResourceType,
        relatedResourceId: params.relatedResourceId,
        isRead: false,
        deliveryStatus: params.deliveryStatus || NOTIFICATION_DELIVERY_STATUSES.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as INotificationDocument;
      this.inMemoryNotifications.set(doc._id.toString(), doc);
      return doc;
    }

    const [notif] = await this.notifModel.create(
      [
        {
          recipientAccountId: recipientId,
          notificationType: params.notificationType,
          title: params.title,
          body: params.body,
          dataPayload: params.dataPayload || {},
          relatedResourceType: params.relatedResourceType,
          relatedResourceId: params.relatedResourceId,
          isRead: false,
          deliveryStatus: params.deliveryStatus || NOTIFICATION_DELIVERY_STATUSES.PENDING,
        },
      ],
      { session },
    );

    return notif;
  }

  public async findNotificationsByAccountId(
    accountId: Types.ObjectId | string,
    filter: {
      isRead?: boolean;
      page: number;
      limit: number;
    },
  ): Promise<{ items: INotificationDocument[]; total: number }> {
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;
    const query: Record<string, unknown> = { recipientAccountId: accId };

    if (filter.isRead !== undefined) {
      query.isRead = filter.isRead;
    }

    const skip = (filter.page - 1) * filter.limit;

    const [items, total] = await Promise.all([
      this.notifModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(filter.limit)
        .lean<INotificationDocument[]>()
        .exec(),
      this.notifModel.countDocuments(query).exec(),
    ]);

    return { items, total };
  }

  public async countUnreadByAccountId(
    accountId: Types.ObjectId | string,
  ): Promise<number> {
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;
    return this.notifModel.countDocuments({
      recipientAccountId: accId,
      isRead: false,
    });
  }

  public async findNotificationById(
    notificationId: string | Types.ObjectId,
  ): Promise<INotificationDocument | null> {
    if (!Types.ObjectId.isValid(notificationId)) {
      return null;
    }
    return this.notifModel.findById(notificationId);
  }

  public async markAsRead(
    notificationId: string | Types.ObjectId,
    accountId: Types.ObjectId | string,
  ): Promise<INotificationDocument | null> {
    if (!Types.ObjectId.isValid(notificationId)) {
      return null;
    }
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;

    return this.notifModel.findOneAndUpdate(
      { _id: notificationId, recipientAccountId: accId },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true },
    );
  }

  public async markAllAsRead(
    accountId: Types.ObjectId | string,
  ): Promise<number> {
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;
    const res = await this.notifModel.updateMany(
      { recipientAccountId: accId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    return res.modifiedCount;
  }

  public async deleteNotification(
    notificationId: string | Types.ObjectId,
    accountId: Types.ObjectId | string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(notificationId)) {
      return false;
    }
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;
    const res = await this.notifModel.deleteOne({
      _id: notificationId,
      recipientAccountId: accId,
    });
    return res.deletedCount > 0;
  }

  public async updateDeliveryStatus(
    notificationId: Types.ObjectId | string,
    status: NotificationDeliveryStatus,
  ): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
      const doc = this.inMemoryNotifications.get(notificationId.toString());
      if (doc) {
        doc.deliveryStatus = status;
      }
      return;
    }
    await this.notifModel.updateOne(
      { _id: notificationId },
      { $set: { deliveryStatus: status } },
    );
  }

  // ==========================================================================
  // OUTBOX METHODS
  // ==========================================================================

  public async createOutboxRecord(
    params: CreateOutboxParams,
    session?: ClientSession,
  ): Promise<INotificationOutboxDocument | null> {
    if (mongoose.connection.readyState !== 1) {
      for (const item of this.inMemoryOutbox.values()) {
        if (item.idempotencyKey === params.idempotencyKey) {
          return null;
        }
      }
      const doc = {
        _id: new Types.ObjectId(),
        notificationId: new Types.ObjectId(params.notificationId),
        recipientAccountId: new Types.ObjectId(params.recipientAccountId),
        idempotencyKey: params.idempotencyKey,
        eventType: params.eventType,
        payload: params.payload,
        status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
        attempts: 0,
        maxAttempts: NOTIFICATION_RULES.MAX_RETRY_ATTEMPTS,
        nextRetryAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as INotificationOutboxDocument;
      this.inMemoryOutbox.set(doc._id.toString(), doc);
      return doc;
    }

    try {
      const [record] = await this.outboxModel.create(
        [
          {
            notificationId: new Types.ObjectId(params.notificationId),
            recipientAccountId: new Types.ObjectId(params.recipientAccountId),
            idempotencyKey: params.idempotencyKey,
            eventType: params.eventType,
            payload: params.payload,
            status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
            attempts: 0,
            maxAttempts: NOTIFICATION_RULES.MAX_RETRY_ATTEMPTS,
            nextRetryAt: new Date(),
          },
        ],
        { session },
      );
      return record;
    } catch (err: any) {
      // E11000 duplicate key error means idempotencyKey already exists
      if (err?.code === 11000) {
        return null;
      }
      throw err;
    }
  }

  public async findPendingOutboxBatch(
    batchSize: number = NOTIFICATION_RULES.BATCH_SIZE,
    referenceNow: Date = new Date(),
  ): Promise<INotificationOutboxDocument[]> {
    if (mongoose.connection.readyState !== 1) {
      return Array.from(this.inMemoryOutbox.values())
        .filter(
          (item) =>
            item.status === NOTIFICATION_DELIVERY_STATUSES.PENDING &&
            new Date(item.nextRetryAt).getTime() <= referenceNow.getTime(),
        )
        .slice(0, batchSize);
    }

    return this.outboxModel
      .find({
        status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
        nextRetryAt: { $lte: referenceNow },
      })
      .sort({ nextRetryAt: 1 })
      .limit(batchSize);
  }

  /**
   * Atomically claims a batch of pending outbox records using a lease lock.
   * Prevents concurrent worker instances from processing identical push notifications.
   */
  public async claimPendingOutboxBatch(
    batchSize: number = NOTIFICATION_RULES.BATCH_SIZE,
    referenceNow: Date = new Date(),
    workerId: string = `worker-${process.pid}-${Date.now()}`,
    leaseMs: number = 30000,
  ): Promise<INotificationOutboxDocument[]> {
    if (mongoose.connection.readyState !== 1 || this.constructor !== NotificationRepository) {
      return this.findPendingOutboxBatch(batchSize, referenceNow);
    }

    const leaseCutoff = new Date(referenceNow.getTime() - leaseMs);
    const claimed: INotificationOutboxDocument[] = [];

    for (let i = 0; i < batchSize; i++) {
      const doc = await this.outboxModel.findOneAndUpdate(
        {
          status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
          nextRetryAt: { $lte: referenceNow },
          $or: [
            { lockedAt: null },
            { lockedAt: { $exists: false } },
            { lockedAt: { $lt: leaseCutoff } },
          ],
        },
        {
          $set: {
            lockedAt: referenceNow,
            lockedBy: workerId,
          },
        },
        { new: true, sort: { nextRetryAt: 1 } },
      );

      if (!doc) {
        break;
      }
      claimed.push(doc);
    }

    return claimed;
  }

  public async updateOutboxResult(
    outboxId: Types.ObjectId,
    updates: {
      status: NotificationDeliveryStatus;
      attempts?: number;
      nextRetryAt?: Date;
      lastError?: string;
      processedAt?: Date | null;
      lockedAt?: Date | null;
      lockedBy?: string | null;
    },
  ): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
      const doc = this.inMemoryOutbox.get(outboxId.toString());
      if (doc) {
        Object.assign(doc, updates);
      }
      return;
    }

    await this.outboxModel.updateOne(
      { _id: outboxId },
      {
        $set: {
          status: updates.status,
          lockedAt: updates.lockedAt !== undefined ? updates.lockedAt : null,
          lockedBy: updates.lockedBy !== undefined ? updates.lockedBy : null,
          ...(updates.attempts !== undefined ? { attempts: updates.attempts } : {}),
          ...(updates.nextRetryAt ? { nextRetryAt: updates.nextRetryAt } : {}),
          ...(updates.lastError !== undefined ? { lastError: updates.lastError } : {}),
          ...(updates.processedAt !== undefined ? { processedAt: updates.processedAt } : {}),
        },
      },
    );
  }

  // ==========================================================================
  // PREFERENCE METHODS
  // ==========================================================================

  public async getPreferences(
    accountId: Types.ObjectId | string,
  ): Promise<INotificationPreferenceDocument> {
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;

    if (mongoose.connection.readyState !== 1) {
      return {
        _id: new Types.ObjectId(),
        accountId: accId,
        bookingUpdates: true,
        paymentUpdates: true,
        socialUpdates: true,
      } as unknown as INotificationPreferenceDocument;
    }

    let pref = await this.prefModel.findOne({ accountId: accId });
    if (!pref) {
      pref = await this.prefModel.create({
        accountId: accId,
        bookingUpdates: true,
        paymentUpdates: true,
        socialUpdates: true,
      });
    }
    return pref;
  }

  public async updatePreferences(
    accountId: Types.ObjectId | string,
    updates: {
      bookingUpdates?: boolean;
      paymentUpdates?: boolean;
      socialUpdates?: boolean;
    },
  ): Promise<INotificationPreferenceDocument> {
    const accId = typeof accountId === 'string' ? new Types.ObjectId(accountId) : accountId;

    if (mongoose.connection.readyState !== 1) {
      return {
        _id: new Types.ObjectId(),
        accountId: accId,
        bookingUpdates: updates.bookingUpdates ?? true,
        paymentUpdates: updates.paymentUpdates ?? true,
        socialUpdates: updates.socialUpdates ?? true,
      } as unknown as INotificationPreferenceDocument;
    }

    const pref = await this.prefModel.findOneAndUpdate(
      { accountId: accId },
      {
        $set: {
          ...(updates.bookingUpdates !== undefined ? { bookingUpdates: updates.bookingUpdates } : {}),
          ...(updates.paymentUpdates !== undefined ? { paymentUpdates: updates.paymentUpdates } : {}),
          ...(updates.socialUpdates !== undefined ? { socialUpdates: updates.socialUpdates } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return pref;
  }
}

export const notificationRepository = new NotificationRepository();
