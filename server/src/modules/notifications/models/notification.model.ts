import { Schema, model, Document, Model, Types } from 'mongoose';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_RULES,
} from '@kerala-tourism/constants';
import {
  NotificationType,
  NotificationDeliveryStatus,
} from '@kerala-tourism/shared-types';

export interface INotificationDocument extends Document {
  recipientAccountId: Types.ObjectId;
  notificationType: NotificationType;
  title: string;
  body: string;
  dataPayload?: Record<string, string>;
  relatedResourceType?: 'BOOKING' | 'PAYMENT' | 'POST' | 'ACCOUNT';
  relatedResourceId?: string;
  isRead: boolean;
  readAt?: Date | null;
  deliveryStatus: NotificationDeliveryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const notificationSchema = new Schema<INotificationDocument>(
  {
    recipientAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Recipient account ID is required'],
    },
    notificationType: {
      type: String,
      enum: {
        values: Object.values(NOTIFICATION_TYPES),
        message: 'Invalid notification type: {VALUE}',
      },
      required: [true, 'Notification type is required'],
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [
        NOTIFICATION_RULES.MAX_TITLE_LENGTH,
        `Title cannot exceed ${NOTIFICATION_RULES.MAX_TITLE_LENGTH} characters`,
      ],
    },
    body: {
      type: String,
      required: [true, 'Notification body is required'],
      trim: true,
      maxlength: [
        NOTIFICATION_RULES.MAX_BODY_LENGTH,
        `Body cannot exceed ${NOTIFICATION_RULES.MAX_BODY_LENGTH} characters`,
      ],
    },
    dataPayload: {
      type: Map,
      of: String,
      default: {},
    },
    relatedResourceType: {
      type: String,
      enum: ['BOOKING', 'PAYMENT', 'POST', 'ACCOUNT'],
      required: false,
    },
    relatedResourceId: {
      type: String,
      trim: true,
      required: false,
    },
    isRead: {
      type: Boolean,
      default: false,
      required: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    deliveryStatus: {
      type: String,
      enum: {
        values: Object.values(NOTIFICATION_DELIVERY_STATUSES),
        message: 'Invalid delivery status: {VALUE}',
      },
      default: NOTIFICATION_DELIVERY_STATUSES.PENDING,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'notifications',
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret['__v'];
        return ret;
      },
    },
  },
);

// Compound Indexes for fast recipient listing and unread tray filtering
notificationSchema.index({ recipientAccountId: 1, createdAt: -1 });
notificationSchema.index({ recipientAccountId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ relatedResourceType: 1, relatedResourceId: 1 }, { sparse: true });

export const NotificationModel: Model<INotificationDocument> =
  model<INotificationDocument>('Notification', notificationSchema);
