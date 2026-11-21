import { Types } from 'mongoose';
import {
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
  PaymentWebhookStatus,
  PaymentDto,
  RefundDto,
  RazorpayCheckoutDataDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
  RefundPaymentResponseDto,
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
  refundId?: string | null;
  refundAmountPaise?: number | null;
  cumulativeRefundedPaise?: number;
  pendingRefundPaise?: number;
  refundedAt?: Date | null;
  refundReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRefundLean {
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
  RefundStatus,
  PaymentWebhookStatus,
  PaymentDto,
  RefundDto,
  RazorpayCheckoutDataDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
  RefundPaymentResponseDto,
  PaymentWebhookResultDto,
};
