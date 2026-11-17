import { Schema, model, Document, Model, Types } from 'mongoose';
import {
  DEVICE_PLATFORMS,
  NOTIFICATION_PROVIDERS,
} from '@kerala-tourism/constants';
import { DevicePlatform, NotificationProvider } from '@kerala-tourism/shared-types';

export interface IDeviceTokenDocument extends Document {
  accountId: Types.ObjectId;
  deviceToken: string;
  platform: DevicePlatform;
  provider: NotificationProvider;
  deviceId?: string;
  isActive: boolean;
  lastSeenAt: Date;
  invalidatedAt?: Date | null;
  invalidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const deviceTokenSchema = new Schema<IDeviceTokenDocument>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
      index: true,
    },
    deviceToken: {
      type: String,
      required: [true, 'Device token is required'],
      trim: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: {
        values: Object.values(DEVICE_PLATFORMS),
        message: 'Invalid device platform: {VALUE}',
      },
      required: [true, 'Platform is required'],
    },
    provider: {
      type: String,
      enum: {
        values: Object.values(NOTIFICATION_PROVIDERS),
        message: 'Invalid notification provider: {VALUE}',
      },
      default: NOTIFICATION_PROVIDERS.FCM,
      required: true,
    },
    deviceId: {
      type: String,
      trim: true,
      sparse: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    invalidatedAt: {
      type: Date,
      default: null,
    },
    invalidReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'deviceTokens',
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret['__v'];
        return ret;
      },
    },
  },
);

// Indexes
deviceTokenSchema.index({ accountId: 1, isActive: 1 });
deviceTokenSchema.index({ accountId: 1, deviceId: 1 }, { sparse: true });
// 90-day TTL automatic cleanup on inactive/stale device tokens
deviceTokenSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const DeviceTokenModel: Model<IDeviceTokenDocument> =
  model<IDeviceTokenDocument>('DeviceToken', deviceTokenSchema);
