import { Types } from 'mongoose';
import {
  PaymentProvider,
  PaymentStatus,
  PaymentWebhookStatus,
  PaymentDto,
  RazorpayCheckoutDataDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
  PaymentWebhookResultDto,
} from '@kerala-tourism/shared-types';

export interface IPaymentLean {
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

export interface IPaymentWebhookEventLean {
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

export interface CreatePaymentRecordData {
  paymentReference: string;
  bookingId: Types.ObjectId;
  holdId: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  provider: PaymentProvider;
  providerOrderId?: string | null;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
}

export interface ConfirmPaymentHoldParams {
  paymentId: string | Types.ObjectId;
  providerPaymentId: string;
  paidAt?: Date;
  session?: unknown;
}

export type {
  PaymentProvider,
  PaymentStatus,
  PaymentWebhookStatus,
  PaymentDto,
  RazorpayCheckoutDataDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
  PaymentWebhookResultDto,
};
