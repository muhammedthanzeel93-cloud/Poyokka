import { PushDeliveryResult, SendPushNotificationParams } from '@kerala-tourism/shared-types';

export interface SendPushNotificationInput extends SendPushNotificationParams {}

export interface INotificationProvider {
  readonly providerName: string;
  sendPush(input: SendPushNotificationInput): Promise<PushDeliveryResult>;
}
