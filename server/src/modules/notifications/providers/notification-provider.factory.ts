import { env } from '../../../config/env';
import { INotificationProvider } from './notification-provider.interface';
import { FirebaseNotificationProvider } from './firebase.provider';

export class NotificationProviderFactory {
  private static instance: INotificationProvider | null = null;

  public static getProvider(providerName: string = 'FCM'): INotificationProvider {
    if (!this.instance || this.instance.providerName !== providerName) {
      if (providerName.toUpperCase() === 'FCM') {
        const isSimulated =
          env.NODE_ENV === 'test' ||
          env.FIREBASE_SIMULATED === 'true' ||
          !env.FIREBASE_PRIVATE_KEY;

        this.instance = new FirebaseNotificationProvider(
          env.FIREBASE_PROJECT_ID,
          env.FIREBASE_CLIENT_EMAIL,
          env.FIREBASE_PRIVATE_KEY,
          isSimulated,
        );
      } else {
        throw new Error(`Unsupported notification provider: ${providerName}`);
      }
    }
    return this.instance;
  }

  public static setProvider(provider: INotificationProvider | null): void {
    this.instance = provider;
  }

  public static reset(): void {
    this.instance = null;
  }
}
