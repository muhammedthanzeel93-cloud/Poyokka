import crypto from 'crypto';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_WEBHOOK_STATUSES,
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
} from '@kerala-tourism/constants';
import {
  BadRequestError,
} from '../../shared/errors/AppError';
import { IPaymentProvider } from './providers/payment-provider.interface';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { PaymentsRepository, paymentsRepository } from './payments.repository';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';
import { PaymentWebhookResultDto } from './payments.types';

export class WebhookService {
  private repo: PaymentsRepository;
  private provider: IPaymentProvider;
  private auditService: AuditLogService;

  constructor(
    repo: PaymentsRepository = paymentsRepository,
    provider: IPaymentProvider = PaymentProviderFactory.getProvider(),
    auditService: AuditLogService = auditLogService,
  ) {
    this.repo = repo;
    this.provider = provider;
    this.auditService = auditService;
  }

  public setRepository(repo: PaymentsRepository): void {
    this.repo = repo;
  }

  public setProvider(provider: IPaymentProvider): void {
    this.provider = provider;
  }

  public setAuditService(service: AuditLogService): void {
    this.auditService = service;
  }

  public async processRazorpayWebhook(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
    eventIdHeader?: string,
  ): Promise<PaymentWebhookResultDto> {
    if (!rawBody) {
      throw new BadRequestError('Raw webhook request body is missing', 'MISSING_WEBHOOK_BODY');
    }
    if (!signature) {
      throw new BadRequestError('Razorpay webhook signature header is missing', 'MISSING_WEBHOOK_SIGNATURE');
    }

    // 1. Verify webhook signature
    const isValid = this.provider.verifyWebhookSignature({
      rawBody,
      signature,
    });
    if (!isValid) {
      throw new BadRequestError('Invalid webhook signature', 'INVALID_WEBHOOK_SIGNATURE');
    }

    // 2. Parse body and compute payload hash
    const rawStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const payloadHash = crypto.createHash('sha256').update(rawStr).digest('hex');

    let payload: any;
    try {
      payload = JSON.parse(rawStr);
    } catch {
      throw new BadRequestError('Malformed webhook JSON payload', 'INVALID_WEBHOOK_PAYLOAD');
    }

    const event = payload.event;
    if (!event || typeof event !== 'string') {
      throw new BadRequestError('Webhook event type is missing', 'MISSING_EVENT_TYPE');
    }

    const providerEventId =
      eventIdHeader ||
      payload.event_id ||
      payload.id ||
      `evt_${payloadHash.slice(0, 16)}`;

    // 3. Idempotent Deduplication
    const existingEvent = await this.repo.findWebhookEvent(PAYMENT_PROVIDERS.RAZORPAY, providerEventId);
    if (existingEvent && existingEvent.processingStatus === PAYMENT_WEBHOOK_STATUSES.PROCESSED) {
      return {
        received: true,
        event,
        eventId: providerEventId,
        status: 'ALREADY_PROCESSED',
      };
    }

    // Record webhook event initial state
    const webhookEventRecord = existingEvent || (await this.repo.recordWebhookEvent({
      provider: PAYMENT_PROVIDERS.RAZORPAY,
      providerEventId,
      eventType: event,
      payloadHash,
      processingStatus: PAYMENT_WEBHOOK_STATUSES.RECEIVED,
      receivedAt: new Date(),
    }));

    // 4. Handle supported lifecycle events
    const paymentEntity = payload.payload?.payment?.entity;
    const providerOrderId = paymentEntity?.order_id || payload.payload?.order?.entity?.id;
    const providerPaymentId = paymentEntity?.id;

    if (!providerOrderId && !providerPaymentId) {
      // Event without order or payment metadata
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.IGNORED,
      );
      return {
        received: true,
        event,
        eventId: providerEventId,
        status: 'IGNORED',
      };
    }

    // Locate internal payment record
    let payment = providerOrderId ? await this.repo.findPaymentByProviderOrderId(providerOrderId) : null;
    if (!payment && providerPaymentId) {
      payment = await this.repo.findPaymentByProviderPaymentId(providerPaymentId);
    }

    // Check notes if order_id didn't match directly
    if (!payment && paymentEntity?.notes?.bookingId) {
      payment = await this.repo.findPaymentByBookingId(paymentEntity.notes.bookingId);
    }

    if (!payment) {
      // Payment record not found in system (e.g. unrelated merchant account order)
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.IGNORED,
        'PAYMENT_RECORD_NOT_FOUND',
      );
      return {
        received: true,
        event,
        eventId: providerEventId,
        status: 'PAYMENT_NOT_FOUND',
      };
    }

    // Process specific events
    try {
      if (event === 'payment.captured') {
        // Validate amount and currency match internal order snapshot
        if (paymentEntity?.amount !== undefined && paymentEntity.amount !== payment.amountPaise) {
          await this.repo.updateWebhookEventStatus(
            webhookEventRecord._id,
            PAYMENT_WEBHOOK_STATUSES.FAILED,
            'PAYMENT_AMOUNT_MISMATCH',
          );
          return {
            received: true,
            event,
            eventId: providerEventId,
            status: 'AMOUNT_MISMATCH',
          };
        }

        if (
          paymentEntity?.currency &&
          payment.currency &&
          paymentEntity.currency.toUpperCase() !== payment.currency.toUpperCase()
        ) {
          await this.repo.updateWebhookEventStatus(
            webhookEventRecord._id,
            PAYMENT_WEBHOOK_STATUSES.FAILED,
            'PAYMENT_CURRENCY_MISMATCH',
          );
          return {
            received: true,
            event,
            eventId: providerEventId,
            status: 'CURRENCY_MISMATCH',
          };
        }

        const result = await this.repo.withTransaction(async (session) => {
          return await this.repo.confirmBookingAndConsumeHold(
            {
              paymentId: payment!._id,
              providerPaymentId: providerPaymentId || 'pay_unknown',
              paidAt: paymentEntity?.created_at ? new Date(paymentEntity.created_at * 1000) : new Date(),
            },
            session,
          );
        });

        // Record audit logs
        await this.auditService.recordAdminAction({
          actorAccountId: payment.touristAccountId,
          actorAccountType: 'TOURIST',
          action: ADMIN_AUDIT_ACTIONS.PAYMENT_CAPTURED,
          targetEntityId: payment._id,
          targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
          reason: 'Payment captured via Razorpay webhook',
          beforeState: { status: payment.status },
          afterState: { status: result.payment.status, providerPaymentId },
        });

        if (result.isLatePayment) {
          await this.auditService.recordAdminAction({
            actorAccountId: payment.touristAccountId,
            actorAccountType: 'TOURIST',
            action: ADMIN_AUDIT_ACTIONS.PAYMENT_LATE_RECONCILIATION,
            targetEntityId: payment._id,
            targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
            reason: 'Payment captured after inventory hold expired; flagged for manual review',
            beforeState: { bookingStatus: result.booking.status },
            afterState: {
              reconciliationStatus: result.payment.reconciliationStatus,
              failureCode: result.payment.failureCode,
            },
          });
        } else {
          await this.auditService.recordAdminAction({
            actorAccountId: payment.touristAccountId,
            actorAccountType: 'TOURIST',
            action: ADMIN_AUDIT_ACTIONS.BOOKING_CONFIRMED,
            targetEntityId: result.booking._id,
            targetEntityType: AUDIT_TARGET_ENTITY_TYPES.BOOKING,
            reason: 'Booking confirmed following verified payment capture',
            beforeState: { status: 'AWAITING_PAYMENT' },
            afterState: { status: 'CONFIRMED', paymentId: payment._id },
          });
        }

        await this.repo.updateWebhookEventStatus(
          webhookEventRecord._id,
          PAYMENT_WEBHOOK_STATUSES.PROCESSED,
        );

        return {
          received: true,
          event,
          eventId: providerEventId,
          status: result.isLatePayment ? 'LATE_PAYMENT_FLAGGED' : 'PROCESSED',
        };
      } else if (event === 'payment.failed') {
        // Only update to FAILED if not already CAPTURED (out-of-order monotonic protection)
        if (payment.status !== PAYMENT_STATUSES.CAPTURED) {
          const failureCode = paymentEntity?.error_code || 'PAYMENT_FAILED';
          const failureDescription = paymentEntity?.error_description || 'Payment failed at payment provider';

          await this.repo.updatePayment(payment._id, {
            status: PAYMENT_STATUSES.FAILED,
            failureCode,
            failureDescription,
            providerPaymentId: providerPaymentId || payment.providerPaymentId,
          });

          await this.auditService.recordAdminAction({
            actorAccountId: payment.touristAccountId,
            actorAccountType: 'TOURIST',
            action: ADMIN_AUDIT_ACTIONS.PAYMENT_FAILED,
            targetEntityId: payment._id,
            targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
            reason: `Payment failure webhook received: ${failureCode}`,
            beforeState: { status: payment.status },
            afterState: { status: PAYMENT_STATUSES.FAILED, failureCode },
          });
        }

        await this.repo.updateWebhookEventStatus(
          webhookEventRecord._id,
          PAYMENT_WEBHOOK_STATUSES.PROCESSED,
        );

        return {
          received: true,
          event,
          eventId: providerEventId,
          status: 'PROCESSED',
        };
      } else if (event === 'payment.authorized') {
        // Only update to AUTHORIZED if still PENDING or CREATED
        if (payment.status === PAYMENT_STATUSES.CREATED || payment.status === PAYMENT_STATUSES.PENDING) {
          await this.repo.updatePayment(payment._id, {
            status: PAYMENT_STATUSES.AUTHORIZED,
            providerPaymentId: providerPaymentId || payment.providerPaymentId,
          });
        }

        await this.repo.updateWebhookEventStatus(
          webhookEventRecord._id,
          PAYMENT_WEBHOOK_STATUSES.PROCESSED,
        );

        return {
          received: true,
          event,
          eventId: providerEventId,
          status: 'PROCESSED',
        };
      } else {
        // Other events ignored
        await this.repo.updateWebhookEventStatus(
          webhookEventRecord._id,
          PAYMENT_WEBHOOK_STATUSES.IGNORED,
        );

        return {
          received: true,
          event,
          eventId: providerEventId,
          status: 'IGNORED',
        };
      }
    } catch (processError: unknown) {
      const errorMsg = processError instanceof Error ? processError.message : String(processError);
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        errorMsg.slice(0, 200),
      );
      throw processError;
    }
  }
}

export const webhookService = new WebhookService();
