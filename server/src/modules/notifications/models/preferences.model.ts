import { Schema, model, Document, Model, Types } from 'mongoose';

export interface INotificationPreferenceDocument extends Document {
  accountId: Types.ObjectId;
  bookingUpdates: boolean;
  paymentUpdates: boolean;
  socialUpdates: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const notificationPreferenceSchema = new Schema<INotificationPreferenceDocument>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
      unique: true,
      index: true,
    },
    bookingUpdates: {
      type: Boolean,
      default: true,
      required: true,
    },
    paymentUpdates: {
      type: Boolean,
      default: true,
      required: true,
    },
    socialUpdates: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'notificationPreferences',
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret['__v'];
        return ret;
      },
    },
  },
);

export const NotificationPreferenceModel: Model<INotificationPreferenceDocument> =
  model<INotificationPreferenceDocument>('NotificationPreference', notificationPreferenceSchema);
