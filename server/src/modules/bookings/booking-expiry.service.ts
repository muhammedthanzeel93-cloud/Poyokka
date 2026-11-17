import { ADMIN_AUDIT_ACTIONS, AUDIT_TARGET_ENTITY_TYPES } from '@kerala-tourism/constants';
import { HoldExpiryResultDto } from '@kerala-tourism/shared-types';
import { BookingsRepository, bookingsRepository } from './bookings.repository';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';

export class BookingHoldExpiryService {
  private isProcessing = false;

  constructor(
    private readonly repo: BookingsRepository = bookingsRepository,
    private readonly auditService: AuditLogService = auditLogService,
  ) {}

  public setRepository(repo: BookingsRepository): void {
    (this as unknown as { repo: BookingsRepository }).repo = repo;
  }

  public setAuditService(service: AuditLogService): void {
    (this as unknown as { auditService: AuditLogService }).auditService = service;
  }

  /**
   * Scans and processes expired inventory holds in batches.
   * Atomically transitions holds from ACTIVE to EXPIRED, restores room inventory,
   * updates associated booking status to EXPIRED, and records audit trails.
   */
  public async processExpiredHoldsBatch(
    batchSize: number = 50,
    referenceNow: Date = new Date(),
  ): Promise<HoldExpiryResultDto> {
    if (this.isProcessing) {
      return {
        scannedCount: 0,
        expiredCount: 0,
        restoredCount: 0,
        failedCount: 0,
      };
    }

    this.isProcessing = true;

    const result: HoldExpiryResultDto = {
      scannedCount: 0,
      expiredCount: 0,
      restoredCount: 0,
      failedCount: 0,
    };

    try {
      const expiredHolds = await this.repo.findExpiredActiveHolds(referenceNow, batchSize);
      result.scannedCount = expiredHolds.length;

      for (const hold of expiredHolds) {
        try {
          const expiredResult = await this.repo.withTransaction(async (session) => {
            return this.repo.expireHold(hold._id, session);
          });

          if (expiredResult) {
            result.expiredCount += 1;
            result.restoredCount += 1;

            try {
              await this.auditService.recordAdminAction({
                actorAccountId: hold.touristAccountId,
                actorAccountType: 'TOURIST',
                action: ADMIN_AUDIT_ACTIONS.BOOKING_HOLD_EXPIRED,
                targetEntityType: AUDIT_TARGET_ENTITY_TYPES.INVENTORY_HOLD,
                targetEntityId: hold._id,
                reason: `Inventory hold expired at ${hold.expiresAt.toISOString()}; inventory restored automatically`,
                beforeState: { status: 'ACTIVE' },
                afterState: { status: 'EXPIRED' },
              });
            } catch {
              // Non-blocking audit record
            }
          }
        } catch {
          result.failedCount += 1;
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return result;
  }

  /**
   * Starts a non-blocking background timer that processes expired holds periodically.
   */
  public startPeriodicWorker(intervalMs: number = 60000): NodeJS.Timeout {
    const timer = setInterval(async () => {
      try {
        await this.processExpiredHoldsBatch();
      } catch {
        // Suppress unhandled interval rejections
      }
    }, intervalMs);

    if (timer.unref) {
      timer.unref();
    }

    return timer;
  }

  public stopPeriodicWorker(timer: NodeJS.Timeout): void {
    clearInterval(timer);
  }
}

export const bookingHoldExpiryService = new BookingHoldExpiryService();
