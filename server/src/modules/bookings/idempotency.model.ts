import { Schema, model, Document, Types } from 'mongoose';

export interface IIdempotencyRecordDocument extends Document {
  _id: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  bookingId?: Types.ObjectId | null;
  holdId?: Types.ObjectId | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const idempotencyRecordSchema = new Schema<IIdempotencyRecordDocument>(
  {
    touristAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    requestHash: {
      type: String,
      required: true,
    },
    responseStatus: {
      type: Number,
      required: true,
    },
    responseBody: {
      type: Schema.Types.Mixed,
      required: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    holdId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryHold',
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'idempotencyKeys',
  },
);

// Compound unique index ensuring idempotency key is scoped per tourist
idempotencyRecordSchema.index({ touristAccountId: 1, key: 1 }, { unique: true });
// TTL index to automatically purge records after their expiresAt timestamp
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecordModel = model<IIdempotencyRecordDocument>('IdempotencyRecord', idempotencyRecordSchema);
