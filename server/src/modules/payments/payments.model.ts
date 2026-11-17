import { Schema, model, Document, Types } from 'mongoose';
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES, PAYMENT_RULES } from '@kerala-tourism/constants';
import { PaymentProvider, PaymentStatus } from '@kerala-tourism/shared-types';

export interface IPaymentDocument extends Document {
  _id: Types.ObjectId;
  paymentReference: string;
  bookingId: Types.ObjectId;
  holdId: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  provider: PaymentProvider;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  failureCode?: string | null;
  failureDescription?: string | null;
  reconciliationStatus?: string | null;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPaymentDocument>(
  {
    paymentReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    holdId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryHold',
      required: true,
      index: true,
    },
    touristAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDERS),
      default: PAYMENT_PROVIDERS.RAZORPAY,
      required: true,
      index: true,
    },
    providerOrderId: {
      type: String,
      default: null,
      trim: true,
    },
    providerPaymentId: {
      type: String,
      default: null,
      trim: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: PAYMENT_RULES.MIN_AMOUNT_PAISE,
      max: PAYMENT_RULES.MAX_AMOUNT_PAISE,
    },
    currency: {
      type: String,
      required: true,
      default: PAYMENT_RULES.CURRENCY,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.CREATED,
      index: true,
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
    reconciliationStatus: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'payments',
  },
);

paymentSchema.index({ bookingId: 1, createdAt: -1 });
paymentSchema.index({ touristAccountId: 1, createdAt: -1 });
paymentSchema.index({ provider: 1, providerOrderId: 1 });
paymentSchema.index({ provider: 1, providerPaymentId: 1 });

export const PaymentModel = model<IPaymentDocument>('Payment', paymentSchema);
