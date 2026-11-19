import { env } from '../../../config/env';
import { IPaymentProvider } from './payment-provider.interface';
import { RazorpayPaymentProvider } from './razorpay.provider';

export class PaymentProviderFactory {
  private static instance: IPaymentProvider | null = null;

  public static getProvider(providerName: string = 'RAZORPAY'): IPaymentProvider {
    if (!this.instance || this.instance.providerName !== providerName) {
      if (providerName.toUpperCase() === 'RAZORPAY') {
        const isProduction = env.NODE_ENV === 'production';
        const hasPlaceholder = !env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID.includes('placeholder');

        if (isProduction && hasPlaceholder) {
          throw new Error('[PaymentProviderFactory] Cannot initialize payment provider with placeholder credentials in production.');
        }

        // Simulation is strictly prohibited in production
        const isSimulated = !isProduction && (env.NODE_ENV === 'test' || hasPlaceholder);

        this.instance = new RazorpayPaymentProvider(
          env.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key_id',
          env.RAZORPAY_KEY_SECRET || 'rzp_test_placeholder_secret_key_32chars',
          env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_placeholder_32chars',
          isSimulated,
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
