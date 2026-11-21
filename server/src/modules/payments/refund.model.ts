import { Schema, model, Document, Types } from 'mongoose';
import { PAYMENT_PROVIDERS, REFUND_STATUSES, PAYMENT_RULES } from '@kerala-tourism/constants';
import { PaymentProvider, RefundStatus } from '@kerala-tourism/shared-types';

export interface IRefundDocument extends Document {
  _id: Types.ObjectId;
  refundReference: string;
  paymentId: Types.ObjectId;
  bookingId: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  provider: PaymentProvider;
  providerPaymentId: string;
  providerRefundId?: string | null;
  amountPaise: number;
  currency: string;
  status: RefundStatus;
  reason?: string | null;
  adminAccountId: Types.ObjectId;
  idempotencyKey?: string | null;
  providerReference?: string | null;
  failureCode?: string | null;
  failureDescription?: string | null;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<IRefundDocument>(
  {
    refundReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    touristAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDERS),
      default: PAYMENT_PROVIDERS.RAZORPAY,
      required: true,
    },
    providerPaymentId: {
      type: String,
      required: true,
      trim: true,
    },
    providerRefundId: {
      type: String,
      default: null,
      trim: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
      max: PAYMENT_RULES.MAX_AMOUNT_PAISE,
    },
    currency: {
      type: String,
      required: true,
      default: PAYMENT_RULES.CURRENCY,
    },
    status: {
      type: String,
      enum: Object.values(REFUND_STATUSES),
      default: REFUND_STATUSES.PENDING,
      index: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    adminAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true,
    },
    providerReference: {
      type: String,
      default: null,
      trim: true,
    },
    failureCode: {
      type: String,
      default: null,
      trim: true,
    },
    failureDescription: {
      type: String,
      default: null,
      trim: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'refunds',
  },
);

refundSchema.index({ paymentId: 1, createdAt: -1 });
refundSchema.index(
  { paymentId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true },
);
refundSchema.index(
  { providerRefundId: 1 },
  { unique: true, sparse: true },
);

export const RefundModel = model<IRefundDocument>('Refund', refundSchema);
