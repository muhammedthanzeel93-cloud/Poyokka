import { Schema, model, Document, Types } from 'mongoose';
import { PAYMENT_PROVIDERS, PAYMENT_WEBHOOK_STATUSES } from '@kerala-tourism/constants';
import { PaymentProvider, PaymentWebhookStatus } from '@kerala-tourism/shared-types';

export interface IPaymentWebhookEventDocument extends Document {
  _id: Types.ObjectId;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  paymentId?: Types.ObjectId | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  payloadHash: string;
  processingStatus: PaymentWebhookStatus;
  receivedAt: Date;
  processedAt?: Date | null;
  failureCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentWebhookEventSchema = new Schema<IPaymentWebhookEventDocument>(
  {
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDERS),
      default: PAYMENT_PROVIDERS.RAZORPAY,
      required: true,
      index: true,
    },
    providerEventId: {
      type: String,
      required: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
      index: true,
    },
    providerPaymentId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    providerOrderId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    payloadHash: {
      type: String,
      required: true,
      trim: true,
    },
    processingStatus: {
      type: String,
      enum: Object.values(PAYMENT_WEBHOOK_STATUSES),
      default: PAYMENT_WEBHOOK_STATUSES.RECEIVED,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    failureCode: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'paymentWebhookEvents',
  },
);

// Compound unique index for strict idempotent deduplication
paymentWebhookEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });
// Compound index for querying unprocessed or pending events
paymentWebhookEventSchema.index({ processingStatus: 1, receivedAt: 1 });
// 30-day TTL index for historical log pruning
paymentWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000, background: true });

export const PaymentWebhookEventModel = model<IPaymentWebhookEventDocument>(
  'PaymentWebhookEvent',
  paymentWebhookEventSchema,
);
