import crypto from 'crypto';
import { PAYMENT_PROVIDERS } from '@kerala-tourism/constants';
import { AppError, BadGatewayError } from '../../../shared/errors/AppError';
import {
  IPaymentProvider,
  CreateProviderOrderInput,
  ProviderOrderResult,
  VerifyProviderPaymentSignatureInput,
  VerifyWebhookSignatureInput,
  ProviderPaymentResult,
} from './payment-provider.interface';

export class RazorpayPaymentProvider implements IPaymentProvider {
  public readonly providerName = PAYMENT_PROVIDERS.RAZORPAY;
  private readonly simulatedOrders: Map<
    string,
    { orderId: string; amountPaise: number; currency: string; receipt: string; notes?: Record<string, string> }
  > = new Map();
  private readonly simulatedPayments: Map<string, ProviderPaymentResult> = new Map();

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly isSimulated: boolean = false,
  ) {}

  public async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrderResult> {
    // If running in sandbox simulation mode (strictly prohibited in production)
    if (this.isSimulated) {
      const orderId = `order_${crypto.randomBytes(8).toString('hex')}`;
      this.simulatedOrders.set(orderId, {
        orderId,
        amountPaise: input.amountPaise,
        currency: input.currency || 'INR',
        receipt: input.receipt,
        notes: input.notes,
      });
      return {
        orderId,
        amountPaise: input.amountPaise,
        currency: input.currency || 'INR',
        status: 'created',
        rawResponse: {
          id: orderId,
          entity: 'order',
          amount: input.amountPaise,
          amount_paid: 0,
          amount_due: input.amountPaise,
          currency: input.currency || 'INR',
          receipt: input.receipt,
          status: 'created',
          attempts: 0,
          notes: input.notes || {},
          created_at: Math.floor(Date.now() / 1000),
          simulated: true,
        },
      };
    }

    // Real Razorpay API integration
    try {
      const authHeader = 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: input.currency || 'INR',
          receipt: input.receipt,
          notes: input.notes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const description = (errorData as any)?.error?.description || `HTTP ${response.status}`;
        throw new BadGatewayError(`Razorpay order creation failed: ${description}`, 'PAYMENT_GATEWAY_ERROR', {
          status: response.status,
          code: (errorData as any)?.error?.code,
        });
      }

      const data = (await response.json()) as any;
      return {
        orderId: data.id,
        amountPaise: data.amount,
        currency: data.currency,
        status: data.status,
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      const safeMsg = err instanceof Error ? err.message : 'Unknown network error';
      throw new BadGatewayError(
        `Payment gateway communication failure during order creation: ${safeMsg}`,
        'PAYMENT_GATEWAY_NETWORK_ERROR',
      );
    }
  }

  public verifyPaymentSignature(input: VerifyProviderPaymentSignatureInput): boolean {
    if (!input.orderId || !input.paymentId || !input.signature) {
      return false;
    }

    try {
      const payload = `${input.orderId}|${input.paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.keySecret)
        .update(payload)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedSignature, 'utf8');
      const actualBuf = Buffer.from(input.signature, 'utf8');

      if (expectedBuf.length !== actualBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  public verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    if (!input.rawBody || !input.signature) {
      return false;
    }

    try {
      const secret = input.webhookSecret || this.webhookSecret;
      const raw = typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody;

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(raw)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedSignature, 'utf8');
      const actualBuf = Buffer.from(input.signature, 'utf8');

      if (expectedBuf.length !== actualBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  public async fetchPayment(
    providerPaymentId: string,
    expectedOrderId?: string,
  ): Promise<ProviderPaymentResult> {
    if (this.isSimulated) {
      // 1. Explicit mock override for testing
      const explicit = this.simulatedPayments.get(providerPaymentId);
      if (explicit) {
        return explicit;
      }

      // 2. Simulated failure convention
      if (providerPaymentId.startsWith('pay_fail_')) {
        return {
          providerPaymentId,
          providerOrderId: expectedOrderId || 'order_simulated_fail',
          amountPaise: 0,
          currency: 'INR',
          status: 'failed',
          errorCode: 'BAD_REQUEST_ERROR',
          errorDescription: 'Simulated gateway payment failure',
        };
      }

      // 3. Find simulated order by expectedOrderId or take the latest created order
      let order = expectedOrderId ? this.simulatedOrders.get(expectedOrderId) : undefined;
      if (!order && this.simulatedOrders.size > 0) {
        order = Array.from(this.simulatedOrders.values()).pop();
      }

      const amountPaise = order ? order.amountPaise : 500000;
      const currency = order ? order.currency : 'INR';
      const orderId = order ? order.orderId : (expectedOrderId || `order_${crypto.randomBytes(8).toString('hex')}`);

      return {
        providerPaymentId,
        providerOrderId: orderId,
        amountPaise,
        currency,
        status: 'captured',
        method: 'upi',
      };
    }

    try {
      const authHeader = 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
      const response = await fetch(`https://api.razorpay.com/v1/payments/${providerPaymentId}`, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const description = (errorData as any)?.error?.description || `HTTP ${response.status}`;
        throw new BadGatewayError(`Razorpay fetch payment failed: ${description}`, 'PAYMENT_GATEWAY_ERROR', {
          status: response.status,
          code: (errorData as any)?.error?.code,
        });
      }

      const data = (await response.json()) as any;
      return {
        providerPaymentId: data.id,
        providerOrderId: data.order_id,
        amountPaise: data.amount,
        currency: data.currency,
        status: data.status,
        method: data.method,
        errorCode: data.error_code,
        errorDescription: data.error_description,
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      const safeMsg = err instanceof Error ? err.message : 'Unknown network error';
      throw new BadGatewayError(
        `Payment gateway communication failure during payment verification: ${safeMsg}`,
        'PAYMENT_GATEWAY_NETWORK_ERROR',
      );
    }
  }

  public setSimulatedPayment(paymentId: string, result: ProviderPaymentResult): void {
    this.simulatedPayments.set(paymentId, result);
  }

  public clearSimulatedData(): void {
    this.simulatedOrders.clear();
    this.simulatedPayments.clear();
  }
}
