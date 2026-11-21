import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  PAYMENT_WEBHOOK_STATUSES,
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
  NOTIFICATION_TYPES,
} from '@kerala-tourism/constants';
import {
  BadRequestError,
} from '../../shared/errors/AppError';
import { IPaymentProvider } from './providers/payment-provider.interface';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { PaymentsRepository, paymentsRepository } from './payments.repository';
import { RefundsRepository, refundsRepository } from './refund.repository';
import { BookingsRepository, bookingsRepository } from '../bookings/bookings.repository';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';
import { NotificationService, notificationService } from '../notifications/notification.service';
import {
  PaymentWebhookResultDto,
  IPaymentLean,
  IRefundLean,
  IPaymentWebhookEventLean,
} from './payments.types';

export class WebhookService {
  private repo: PaymentsRepository;
  private refundsRepo: RefundsRepository;
  private bookingsRepo: BookingsRepository;
  private provider: IPaymentProvider;
  private auditService: AuditLogService;
  private notifService: NotificationService;

  constructor(
    repo: PaymentsRepository = paymentsRepository,
    refundsRepo: RefundsRepository = refundsRepository,
    bookingsRepo: BookingsRepository = bookingsRepository,
    provider: IPaymentProvider = PaymentProviderFactory.getProvider(),
    auditService: AuditLogService = auditLogService,
    notifService: NotificationService = notificationService,
  ) {
    this.repo = repo;
    this.refundsRepo = refundsRepo;
    this.bookingsRepo = bookingsRepo;
    this.provider = provider;
    this.auditService = auditService;
    this.notifService = notifService;
  }

  public setRepository(repo: PaymentsRepository): void {
    this.repo = repo;
  }

  public setRefundsRepository(refundsRepo: RefundsRepository): void {
    this.refundsRepo = refundsRepo;
  }

  public setBookingsRepository(bookingsRepo: BookingsRepository): void {
    this.bookingsRepo = bookingsRepo;
  }

  public setProvider(provider: IPaymentProvider): void {
    this.provider = provider;
  }

  public setAuditService(service: AuditLogService): void {
    this.auditService = service;
  }

  public setNotificationService(service: NotificationService): void {
    this.notifService = service;
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
    const refundEntity = payload.payload?.refund?.entity;
    const paymentEntity = payload.payload?.payment?.entity;
    const providerOrderId = paymentEntity?.order_id || payload.payload?.order?.entity?.id;
    const providerPaymentId = paymentEntity?.id || refundEntity?.payment_id;
    const providerRefundId = refundEntity?.id;

    if (!providerOrderId && !providerPaymentId && !providerRefundId) {
      // Event without order, payment, or refund metadata
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

    try {
      // Dispatch refund events
      if (event === 'refund.processed') {
        return await this.handleRefundProcessed(
          payload,
          providerEventId,
          webhookEventRecord,
          providerRefundId,
          providerPaymentId,
          providerOrderId,
        );
      }

      if (event === 'refund.failed') {
        return await this.handleRefundFailed(
          payload,
          providerEventId,
          webhookEventRecord,
          providerRefundId,
          providerPaymentId,
          providerOrderId,
        );
      }

      // Locate internal payment record for payment events
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

  private async findTargetRefund(
    providerRefundId?: string,
    refundEntity?: any,
    paymentId?: Types.ObjectId | string,
  ): Promise<IRefundLean | null> {
    // 1. Try finding by providerRefundId
    if (providerRefundId) {
      const byProviderId = await this.refundsRepo.findRefundByProviderRefundId(providerRefundId);
      if (byProviderId) return byProviderId;
    }

    // 2. Try finding by refundReference in notes or receipt
    const refFromNotes = refundEntity?.notes?.refundReference;
    if (refFromNotes) {
      const byRef = await this.refundsRepo.findRefundByReference(refFromNotes);
      if (byRef) return byRef;
    }

    const receipt = refundEntity?.receipt;
    if (receipt) {
      const cleanedReceipt = typeof receipt === 'string' ? receipt.replace(/^rcpt_/, '') : '';
      if (cleanedReceipt) {
        const byReceipt = await this.refundsRepo.findRefundByReference(cleanedReceipt);
        if (byReceipt) return byReceipt;
      }
    }

    // 3. Fallback: If paymentId is available, find a PENDING or PROCESSING refund for this payment
    if (paymentId) {
      const refunds = await this.refundsRepo.listRefundsByPaymentId(paymentId);
      const pendingRefund = refunds.find(
        (r) =>
          (r.status === REFUND_STATUSES.PENDING || r.status === REFUND_STATUSES.PROCESSING) &&
          (refundEntity?.amount === undefined || r.amountPaise === refundEntity.amount),
      );
      if (pendingRefund) return pendingRefund;
    }

    return null;
  }

  private async handleRefundProcessed(
    payload: any,
    providerEventId: string,
    webhookEventRecord: IPaymentWebhookEventLean,
    providerRefundId?: string,
    providerPaymentId?: string,
    providerOrderId?: string,
  ): Promise<PaymentWebhookResultDto> {
    const refundEntity = payload.payload?.refund?.entity;
    const paymentEntity = payload.payload?.payment?.entity;

    // 1. Locate Payment Record
    let payment: IPaymentLean | null = null;
    if (providerPaymentId) {
      payment = await this.repo.findPaymentByProviderPaymentId(providerPaymentId);
    }
    if (!payment && providerOrderId) {
      payment = await this.repo.findPaymentByProviderOrderId(providerOrderId);
    }
    if (!payment && refundEntity?.notes?.bookingId) {
      payment = await this.repo.findPaymentByBookingId(refundEntity.notes.bookingId);
    }

    // 2. Locate Refund Record
    const refund = await this.findTargetRefund(providerRefundId, refundEntity, payment?._id);

    if (!refund) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_NOT_FOUND',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'REFUND_NOT_FOUND',
      };
    }

    // If payment wasn't found yet, resolve via refund.paymentId
    if (!payment) {
      payment = await this.repo.findPaymentById(refund.paymentId);
    }

    if (!payment) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'PAYMENT_RECORD_NOT_FOUND',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'PAYMENT_NOT_FOUND',
      };
    }

    // 3. Validate payment identity match
    if (
      providerPaymentId &&
      payment.providerPaymentId &&
      payment.providerPaymentId !== providerPaymentId
    ) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'PROVIDER_PAYMENT_ID_MISMATCH',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'PAYMENT_MISMATCH',
      };
    }

    // 4. Validate Amount and Currency
    if (refundEntity?.amount !== undefined && refundEntity.amount !== refund.amountPaise) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_AMOUNT_MISMATCH',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'AMOUNT_MISMATCH',
      };
    }

    const webhookCurrency = refundEntity?.currency || paymentEntity?.currency;
    if (
      webhookCurrency &&
      payment.currency &&
      webhookCurrency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_CURRENCY_MISMATCH',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'CURRENCY_MISMATCH',
      };
    }

    // 5. Check Idempotency & Conflict Guard
    if (refund.status === REFUND_STATUSES.PROCESSED) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.PROCESSED,
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'ALREADY_PROCESSED',
      };
    }

    if (refund.status === REFUND_STATUSES.FAILED) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_ALREADY_FAILED',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'CONFLICT',
      };
    }

    // 6. Atomic State Transition
    const processedAt = refundEntity?.created_at
      ? new Date(refundEntity.created_at * 1000)
      : new Date();

    const updatedRefund = await this.refundsRepo.transitionRefundStatus(
      refund._id,
      [REFUND_STATUSES.PENDING, REFUND_STATUSES.PROCESSING],
      REFUND_STATUSES.PROCESSED,
      {
        providerRefundId: providerRefundId || refund.providerRefundId,
        processedAt,
      },
    );

    if (!updatedRefund) {
      // Check if another concurrent thread transitioned it to PROCESSED
      const current = await this.refundsRepo.findRefundById(refund._id);
      if (current?.status === REFUND_STATUSES.PROCESSED) {
        await this.repo.updateWebhookEventStatus(
          webhookEventRecord._id,
          PAYMENT_WEBHOOK_STATUSES.PROCESSED,
        );
        return {
          received: true,
          event: payload.event,
          eventId: providerEventId,
          status: 'ALREADY_PROCESSED',
        };
      }
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'CONCURRENT_TRANSITION_CONFLICT',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'CONFLICT',
      };
    }

    // 7. Atomic Payment Balance Settlement
    const settledPayment = await this.repo.settleRefundBalance(
      payment._id,
      refund.amountPaise,
      providerRefundId || refund._id.toString(),
      refund.reason,
    );

    const isFullyRefunded =
      settledPayment?.status === PAYMENT_STATUSES.REFUNDED ||
      (settledPayment?.cumulativeRefundedPaise || 0) >= payment.amountPaise;

    // 8. Booking & Inventory Safety (Full Refund Only)
    if (isFullyRefunded) {
      const booking = await this.bookingsRepo.findBookingById(payment.bookingId);
      if (
        booking &&
        booking.status !== BOOKING_STATUSES.CANCELLED &&
        booking.status !== BOOKING_STATUSES.EXPIRED
      ) {
        await this.bookingsRepo.updateBooking(booking._id, {
          status: BOOKING_STATUSES.CANCELLED,
        });

        // Zero phantom inventory check: only release hold if hold was CONSUMED
        const hold = await this.bookingsRepo.findHoldById(payment.holdId);
        if (hold && hold.status === INVENTORY_HOLD_STATUSES.CONSUMED) {
          await this.bookingsRepo.releaseHold(payment.holdId);
        }
      }
    }

    // 9. Immutable Audit Logging
    await this.auditService.recordAdminAction({
      actorAccountId: payment.touristAccountId,
      actorAccountType: 'TOURIST',
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
      targetEntityId: payment._id,
      targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
      reason: refund.reason || 'Refund processed via Razorpay webhook',
      beforeState: {
        refundStatus: refund.status,
        paymentStatus: payment.status,
        cumulativeRefundedPaise: payment.cumulativeRefundedPaise,
      },
      afterState: {
        refundStatus: REFUND_STATUSES.PROCESSED,
        paymentStatus: settledPayment?.status || (isFullyRefunded ? PAYMENT_STATUSES.REFUNDED : PAYMENT_STATUSES.CAPTURED),
        providerRefundId: providerRefundId || refund.providerRefundId,
        cumulativeRefundedPaise: settledPayment?.cumulativeRefundedPaise,
      },
    });

    // 10. Guest Notification Dispatch
    await this.notifService
      .publishEvent({
        recipientAccountId: payment.touristAccountId.toString(),
        notificationType: NOTIFICATION_TYPES.PAYMENT_REFUNDED,
        title: 'Refund Processed',
        body: `A refund of ₹${(refund.amountPaise / 100).toFixed(2)} for payment ${payment.paymentReference} has been processed to your original payment method.`,
        dataPayload: {
          route: 'booking_details',
          bookingId: payment.bookingId.toString(),
          paymentId: payment._id.toString(),
          refundId: providerRefundId || refund._id.toString(),
        },
        relatedResourceType: 'PAYMENT',
        relatedResourceId: payment._id.toString(),
        idempotencyKey: `evt_rfnd_proc_${refund._id.toString()}`,
      })
      .catch((err) => console.error('[Notification Publish Error]:', err));

    // 11. Complete Webhook Event
    await this.repo.updateWebhookEventStatus(
      webhookEventRecord._id,
      PAYMENT_WEBHOOK_STATUSES.PROCESSED,
    );

    return {
      received: true,
      event: payload.event,
      eventId: providerEventId,
      status: 'PROCESSED',
    };
  }

  private async handleRefundFailed(
    payload: any,
    providerEventId: string,
    webhookEventRecord: IPaymentWebhookEventLean,
    providerRefundId?: string,
    providerPaymentId?: string,
    providerOrderId?: string,
  ): Promise<PaymentWebhookResultDto> {
    const refundEntity = payload.payload?.refund?.entity;
    const paymentEntity = payload.payload?.payment?.entity;

    // 1. Locate Payment Record
    let payment: IPaymentLean | null = null;
    if (providerPaymentId) {
      payment = await this.repo.findPaymentByProviderPaymentId(providerPaymentId);
    }
    if (!payment && providerOrderId) {
      payment = await this.repo.findPaymentByProviderOrderId(providerOrderId);
    }
    if (!payment && refundEntity?.notes?.bookingId) {
      payment = await this.repo.findPaymentByBookingId(refundEntity.notes.bookingId);
    }

    // 2. Locate Refund Record
    const refund = await this.findTargetRefund(providerRefundId, refundEntity, payment?._id);

    if (!refund) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_NOT_FOUND',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'REFUND_NOT_FOUND',
      };
    }

    // If payment wasn't found yet, resolve via refund.paymentId
    if (!payment) {
      payment = await this.repo.findPaymentById(refund.paymentId);
    }

    if (!payment) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'PAYMENT_RECORD_NOT_FOUND',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'PAYMENT_NOT_FOUND',
      };
    }

    // 3. Validate payment identity match
    if (
      providerPaymentId &&
      payment.providerPaymentId &&
      payment.providerPaymentId !== providerPaymentId
    ) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'PROVIDER_PAYMENT_ID_MISMATCH',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'PAYMENT_MISMATCH',
      };
    }

    // 4. Validate Amount and Currency
    if (refundEntity?.amount !== undefined && refundEntity.amount !== refund.amountPaise) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_AMOUNT_MISMATCH',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'AMOUNT_MISMATCH',
      };
    }

    const webhookCurrency = refundEntity?.currency || paymentEntity?.currency;
    if (
      webhookCurrency &&
      payment.currency &&
      webhookCurrency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'REFUND_CURRENCY_MISMATCH',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'CURRENCY_MISMATCH',
      };
    }

    // 5. Check Idempotency & Monotonic Protection
    if (refund.status === REFUND_STATUSES.FAILED) {
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.PROCESSED,
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'ALREADY_FAILED',
      };
    }

    if (refund.status === REFUND_STATUSES.PROCESSED) {
      // Critical monotonic invariant: refund.failed CANNOT downgrade a PROCESSED refund
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'CANNOT_FAIL_PROCESSED_REFUND',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'CONFLICT',
      };
    }

    // 6. Atomic State Transition
    const failureCode = refundEntity?.error_code || 'REFUND_FAILED';
    const failureDescription = refundEntity?.error_description || 'Refund failed at provider';

    const updatedRefund = await this.refundsRepo.transitionRefundStatus(
      refund._id,
      [REFUND_STATUSES.PENDING, REFUND_STATUSES.PROCESSING],
      REFUND_STATUSES.FAILED,
      {
        failureCode,
        failureDescription,
      },
    );

    if (!updatedRefund) {
      const current = await this.refundsRepo.findRefundById(refund._id);
      if (current?.status === REFUND_STATUSES.FAILED) {
        await this.repo.updateWebhookEventStatus(
          webhookEventRecord._id,
          PAYMENT_WEBHOOK_STATUSES.PROCESSED,
        );
        return {
          received: true,
          event: payload.event,
          eventId: providerEventId,
          status: 'ALREADY_FAILED',
        };
      }
      await this.repo.updateWebhookEventStatus(
        webhookEventRecord._id,
        PAYMENT_WEBHOOK_STATUSES.FAILED,
        'CONCURRENT_TRANSITION_CONFLICT',
      );
      return {
        received: true,
        event: payload.event,
        eventId: providerEventId,
        status: 'CONFLICT',
      };
    }

    // 7. Release Reserved Refund Balance
    const releasedPayment = await this.repo.releaseRefundBalance(
      payment._id,
      refund.amountPaise,
    );

    // 8. Immutable Audit Logging
    await this.auditService.recordAdminAction({
      actorAccountId: payment.touristAccountId,
      actorAccountType: 'TOURIST',
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
      targetEntityId: payment._id,
      targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
      reason: `Refund failed via Razorpay webhook: ${failureCode} - ${failureDescription}`,
      beforeState: {
        refundStatus: refund.status,
        paymentStatus: payment.status,
      },
      afterState: {
        refundStatus: REFUND_STATUSES.FAILED,
        failureCode,
        paymentStatus: releasedPayment?.status || payment.status,
      },
    });

    // 9. Guest Notification Dispatch
    await this.notifService
      .publishEvent({
        recipientAccountId: payment.touristAccountId.toString(),
        notificationType: NOTIFICATION_TYPES.PAYMENT_REFUNDED,
        title: 'Refund Failed',
        body: `The refund of ₹${(refund.amountPaise / 100).toFixed(2)} for payment ${payment.paymentReference} could not be processed. Our support team has been notified.`,
        dataPayload: {
          route: 'booking_details',
          bookingId: payment.bookingId.toString(),
          paymentId: payment._id.toString(),
          refundId: refund._id.toString(),
          failureCode,
        },
        relatedResourceType: 'PAYMENT',
        relatedResourceId: payment._id.toString(),
        idempotencyKey: `evt_rfnd_fail_${refund._id.toString()}`,
      })
      .catch((err) => console.error('[Notification Publish Error]:', err));

    // 10. Complete Webhook Event
    await this.repo.updateWebhookEventStatus(
      webhookEventRecord._id,
      PAYMENT_WEBHOOK_STATUSES.PROCESSED,
    );

    return {
      received: true,
      event: payload.event,
      eventId: providerEventId,
      status: 'PROCESSED',
    };
  }
}

export const webhookService = new WebhookService();
