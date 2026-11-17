import { env } from '../../../config/env';
import { IPaymentProvider } from './payment-provider.interface';
import { RazorpayPaymentProvider } from './razorpay.provider';

export class PaymentProviderFactory {
  private static instance: IPaymentProvider | null = null;

  public static getProvider(providerName: string = 'RAZORPAY'): IPaymentProvider {
    if (!this.instance || this.instance.providerName !== providerName) {
      if (providerName.toUpperCase() === 'RAZORPAY') {
        this.instance = new RazorpayPaymentProvider(
          env.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key_id',
          env.RAZORPAY_KEY_SECRET || 'rzp_test_placeholder_secret_key_32chars',
          env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_placeholder_32chars',
          env.NODE_ENV === 'test' || env.RAZORPAY_KEY_ID.includes('placeholder'),
        );
      } else {
        throw new Error(`Unsupported payment provider: ${providerName}`);
      }
    }
    return this.instance;
  }

  public static setProvider(provider: IPaymentProvider | null): void {
    this.instance = provider;
  }

  public static reset(): void {
    this.instance = null;
  }
}
