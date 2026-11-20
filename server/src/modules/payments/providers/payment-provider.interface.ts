import { PaymentProvider } from '@kerala-tourism/shared-types';

export interface CreateProviderOrderInput {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface ProviderOrderResult {
  orderId: string;
  amountPaise: number;
  currency: string;
  status: string;
  rawResponse?: Record<string, unknown>;
}

export interface VerifyProviderPaymentSignatureInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface VerifyWebhookSignatureInput {
  rawBody: Buffer | string;
  signature: string;
  webhookSecret?: string;
}

export interface ProviderPaymentResult {
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  status: 'captured' | 'authorized' | 'failed' | 'refunded' | 'pending';
  method?: string;
  errorCode?: string;
  errorDescription?: string;
  rawResponse?: Record<string, unknown>;
}

export interface CreateProviderRefundInput {
  providerPaymentId: string;
  amountPaise?: number;
  currency?: string;
  notes?: Record<string, string>;
  receipt?: string;
}

export interface ProviderRefundResult {
  refundId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
  status: 'processed' | 'pending' | 'failed';
  rawResponse?: Record<string, unknown>;
}

export interface IPaymentProvider {
  readonly providerName: PaymentProvider;
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrderResult>;
  verifyPaymentSignature(input: VerifyProviderPaymentSignatureInput): boolean;
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean;
  fetchPayment(providerPaymentId: string, expectedOrderId?: string): Promise<ProviderPaymentResult>;
  createRefund(input: CreateProviderRefundInput): Promise<ProviderRefundResult>;
}
