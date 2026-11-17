import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  PAYMENT_STATUSES,
  PAYMENT_PROVIDERS,
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
} from '@kerala-tourism/constants';
import {
  BadRequestError,
  NotFoundError,
} from '../../shared/errors/AppError';
import { env } from '../../config/env';
import { IPaymentProvider } from './providers/payment-provider.interface';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { PaymentsRepository, paymentsRepository } from './payments.repository';
import { BookingsRepository, bookingsRepository } from '../bookings/bookings.repository';
import { PropertyRepository, propertyRepository } from '../properties/property.repository';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';
import { NotificationService, notificationService } from '../notifications/notification.service';
import { NOTIFICATION_TYPES } from '@kerala-tourism/constants';
import { generatePaymentReference } from './payments.validation';
import {
  IPaymentLean,
  PaymentDto,
  CreatePaymentResponseDto,
  VerifyPaymentResponseDto,
} from './payments.types';

export class PaymentsService {
  private repo: PaymentsRepository;
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
  ) {
    this.repo = repo;
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

  // ---------------------------------------------------------------------------
  // MAPPER HELPERS
  // ---------------------------------------------------------------------------

  public mapPaymentToDto(payment: IPaymentLean): PaymentDto {
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

    // 4. Execute Atomic Confirmation & Hold Consumption in MongoDB Transaction
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
}

export const paymentsService = new PaymentsService();
