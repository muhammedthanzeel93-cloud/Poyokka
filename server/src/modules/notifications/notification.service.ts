import { Types, ClientSession } from 'mongoose';
import { NOTIFICATION_TYPES } from '@kerala-tourism/constants';
import {
  DeviceDto,
  DeviceListResponseDto,
  NotificationDto,
  NotificationListResponseDto,
  NotificationPreferencesDto,
  NotificationType,
  RegisterDeviceResponseDto,
  UpdateNotificationPreferencesDto,
} from '@kerala-tourism/shared-types';
import {
  ListNotificationsQueryInput,
  RegisterDeviceInput,
} from '@kerala-tourism/validation';
import { NotFoundError } from '../../shared/errors/AppError';
import {
  NotificationRepository,
  notificationRepository,
} from './notification.repository';
import { IDeviceTokenDocument, INotificationDocument } from '../../shared/models';

export interface PublishNotificationEventParams {
  callerAccountId?: Types.ObjectId | string;
  recipientAccountId: Types.ObjectId | string;
  notificationType: NotificationType;
  title: string;
  body: string;
  dataPayload?: Record<string, string>;
  relatedResourceType?: 'BOOKING' | 'PAYMENT' | 'POST' | 'ACCOUNT';
  relatedResourceId?: string;
  idempotencyKey: string;
}

export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository = notificationRepository,
  ) {}

  public setRepository(repo: NotificationRepository): void {
    (this as unknown as { repo: NotificationRepository }).repo = repo;
  }

  // ==========================================================================
  // DEVICE MANAGEMENT
  // ==========================================================================

  public async registerDevice(
    accountId: string,
    input: RegisterDeviceInput,
  ): Promise<RegisterDeviceResponseDto> {
    const doc = await this.repo.upsertDeviceToken(
      accountId,
      input.deviceToken,
      input.platform,
      input.deviceId,
    );

    return {
      device: this.mapDeviceDto(doc),
      message: 'Device registered successfully',
    };
  }

  public async listDevices(accountId: string): Promise<DeviceListResponseDto> {
    const docs = await this.repo.findDevicesByAccountId(accountId);
    return {
      items: docs.map((d) => this.mapDeviceDto(d)),
    };
  }

  public async unregisterDevice(accountId: string, deviceId: string): Promise<boolean> {
    const success = await this.repo.deactivateDeviceById(deviceId, accountId);
    if (!success) {
      throw new NotFoundError('Device registration not found', 'RESOURCE_NOT_FOUND');
    }
    return true;
  }

  // ==========================================================================
  // NOTIFICATION MANAGEMENT
  // ==========================================================================

  public async listNotifications(
    accountId: string,
    query: ListNotificationsQueryInput,
  ): Promise<NotificationListResponseDto> {
    const isReadFilter =
      query.isRead === 'true' ? true : query.isRead === 'false' ? false : undefined;

    const { items, total } = await this.repo.findNotificationsByAccountId(accountId, {
      isRead: isReadFilter,
      page: query.page,
      limit: query.limit,
    });

    const totalPages = Math.ceil(total / query.limit) || 1;

    return {
      items: items.map((doc) => this.mapNotificationDto(doc)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  public async getUnreadCount(accountId: string): Promise<{ unreadCount: number }> {
    const count = await this.repo.countUnreadByAccountId(accountId);
    return { unreadCount: count };
  }

  public async markAsRead(
    accountId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    const doc = await this.repo.markAsRead(notificationId, accountId);
    if (!doc) {
      throw new NotFoundError('Notification not found', 'RESOURCE_NOT_FOUND');
    }
    return this.mapNotificationDto(doc);
  }

  public async markAllAsRead(accountId: string): Promise<{ modifiedCount: number }> {
    const count = await this.repo.markAllAsRead(accountId);
    return { modifiedCount: count };
  }

  public async deleteNotification(
    accountId: string,
    notificationId: string,
  ): Promise<{ deleted: boolean }> {
    const deleted = await this.repo.deleteNotification(notificationId, accountId);
    if (!deleted) {
      throw new NotFoundError('Notification not found', 'RESOURCE_NOT_FOUND');
    }
    return { deleted: true };
  }

  // ==========================================================================
  // PREFERENCE MANAGEMENT
  // ==========================================================================

  public async getPreferences(accountId: string): Promise<NotificationPreferencesDto> {
    const pref = await this.repo.getPreferences(accountId);
    return {
      bookingUpdates: pref.bookingUpdates,
      paymentUpdates: pref.paymentUpdates,
      socialUpdates: pref.socialUpdates,
    };
  }

  public async updatePreferences(
    accountId: string,
    input: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const pref = await this.repo.updatePreferences(accountId, input);
    return {
      bookingUpdates: pref.bookingUpdates,
      paymentUpdates: pref.paymentUpdates,
      socialUpdates: pref.socialUpdates,
    };
  }

  // ==========================================================================
  // EVENT INTEGRATION & OUTBOX DISPATCH
  // ==========================================================================

  public async publishEvent(
    params: PublishNotificationEventParams,
    session?: ClientSession,
  ): Promise<{ notificationId?: string; scheduledOutbox: boolean }> {
    // 0. Suppress self-actions (e.g. liking or commenting on one's own post)
    if (
      params.callerAccountId &&
      params.callerAccountId.toString() === params.recipientAccountId.toString()
    ) {
      return { scheduledOutbox: false };
    }

    // 1. Check user preferences before dispatching notifications
    const prefs = await this.repo.getPreferences(params.recipientAccountId);

    let allowNotification = true;
    if (
      params.notificationType === NOTIFICATION_TYPES.BOOKING_CONFIRMED ||
      params.notificationType === NOTIFICATION_TYPES.BOOKING_CANCELLED ||
      params.notificationType === NOTIFICATION_TYPES.BOOKING_REJECTED
    ) {
      allowNotification = prefs.bookingUpdates;
    } else if (
      params.notificationType === NOTIFICATION_TYPES.PAYMENT_CAPTURED ||
      params.notificationType === NOTIFICATION_TYPES.PAYMENT_FAILED ||
      params.notificationType === NOTIFICATION_TYPES.PAYMENT_RECONCILIATION_REQUIRED
    ) {
      allowNotification = prefs.paymentUpdates;
    } else if (
      params.notificationType === NOTIFICATION_TYPES.SOCIAL_NEW_FOLLOWER ||
      params.notificationType === NOTIFICATION_TYPES.SOCIAL_COMMENT ||
      params.notificationType === NOTIFICATION_TYPES.SOCIAL_LIKE
    ) {
      allowNotification = prefs.socialUpdates;
    }

    if (!allowNotification) {
      return { scheduledOutbox: false };
    }

    // 2. Persist in-app Notification record
    const notif = await this.repo.createNotification(
      {
        recipientAccountId: params.recipientAccountId,
        notificationType: params.notificationType,
        title: params.title,
        body: params.body,
        dataPayload: params.dataPayload,
        relatedResourceType: params.relatedResourceType,
        relatedResourceId: params.relatedResourceId,
      },
      session,
    );

    // 3. Persist Outbox record with unique idempotencyKey
    const outboxRecord = await this.repo.createOutboxRecord(
      {
        notificationId: notif._id,
        recipientAccountId: params.recipientAccountId,
        idempotencyKey: params.idempotencyKey,
        eventType: params.notificationType,
        payload: {
          title: params.title,
          body: params.body,
          data: params.dataPayload,
        },
      },
      session,
    );

    return {
      notificationId: notif._id.toString(),
      scheduledOutbox: !!outboxRecord,
    };
  }

  // ==========================================================================
  // PRIVATE DTO HELPERS
  // ==========================================================================

  private mapDeviceDto(doc: IDeviceTokenDocument): DeviceDto {
    const raw = doc.deviceToken || '';
    // Mask token: e.g. fcm_...abcd or fcm_1234...9988
    const masked =
      raw.length > 12
        ? `${raw.substring(0, 6)}...${raw.substring(raw.length - 4)}`
        : '***masked***';

    return {
      id: doc._id.toString(),
      platform: doc.platform,
      maskedToken: masked,
      deviceId: doc.deviceId,
      isActive: doc.isActive,
      lastSeenAt: doc.lastSeenAt ? doc.lastSeenAt.toISOString() : new Date().toISOString(),
      createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    };
  }

  private mapNotificationDto(doc: INotificationDocument): NotificationDto {
    let payloadObj: Record<string, string> | undefined;
    if (doc.dataPayload) {
      if (doc.dataPayload instanceof Map) {
        payloadObj = Object.fromEntries(doc.dataPayload);
      } else if (typeof doc.dataPayload === 'object') {
        payloadObj = { ...(doc.dataPayload as Record<string, string>) };
      }
    }

    return {
      id: doc._id.toString(),
      recipientAccountId: doc.recipientAccountId.toString(),
      notificationType: doc.notificationType,
      title: doc.title,
      body: doc.body,
      dataPayload: payloadObj,
      relatedResourceType: doc.relatedResourceType,
      relatedResourceId: doc.relatedResourceId,
      isRead: doc.isRead,
      readAt: doc.readAt ? doc.readAt.toISOString() : null,
      deliveryStatus: doc.deliveryStatus,
      createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
    };
  }
}

export const notificationService = new NotificationService();
