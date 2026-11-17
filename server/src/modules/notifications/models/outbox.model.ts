import { Schema, model, Document, Model, Types } from 'mongoose';
import { NOTIFICATION_DELIVERY_STATUSES, NOTIFICATION_RULES } from '@kerala-tourism/constants';
import { NotificationDeliveryStatus } from '@kerala-tourism/shared-types';

export interface INotificationOutboxPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface INotificationOutboxDocument extends Document {
  notificationId: Types.ObjectId;
  recipientAccountId: Types.ObjectId;
  idempotencyKey: string;
  eventType: string;
  payload: INotificationOutboxPayload;
  status: NotificationDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  lastError?: string;
  processedAt?: Date | null;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const notificationOutboxSchema = new Schema<INotificationOutboxDocument>(
  {
    notificationId: {
      type: Schema.Types.ObjectId,
      ref: 'Notification',
      required: [true, 'Notification ID is required'],
      index: true,
    },
    recipientAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Recipient account ID is required'],
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: [true, 'Idempotency key is required'],
      unique: true,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      required: [true, 'Event type is required'],
      trim: true,
    },
    payload: {
      title: { type: String, required: true },
      body: { type: String, required: true },
      data: { type: Map, of: String, default: {} },
    },
    status: {
      type: String,
      enum: {
        values: Object.values(NOTIFICATION_DELIVERY_STATUSES),
        message: 'Invalid outbox status: {VALUE}',
      },
      default: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    maxAttempts: {
      type: Number,
      default: NOTIFICATION_RULES.MAX_RETRY_ATTEMPTS,
      required: true,
    },
    nextRetryAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    lastError: {
      type: String,
      trim: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    lockedBy: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'notificationOutbox',
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret['__v'];
        return ret;
      },
    },
  },
);

// Worker polling queue compound index with lock support
notificationOutboxSchema.index({ status: 1, nextRetryAt: 1, lockedAt: 1 });
// 30-day TTL index for historical outbox cleanup
notificationOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const NotificationOutboxModel: Model<INotificationOutboxDocument> =
  model<INotificationOutboxDocument>('NotificationOutbox', notificationOutboxSchema);
