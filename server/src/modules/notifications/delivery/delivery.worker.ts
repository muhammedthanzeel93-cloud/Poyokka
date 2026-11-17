import {
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_RULES,
} from '@kerala-tourism/constants';
import {
  NotificationRepository,
  notificationRepository,
} from '../notification.repository';
import {
  INotificationProvider,
} from '../providers/notification-provider.interface';
import {
  NotificationProviderFactory,
} from '../providers/notification-provider.factory';

export interface DeliveryBatchResult {
  scannedCount: number;
  deliveredCount: number;
  failedCount: number;
  deadLetterCount: number;
  invalidTokensCleanedCount: number;
}

export class NotificationDeliveryWorker {
  private isProcessing = false;

  constructor(
    private readonly repo: NotificationRepository = notificationRepository,
    private provider?: INotificationProvider,
  ) {}

  public setRepository(repo: NotificationRepository): void {
    (this as unknown as { repo: NotificationRepository }).repo = repo;
  }

  public setProvider(provider: INotificationProvider): void {
    this.provider = provider;
  }

  private getProvider(): INotificationProvider {
    return this.provider || NotificationProviderFactory.getProvider();
  }

  public async processPendingOutboxBatch(
    batchSize: number = NOTIFICATION_RULES.BATCH_SIZE,
    referenceNow: Date = new Date(),
  ): Promise<DeliveryBatchResult> {
    if (this.isProcessing) {
      return {
        scannedCount: 0,
        deliveredCount: 0,
        failedCount: 0,
        deadLetterCount: 0,
        invalidTokensCleanedCount: 0,
      };
    }

    this.isProcessing = true;

    const result: DeliveryBatchResult = {
      scannedCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      deadLetterCount: 0,
      invalidTokensCleanedCount: 0,
    };

    try {
      const items = typeof this.repo.claimPendingOutboxBatch === 'function'
        ? await this.repo.claimPendingOutboxBatch(batchSize, referenceNow)
        : await this.repo.findPendingOutboxBatch(batchSize, referenceNow);
      result.scannedCount = items.length;

      const provider = this.getProvider();

      for (const item of items) {
        try {
          // 1. Fetch active device tokens for the recipient account
          const tokens = await this.repo.findActiveTokensByAccountId(
            item.recipientAccountId,
          );

          // If no mobile device has registered push tokens yet, consider outbox completed
          if (tokens.length === 0) {
            await this.repo.updateOutboxResult(item._id, {
              status: NOTIFICATION_DELIVERY_STATUSES.DELIVERED,
              processedAt: new Date(),
            });
            await this.repo.updateDeliveryStatus(
              item.notificationId,
              NOTIFICATION_DELIVERY_STATUSES.DELIVERED,
            );
            result.deliveredCount++;
            continue;
          }

          // 2. Dispatch push notification via provider
          const pushResult = await provider.sendPush({
            deviceTokens: tokens,
            title: item.payload.title,
            body: item.payload.body,
            data: item.payload.data,
          });

          // 3. Clean up any invalid or unregistered tokens returned by provider
          if (pushResult.invalidTokens && pushResult.invalidTokens.length > 0) {
            const cleaned = await this.repo.deactivateTokens(
              pushResult.invalidTokens,
              'FCM_TOKEN_UNREGISTERED',
            );
            result.invalidTokensCleanedCount += cleaned;
          }

          if (pushResult.success) {
            // Success
            await this.repo.updateOutboxResult(item._id, {
              status: NOTIFICATION_DELIVERY_STATUSES.DELIVERED,
              processedAt: new Date(),
            });
            await this.repo.updateDeliveryStatus(
              item.notificationId,
              NOTIFICATION_DELIVERY_STATUSES.DELIVERED,
            );
            result.deliveredCount++;
          } else {
            // Failure - handle retry or dead-letter
            const nextAttempt = item.attempts + 1;
            if (nextAttempt >= item.maxAttempts) {
              await this.repo.updateOutboxResult(item._id, {
                status: NOTIFICATION_DELIVERY_STATUSES.DEAD_LETTER,
                attempts: nextAttempt,
                lastError: pushResult.error || 'Max delivery attempts exceeded',
                processedAt: new Date(),
              });
              await this.repo.updateDeliveryStatus(
                item.notificationId,
                NOTIFICATION_DELIVERY_STATUSES.FAILED,
              );
              result.deadLetterCount++;
            } else {
              // Bounded exponential backoff: delayMs = min(60000, 1000 * 2^attempts)
              const delayMs = Math.min(
                NOTIFICATION_RULES.BACKOFF_MAX_MS,
                NOTIFICATION_RULES.BACKOFF_BASE_MS * Math.pow(2, item.attempts),
              );
              const nextRetryAt = new Date(Date.now() + delayMs);

              await this.repo.updateOutboxResult(item._id, {
                status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
                attempts: nextAttempt,
                nextRetryAt,
                lastError: pushResult.error || 'Temporary provider failure',
              });
              result.failedCount++;
            }
          }
        } catch (itemErr: unknown) {
          const errorMsg =
            itemErr instanceof Error ? itemErr.message : 'Unknown item processing error';
          const nextAttempt = item.attempts + 1;

          if (nextAttempt >= item.maxAttempts) {
            await this.repo.updateOutboxResult(item._id, {
              status: NOTIFICATION_DELIVERY_STATUSES.DEAD_LETTER,
              attempts: nextAttempt,
              lastError: errorMsg,
              processedAt: new Date(),
            });
            result.deadLetterCount++;
          } else {
            const delayMs = Math.min(
              NOTIFICATION_RULES.BACKOFF_MAX_MS,
              NOTIFICATION_RULES.BACKOFF_BASE_MS * Math.pow(2, item.attempts),
            );
            await this.repo.updateOutboxResult(item._id, {
              status: NOTIFICATION_DELIVERY_STATUSES.PENDING,
              attempts: nextAttempt,
              nextRetryAt: new Date(Date.now() + delayMs),
              lastError: errorMsg,
            });
            result.failedCount++;
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return result;
  }
}

export const notificationDeliveryWorker = new NotificationDeliveryWorker();
