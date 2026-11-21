import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  PAYMENT_PROVIDERS,
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
} from '@kerala-tourism/constants';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from '../../shared/errors/AppError';
import { env } from '../../config/env';
import { IPaymentProvider } from './providers/payment-provider.interface';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { PaymentsRepository, paymentsRepository } from './payments.repository';
import { RefundsRepository, refundsRepository } from './refund.repository';
import { BookingsRepository, bookingsRepository } from '../bookings/bookings.repository';
import { PropertyRepository, propertyRepository } from '../properties/property.repository';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';
import { NotificationService, notificationService } from '../notifications/notification.service';
import { NOTIFICATION_TYPES } from '@kerala-tourism/constants';
import {
  RefundPaymentInput,
  PaymentQueryFilterInput,
} from '@kerala-tourism/validation';
import { generatePaymentReference } from './payments.validation';
import {
  IPaymentLean,
  IRefundLean,
  PaymentDto,
  RefundDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
  RefundPaymentResponseDto,
} from './payments.types';

export class PaymentsService {
  private repo: PaymentsRepository;
  private refundsRepo: RefundsRepository;
  private bookingsRepo: BookingsRepository;
  private propertyRepo: PropertyRepository;
  private provider: IPaymentProvider;
  private auditService: AuditLogService;
  private notifService: NotificationService;

  constructor(
    repo: PaymentsRepository = paymentsRepository,
    bookingsRepo: BookingsRepository = bookingsRepository,
    propertyRepo: PropertyRepository = propertyRepository,
    provider: IPaymentProvider = PaymentProviderFactory.getProvider(),
    auditService: AuditLogService = auditLogService,
    notifService: NotificationService = notificationService,
    refundsRepo: RefundsRepository = refundsRepository,
  ) {
    this.repo = repo;
    this.refundsRepo = refundsRepo;
    this.bookingsRepo = bookingsRepo;
    this.propertyRepo = propertyRepo;
    this.provider = provider;
    this.auditService = auditService;
    this.notifService = notifService;

    // Link in-memory test stores
    this.repo.setBookingMemoryStores(
      this.bookingsRepo.inMemoryBookings,
      this.bookingsRepo.inMemoryHolds,
    );
  }

  public get repository(): PaymentsRepository {
    return this.repo;
  }

  public setRepository(repo: PaymentsRepository): void {
    this.repo = repo;
    this.repo.setBookingMemoryStores(
      this.bookingsRepo.inMemoryBookings,
      this.bookingsRepo.inMemoryHolds,
    );
  }

  public setBookingsRepository(repo: BookingsRepository): void {
    this.bookingsRepo = repo;
    this.repo.setBookingMemoryStores(
      repo.inMemoryBookings,
      repo.inMemoryHolds,
    );
  }

  public setPropertyRepository(repo: PropertyRepository): void {
    this.propertyRepo = repo;
  }

  public setProvider(provider: IPaymentProvider): void {
    this.provider = provider;
  }

  public setAuditService(service: AuditLogService): void {
    this.auditService = service;
  }

  public setRefundsRepository(repo: RefundsRepository): void {
    this.refundsRepo = repo;
  }

  public setNotificationService(service: NotificationService): void {
    this.notifService = service;
  }

  public get refundRepository(): RefundsRepository {
    return this.refundsRepo;
  }

  // ---------------------------------------------------------------------------
  // MAPPER HELPERS
  // ---------------------------------------------------------------------------

  public mapPaymentToDto(payment: IPaymentLean): PaymentDto {
    const cumulative = payment.cumulativeRefundedPaise || 0;
    const pending = payment.pendingRefundPaise || 0;
    const remaining = Math.max(0, payment.amountPaise - (cumulative + pending));

    return {
      id: payment._id.toString(),
      paymentReference: payment.paymentReference,
      bookingId: payment.bookingId.toString(),
      holdId: payment.holdId.toString(),
      touristAccountId: payment.touristAccountId.toString(),
      businessProfileId: payment.businessProfileId.toString(),
      provider: payment.provider,
      providerOrderId: payment.providerOrderId || null,
      providerPaymentId: payment.providerPaymentId || null,
      amountPaise: payment.amountPaise,
      amountInr: payment.amountPaise / 100,
      currency: payment.currency,
      status: payment.status,
      failureCode: payment.failureCode || null,
      failureDescription: payment.failureDescription || null,
      reconciliationStatus: payment.reconciliationStatus || null,
      paidAt: payment.paidAt
        ? payment.paidAt instanceof Date
          ? payment.paidAt.toISOString()
          : new Date(payment.paidAt).toISOString()
        : null,
      refundId: payment.refundId || null,
      refundAmountPaise: payment.refundAmountPaise ?? null,
      cumulativeRefundedPaise: cumulative,
      pendingRefundPaise: pending,
      remainingRefundablePaise: remaining,
      refundedAt: payment.refundedAt
        ? payment.refundedAt instanceof Date
          ? payment.refundedAt.toISOString()
          : new Date(payment.refundedAt).toISOString()
        : null,
      refundReason: payment.refundReason || null,
      createdAt:
        payment.createdAt instanceof Date
          ? payment.createdAt.toISOString()
          : new Date(payment.createdAt).toISOString(),
      updatedAt:
        payment.updatedAt instanceof Date
          ? payment.updatedAt.toISOString()
          : new Date(payment.updatedAt).toISOString(),
    };
  }

  public mapRefundToDto(refund: IRefundLean): RefundDto {
    return {
      id: refund._id.toString(),
      refundReference: refund.refundReference,
      paymentId: refund.paymentId.toString(),
      bookingId: refund.bookingId.toString(),
      touristAccountId: refund.touristAccountId.toString(),
      provider: refund.provider,
      providerPaymentId: refund.providerPaymentId,
      providerRefundId: refund.providerRefundId || null,
      amountPaise: refund.amountPaise,
      amountInr: refund.amountPaise / 100,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason || null,
      adminAccountId: refund.adminAccountId.toString(),
      idempotencyKey: refund.idempotencyKey || null,
      providerReference: refund.providerReference || null,
      failureCode: refund.failureCode || null,
      failureDescription: refund.failureDescription || null,
      processedAt: refund.processedAt
        ? refund.processedAt instanceof Date
          ? refund.processedAt.toISOString()
          : new Date(refund.processedAt).toISOString()
        : null,
      createdAt:
        refund.createdAt instanceof Date
          ? refund.createdAt.toISOString()
          : new Date(refund.createdAt).toISOString(),
      updatedAt:
        refund.updatedAt instanceof Date
          ? refund.updatedAt.toISOString()
          : new Date(refund.updatedAt).toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // PAYMENT INITIATION
  // ---------------------------------------------------------------------------

  public async initiatePayment(
    touristAccountId: string,
    bookingId: string,
    idempotencyKey?: string,
  ): Promise<CreatePaymentResponseDto> {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const cached = await this.bookingsRepo.findIdempotencyRecord(touristAccountId, idempotencyKey);
      if (cached) {
        return cached.responseBody as CreatePaymentResponseDto;
      }
    }

    // 2. Fetch & Validate Booking
    const booking = await this.bookingsRepo.findBookingById(bookingId);
    if (!booking || booking.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Booking not found', 'RESOURCE_NOT_FOUND');
    }

    if (booking.status !== BOOKING_STATUSES.AWAITING_PAYMENT) {
      throw new BadRequestError(
        `Booking is not eligible for payment in status: ${booking.status}`,
        'INVALID_BOOKING_STATUS',
      );
    }

    // 3. Fetch & Validate Associated Hold
    if (!booking.holdId) {
      throw new BadRequestError('Booking does not have an associated inventory hold', 'MISSING_HOLD');
    }

    const hold = await this.bookingsRepo.findHoldById(booking.holdId);
    if (!hold || hold.status !== INVENTORY_HOLD_STATUSES.ACTIVE) {
      throw new BadRequestError(
        'The temporary room inventory hold is no longer active',
        'HOLD_NOT_ACTIVE',
      );
    }

    const now = new Date();
    if (hold.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestError(
        'The temporary room inventory hold has expired',
        'HOLD_EXPIRED',
      );
    }

    // 4. Fetch Property Details for Display
    const property = await this.propertyRepo.findPropertyById(booking.propertyId);
    const businessName = property ? property.name : 'Kerala Tourism Hospitality';

    // 5. Authoritative Amount from Price Snapshot (Zero Client Trust)
    const amountPaise = booking.priceSnapshot.totalPaise;
    const currency = booking.priceSnapshot.currency || 'INR';

    // 6. Check for Existing Active/Pending Payment Record for this Booking
    const existingPayment = await this.repo.findPaymentByBookingId(booking._id);
    let payment: IPaymentLean;

    if (
      existingPayment &&
      (existingPayment.status === PAYMENT_STATUSES.CREATED || existingPayment.status === PAYMENT_STATUSES.PENDING) &&
      existingPayment.providerOrderId
    ) {
      payment = existingPayment;
    } else {
      // 7. Create Internal Payment Record
      const paymentReference = generatePaymentReference();
      payment = await this.repo.createPayment({
        paymentReference,
        bookingId: booking._id,
        holdId: hold._id,
        touristAccountId: new Types.ObjectId(touristAccountId),
        businessProfileId: booking.businessProfileId,
        provider: PAYMENT_PROVIDERS.RAZORPAY,
        amountPaise,
        currency,
        status: PAYMENT_STATUSES.CREATED,
      });

      // 8. Call Provider Adapter to Create Sandbox Order
      const orderResult = await this.provider.createOrder({
        amountPaise,
        currency,
        receipt: paymentReference,
        notes: {
          bookingId: booking._id.toString(),
          touristAccountId,
          bookingReference: booking.bookingReference,
        },
      });

      // 9. Persist Provider Order Reference
      const updated = await this.repo.updatePayment(payment._id, {
        providerOrderId: orderResult.orderId,
        status: PAYMENT_STATUSES.PENDING,
      });
      if (updated) {
        payment = updated;
      }
    }

    // 10. Record Audit Action
    await this.auditService.recordAdminAction({
      actorAccountId: touristAccountId,
      actorAccountType: 'TOURIST',
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_INITIATED,
      targetEntityId: payment._id,
      targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
      reason: `Payment initiated for booking ${booking.bookingReference}`,
      beforeState: {},
      afterState: {
        paymentReference: payment.paymentReference,
        amountPaise: payment.amountPaise,
        providerOrderId: payment.providerOrderId,
      },
    });

    // 11. Build Safe Checkout DTO
    const responseDto: CreatePaymentResponseDto = {
      payment: this.mapPaymentToDto(payment),
      checkoutData: {
        keyId: env.RAZORPAY_KEY_ID || 'rzp_test_placeholder_key_id',
        orderId: payment.providerOrderId || 'order_simulated',
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        businessName,
        description: `Booking Reservation #${booking.bookingReference}`,
        prefill: {
          name: booking.guestDetails.primaryGuestName,
          email: booking.guestDetails.email,
          contact: booking.guestDetails.phone,
        },
        notes: {
          bookingId: booking._id.toString(),
          paymentReference: payment.paymentReference,
        },
      },
    };

    // 12. Save Idempotency Record if Key Provided
    if (idempotencyKey) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const requestHash = crypto
        .createHash('sha256')
        .update(`${bookingId}:${amountPaise}`)
        .digest('hex');

      await this.bookingsRepo.saveIdempotencyRecord({
        touristAccountId: new Types.ObjectId(touristAccountId),
        key: idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: responseDto,
        bookingId: booking._id,
        holdId: hold._id,
        expiresAt,
      });
    }

    return responseDto;
  }

  // ---------------------------------------------------------------------------
  // PAYMENT VERIFICATION & ATOMIC BOOKING CONFIRMATION
  // ---------------------------------------------------------------------------

  public async verifyPayment(
    touristAccountId: string,
    input: {
      paymentId: string;
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    },
  ): Promise<VerifyPaymentResponseDto> {
    // 1. Fetch Payment & Verify Ownership
    const payment = await this.repo.findPaymentById(input.paymentId);
    if (!payment || payment.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Payment not found', 'RESOURCE_NOT_FOUND');
    }

    // 2. Validate Provider Order ID Matches
    if (payment.providerOrderId && payment.providerOrderId !== input.razorpay_order_id) {
      throw new BadRequestError('Provider order ID mismatch', 'ORDER_ID_MISMATCH');
    }

    // 3. Verify Provider Signature via Provider Adapter
    const isSignatureValid = this.provider.verifyPaymentSignature({
      orderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
    });

    if (!isSignatureValid) {
      // Record failure on payment document
      await this.repo.updatePayment(payment._id, {
        status: PAYMENT_STATUSES.FAILED,
        failureCode: 'INVALID_SIGNATURE',
        failureDescription: 'Cryptographic signature verification failed',
      });

      await this.auditService.recordAdminAction({
        actorAccountId: touristAccountId,
        actorAccountType: 'TOURIST',
        action: ADMIN_AUDIT_ACTIONS.PAYMENT_FAILED,
        targetEntityId: payment._id,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
        reason: 'Payment signature verification failed',
        beforeState: { status: payment.status },
        afterState: { status: PAYMENT_STATUSES.FAILED, failureCode: 'INVALID_SIGNATURE' },
      });

      throw new BadRequestError('Invalid payment signature', 'INVALID_PAYMENT_SIGNATURE');
    }

    // 4. Fetch Authoritative Payment Details from Provider Gateway & Verify Capture Status
    const gatewayPayment = await this.provider.fetchPayment(
      input.razorpay_payment_id,
      payment.providerOrderId || input.razorpay_order_id,
    );

    // Verify gateway payment status is CAPTURED
    if (gatewayPayment.status !== 'captured') {
      const isFailed = gatewayPayment.status === 'failed';
      await this.repo.updatePayment(payment._id, {
        status: isFailed ? PAYMENT_STATUSES.FAILED : PAYMENT_STATUSES.PENDING,
        failureCode: gatewayPayment.errorCode || 'PAYMENT_NOT_CAPTURED',
        failureDescription:
          gatewayPayment.errorDescription || `Payment is in ${gatewayPayment.status} status at gateway`,
      });

      await this.auditService.recordAdminAction({
        actorAccountId: touristAccountId,
        actorAccountType: 'TOURIST',
        action: ADMIN_AUDIT_ACTIONS.PAYMENT_FAILED,
        targetEntityId: payment._id,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
        reason: `Payment verification rejected: gateway status is ${gatewayPayment.status}`,
        beforeState: { status: payment.status },
        afterState: { status: isFailed ? PAYMENT_STATUSES.FAILED : PAYMENT_STATUSES.PENDING },
      });

      throw new BadRequestError(
        `Payment was not captured by gateway (current status: ${gatewayPayment.status})`,
        'PAYMENT_NOT_CAPTURED',
      );
    }

    // Verify order ID match between gateway and internal payment
    if (
      gatewayPayment.providerOrderId &&
      payment.providerOrderId &&
      gatewayPayment.providerOrderId !== payment.providerOrderId
    ) {
      throw new BadRequestError('Payment provider order ID mismatch', 'ORDER_ID_MISMATCH');
    }

    // Verify captured amount matches expected order price snapshot
    if (gatewayPayment.amountPaise !== payment.amountPaise) {
      throw new BadRequestError(
        `Payment amount mismatch: expected ${payment.amountPaise} paise, but gateway reported ${gatewayPayment.amountPaise} paise`,
        'PAYMENT_AMOUNT_MISMATCH',
      );
    }

    // Verify currency match
    if (
      gatewayPayment.currency &&
      payment.currency &&
      gatewayPayment.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new BadRequestError(
        `Payment currency mismatch: expected ${payment.currency}, but gateway reported ${gatewayPayment.currency}`,
        'PAYMENT_CURRENCY_MISMATCH',
      );
    }

    // 5. Execute Atomic Confirmation & Hold Consumption in MongoDB Transaction
    const result = await this.repo.withTransaction(async (session) => {
      return await this.repo.confirmBookingAndConsumeHold(
        {
          paymentId: payment._id,
          providerPaymentId: input.razorpay_payment_id,
          paidAt: new Date(),
        },
        session,
      );
    });

    // 5. Audit Logging
    await this.auditService.recordAdminAction({
      actorAccountId: touristAccountId,
      actorAccountType: 'TOURIST',
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_CAPTURED,
      targetEntityId: payment._id,
      targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
      reason: 'Payment verified and captured via checkout callback',
      beforeState: { status: payment.status },
      afterState: {
        status: result.payment.status,
        providerPaymentId: input.razorpay_payment_id,
      },
    });

    if (result.isLatePayment) {
      await this.auditService.recordAdminAction({
        actorAccountId: touristAccountId,
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

      await this.notifService.publishEvent({
        recipientAccountId: touristAccountId,
        notificationType: NOTIFICATION_TYPES.PAYMENT_RECONCILIATION_REQUIRED,
        title: 'Payment Flagged for Review',
        body: `Payment ${result.payment.paymentReference} was received but the room hold expired. Our team is reviewing this for accommodation allocation or refund.`,
        dataPayload: { route: 'booking_details', bookingId: result.booking._id.toString() },
        relatedResourceType: 'PAYMENT',
        relatedResourceId: result.payment._id.toString(),
        idempotencyKey: `evt_payment_reconciliation_${result.payment._id.toString()}`,
      }).catch((err) => console.error('[Notification Publish Error]:', err));
    } else {
      await this.auditService.recordAdminAction({
        actorAccountId: touristAccountId,
        actorAccountType: 'TOURIST',
        action: ADMIN_AUDIT_ACTIONS.BOOKING_CONFIRMED,
        targetEntityId: result.booking._id,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.BOOKING,
        reason: 'Booking confirmed upon verified payment capture',
        beforeState: { status: BOOKING_STATUSES.AWAITING_PAYMENT },
        afterState: { status: BOOKING_STATUSES.CONFIRMED, paymentId: payment._id },
      });

      await this.notifService.publishEvent({
        recipientAccountId: touristAccountId,
        notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
        title: 'Booking Confirmed!',
        body: `Your booking ${result.booking.bookingReference} has been confirmed. Enjoy your stay in God's Own Country!`,
        dataPayload: { route: 'booking_details', bookingId: result.booking._id.toString() },
        relatedResourceType: 'BOOKING',
        relatedResourceId: result.booking._id.toString(),
        idempotencyKey: `evt_booking_confirmed_${result.booking._id.toString()}`,
      }).catch((err) => console.error('[Notification Publish Error]:', err));

      await this.notifService.publishEvent({
        recipientAccountId: touristAccountId,
        notificationType: NOTIFICATION_TYPES.PAYMENT_CAPTURED,
        title: 'Payment Successful',
        body: `Payment of ₹${(result.payment.amountPaise / 100).toFixed(2)} (${result.payment.paymentReference}) was successfully captured.`,
        dataPayload: {
          route: 'booking_details',
          bookingId: result.booking._id.toString(),
          paymentId: result.payment._id.toString(),
        },
        relatedResourceType: 'PAYMENT',
        relatedResourceId: result.payment._id.toString(),
        idempotencyKey: `evt_payment_captured_${result.payment._id.toString()}`,
      }).catch((err) => console.error('[Notification Publish Error]:', err));
    }

    return {
      payment: this.mapPaymentToDto(result.payment),
      booking: {
        id: result.booking._id.toString(),
        bookingReference: result.booking.bookingReference,
        touristAccountId: result.booking.touristAccountId.toString(),
        propertyId: result.booking.propertyId.toString(),
        roomTypeId: result.booking.roomTypeId.toString(),
        businessProfileId: result.booking.businessProfileId.toString(),
        checkInDate: result.booking.checkInDate,
        checkOutDate: result.booking.checkOutDate,
        numberOfRooms: result.booking.numberOfRooms,
        adults: result.booking.adults,
        children: result.booking.children,
        nights: result.booking.nights,
        status: result.booking.status,
        holdId: result.booking.holdId ? result.booking.holdId.toString() : null,
        paidAt: result.booking.paidAt
          ? result.booking.paidAt instanceof Date
            ? result.booking.paidAt.toISOString()
            : new Date(result.booking.paidAt).toISOString()
          : null,
        confirmedAt: result.booking.confirmedAt
          ? result.booking.confirmedAt instanceof Date
            ? result.booking.confirmedAt.toISOString()
            : new Date(result.booking.confirmedAt).toISOString()
          : null,
        paymentId: result.booking.paymentId ? result.booking.paymentId.toString() : null,
        paymentReference: result.booking.paymentReference || null,
        priceSnapshot: result.booking.priceSnapshot,
        guestDetails: result.booking.guestDetails,
        createdAt:
          result.booking.createdAt instanceof Date
            ? result.booking.createdAt.toISOString()
            : new Date(result.booking.createdAt).toISOString(),
        updatedAt:
          result.booking.updatedAt instanceof Date
            ? result.booking.updatedAt.toISOString()
            : new Date(result.booking.updatedAt).toISOString(),
      },
      isConfirmed: !result.isLatePayment,
      message: result.isLatePayment
        ? 'Payment captured but inventory hold expired; reservation flagged for manual reconciliation'
        : 'Payment verified successfully and booking confirmed',
    };
  }

  // ---------------------------------------------------------------------------
  // READ APIS
  // ---------------------------------------------------------------------------

  public async getPaymentById(
    touristAccountId: string,
    paymentId: string,
  ): Promise<PaymentDto> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment || payment.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Payment not found', 'RESOURCE_NOT_FOUND');
    }
    return this.mapPaymentToDto(payment);
  }

  public async getPaymentByBookingId(
    touristAccountId: string,
    bookingId: string,
  ): Promise<PaymentDto> {
    const booking = await this.bookingsRepo.findBookingById(bookingId);
    if (!booking || booking.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Booking not found', 'RESOURCE_NOT_FOUND');
    }

    const payment = await this.repo.findPaymentByBookingId(bookingId);
    if (!payment || payment.touristAccountId.toString() !== touristAccountId) {
      throw new NotFoundError('Payment not found for booking', 'PAYMENT_NOT_FOUND');
    }

    return this.mapPaymentToDto(payment);
  }

  // Backward compatibility
  public async getStatus(): Promise<{ status: string; module: string }> {
    return {
      status: 'ready',
      module: 'payments',
    };
  }

  // ---------------------------------------------------------------------------
  // ADMINISTRATIVE REFUND & DISPUTE APIS (T01.3)
  // ---------------------------------------------------------------------------

  public async refundPayment(
    adminAccountId: string,
    paymentId: string,
    input: RefundPaymentInput = {},
  ): Promise<RefundPaymentResponseDto> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      throw new NotFoundError('Payment record not found', 'PAYMENT_NOT_FOUND');
    }

    const currentCumulative = payment.cumulativeRefundedPaise || 0;
    const currentPending = payment.pendingRefundPaise || 0;

    // 1. Guard: Cannot refund an already fully refunded payment
    if (
      payment.status === PAYMENT_STATUSES.REFUNDED ||
      currentCumulative >= payment.amountPaise
    ) {
      throw new BadRequestError('Payment has already been fully refunded', 'PAYMENT_ALREADY_REFUNDED');
    }

    // 2. Guard: Check payment eligibility
    if (
      payment.status !== PAYMENT_STATUSES.CAPTURED &&
      payment.status !== PAYMENT_STATUSES.REFUND_PENDING
    ) {
      throw new BadRequestError(
        `Cannot refund payment with status '${payment.status}'. Only captured payments can be refunded.`,
        'PAYMENT_NOT_CAPTURED',
      );
    }

    // 3. Guard: Gateway payment ID must be present
    if (!payment.providerPaymentId) {
      throw new BadRequestError(
        'Payment does not have an associated gateway provider payment ID',
        'MISSING_PROVIDER_PAYMENT_ID',
      );
    }

    // 4. Enforce Idempotency: Return existing refund if idempotencyKey was already processed
    if (input.idempotencyKey) {
      const existingRefund = await this.refundsRepo.findRefundByPaymentAndIdempotencyKey(
        payment._id,
        input.idempotencyKey,
      );
      if (existingRefund) {
        const latestPayment = await this.repo.findPaymentById(payment._id);
        const remaining = Math.max(
          0,
          payment.amountPaise -
            ((latestPayment?.cumulativeRefundedPaise || 0) + (latestPayment?.pendingRefundPaise || 0)),
        );
        return {
          refund: this.mapRefundToDto(existingRefund),
          payment: this.mapPaymentToDto(latestPayment || payment),
          remainingRefundablePaise: remaining,
          refundId: existingRefund.providerRefundId || existingRefund.refundReference,
          amountPaise: existingRefund.amountPaise,
          message: `Refund ${existingRefund.refundReference} retrieved via idempotent replay`,
        };
      }
    }

    // 5. Calculate remaining refundable balance and validate requested amount
    const remainingBalance = Math.max(0, payment.amountPaise - (currentCumulative + currentPending));
    const requestedAmountPaise =
      input.amountPaise !== undefined ? input.amountPaise : remainingBalance;

    if (requestedAmountPaise <= 0 || requestedAmountPaise > remainingBalance) {
      throw new BadRequestError(
        `Refund amount (${requestedAmountPaise} paise) must be positive and cannot exceed remaining refundable balance (${remainingBalance} paise)`,
        'INVALID_REFUND_AMOUNT',
      );
    }

    // 6. Database-level atomic balance reservation
    const reservedPayment = await this.repo.reserveRefundBalance(
      payment._id,
      requestedAmountPaise,
    );
    if (!reservedPayment) {
      throw new ConflictError(
        'Concurrent refund attempt exceeded remaining refundable balance',
        'REFUND_BALANCE_EXCEEDED',
      );
    }

    // 7. Create persistent Refund record in PROCESSING state
    const refundRef = `RFND-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const refundRecord = await this.refundsRepo.createRefund({
      refundReference: refundRef,
      paymentId: payment._id,
      bookingId: payment.bookingId,
      touristAccountId: payment.touristAccountId,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      amountPaise: requestedAmountPaise,
      currency: payment.currency,
      status: REFUND_STATUSES.PROCESSING,
      reason: input.reason || 'Administrative refund processed',
      adminAccountId: new Types.ObjectId(adminAccountId),
      idempotencyKey: input.idempotencyKey || null,
      providerReference: `rcpt_${refundRef}`,
    });

    // 8. Invoke Payment Provider Gateway Refund API
    let refundResult: any;
    try {
      refundResult = await this.provider.createRefund({
        providerPaymentId: payment.providerPaymentId,
        amountPaise: requestedAmountPaise,
        currency: payment.currency,
        notes: {
          paymentReference: payment.paymentReference,
          refundReference: refundRef,
          adminAccountId,
          reason: input.reason || 'Administrative refund processed',
        },
        receipt: `rcpt_${refundRef}`,
      });
    } catch (err: any) {
      const isTimeout =
        err.code === 'PAYMENT_GATEWAY_TIMEOUT' ||
        err.name === 'TimeoutError' ||
        (err.message && err.message.toLowerCase().includes('timed out'));

      if (isTimeout) {
        // Safe timeout handling: Preserve indeterminate pending state, DO NOT release reserved balance!
        await this.refundsRepo.updateRefund(refundRecord._id, {
          status: REFUND_STATUSES.PENDING,
          failureCode: err.code || 'PAYMENT_GATEWAY_TIMEOUT',
          failureDescription: 'Gateway communication timed out. Preserving pending status for reconciliation.',
        });
        await this.repo.updatePayment(payment._id, {
          status: PAYMENT_STATUSES.REFUND_PENDING,
        });

        await this.auditService.recordAdminAction({
          actorAccountId: adminAccountId,
          actorAccountType: 'ADMIN',
          action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
          targetEntityId: payment._id,
          targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
          reason: `Refund timed out at gateway: ${err.message}. Preserved in REFUND_PENDING status.`,
          beforeState: { status: payment.status },
          afterState: { status: PAYMENT_STATUSES.REFUND_PENDING, failureCode: 'PAYMENT_GATEWAY_TIMEOUT' },
        });

        throw err;
      }

      // On definitive non-timeout provider failure: Mark refund FAILED and release reserved balance
      await this.refundsRepo.updateRefund(refundRecord._id, {
        status: REFUND_STATUSES.FAILED,
        failureCode: err.code || 'GATEWAY_ERROR',
        failureDescription: err.message || 'Refund failed at gateway',
      });
      await this.repo.releaseRefundBalance(payment._id, requestedAmountPaise);

      await this.auditService.recordAdminAction({
        actorAccountId: adminAccountId,
        actorAccountType: 'ADMIN',
        action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
        targetEntityId: payment._id,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
        reason: `Refund attempt failed: ${err.message}`,
        beforeState: { status: payment.status },
        afterState: { status: 'FAILED', failureCode: err.code || 'GATEWAY_ERROR' },
      });

      throw err;
    }

    // 9. Process Gateway Response
    if (refundResult.status === 'processed') {
      const updatedRefund = await this.refundsRepo.updateRefund(refundRecord._id, {
        status: REFUND_STATUSES.PROCESSED,
        providerRefundId: refundResult.refundId,
        processedAt: new Date(),
      });

      const settledPayment = await this.repo.settleRefundBalance(
        payment._id,
        requestedAmountPaise,
        refundResult.refundId,
        input.reason,
      );

      const isFullyRefunded = (settledPayment?.cumulativeRefundedPaise || 0) >= payment.amountPaise;

      // 10. Booking & Inventory Safety
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

          // Check if inventory was consumed and release if needed
          const hold = await this.bookingsRepo.findHoldById(payment.holdId);
          if (hold && hold.status === INVENTORY_HOLD_STATUSES.CONSUMED) {
            await this.bookingsRepo.releaseHold(payment.holdId);
          }
        }
      }

      // 11. Immutable Audit Logging
      await this.auditService.recordAdminAction({
        actorAccountId: adminAccountId,
        actorAccountType: 'ADMIN',
        action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
        targetEntityId: payment._id,
        targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
        reason: input.reason || 'Administrative refund processed',
        beforeState: {
          status: payment.status,
          cumulativeRefundedPaise: currentCumulative,
        },
        afterState: {
          status: settledPayment?.status || PAYMENT_STATUSES.REFUNDED,
          refundId: refundResult.refundId,
          refundAmountPaise: requestedAmountPaise,
          cumulativeRefundedPaise: settledPayment?.cumulativeRefundedPaise,
        },
      });

      // 12. Guest Notification Dispatch
      await this.notifService
        .publishEvent({
          recipientAccountId: payment.touristAccountId.toString(),
          notificationType: NOTIFICATION_TYPES.PAYMENT_REFUNDED,
          title: 'Refund Processed',
          body: `A refund of ₹${(requestedAmountPaise / 100).toFixed(2)} for payment ${payment.paymentReference} has been processed to your original payment method.`,
          dataPayload: {
            route: 'booking_details',
            bookingId: payment.bookingId.toString(),
            paymentId: payment._id.toString(),
            refundId: refundResult.refundId,
          },
          relatedResourceType: 'PAYMENT',
          relatedResourceId: payment._id.toString(),
          idempotencyKey: `evt_refund_${refundRecord._id.toString()}`,
        })
        .catch((err) => console.error('[Notification Publish Error]:', err));

      const finalRemaining = Math.max(
        0,
        payment.amountPaise - (settledPayment?.cumulativeRefundedPaise || 0),
      );

      return {
        refund: this.mapRefundToDto(updatedRefund || refundRecord),
        payment: this.mapPaymentToDto(settledPayment || payment),
        remainingRefundablePaise: finalRemaining,
        refundId: refundResult.refundId,
        amountPaise: requestedAmountPaise,
        message: `Refund of ₹${(requestedAmountPaise / 100).toFixed(2)} processed successfully`,
      };
    }

    // Pending provider status handling
    const updatedRefund = await this.refundsRepo.updateRefund(refundRecord._id, {
      status: REFUND_STATUSES.PENDING,
      providerRefundId: refundResult.refundId,
    });

    const updatedPayment = await this.repo.updatePayment(payment._id, {
      status: PAYMENT_STATUSES.REFUND_PENDING,
    });

    await this.auditService.recordAdminAction({
      actorAccountId: adminAccountId,
      actorAccountType: 'ADMIN',
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUNDED,
      targetEntityId: payment._id,
      targetEntityType: AUDIT_TARGET_ENTITY_TYPES.PAYMENT,
      reason: 'Refund initiated and currently pending provider settlement',
      beforeState: { status: payment.status },
      afterState: {
        status: PAYMENT_STATUSES.REFUND_PENDING,
        refundId: refundResult.refundId,
      },
    });

    return {
      refund: this.mapRefundToDto(updatedRefund || refundRecord),
      payment: this.mapPaymentToDto(updatedPayment || payment),
      remainingRefundablePaise: Math.max(
        0,
        payment.amountPaise - (currentCumulative + requestedAmountPaise),
      ),
      refundId: refundResult.refundId,
      amountPaise: requestedAmountPaise,
      message: 'Refund initiated and currently pending gateway confirmation',
    };
  }

  public async getAdminPaymentById(paymentId: string): Promise<PaymentDto> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      throw new NotFoundError('Payment record not found', 'PAYMENT_NOT_FOUND');
    }
    return this.mapPaymentToDto(payment);
  }

  public async listPayments(
    filter: PaymentQueryFilterInput,
  ): Promise<{ payments: PaymentDto[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const result = await this.repo.listPayments({
      status: filter.status as any,
      reconciliationStatus: filter.reconciliationStatus,
      page,
      limit,
    });

    return {
      payments: result.items.map((p) => this.mapPaymentToDto(p)),
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit) || 1,
    };
  }

  public async listRefundsForPayment(
    paymentId: string,
  ): Promise<{ refunds: RefundDto[]; total: number }> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      throw new NotFoundError('Payment record not found', 'PAYMENT_NOT_FOUND');
    }

    const refunds = await this.refundsRepo.listRefundsByPaymentId(paymentId);
    return {
      refunds: refunds.map((r) => this.mapRefundToDto(r)),
      total: refunds.length,
    };
  }

  public async getRefundById(refundId: string): Promise<RefundDto> {
    const refund = await this.refundsRepo.findRefundById(refundId);
    if (!refund) {
      throw new NotFoundError('Refund record not found', 'REFUND_NOT_FOUND');
    }
    return this.mapRefundToDto(refund);
  }
}

export const paymentsService = new PaymentsService();
