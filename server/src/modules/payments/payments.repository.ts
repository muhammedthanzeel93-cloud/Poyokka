import mongoose, { ClientSession, Types, FilterQuery } from 'mongoose';
import {
  PAYMENT_STATUSES,
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
} from '@kerala-tourism/constants';
import { env } from '../../config/env';
import { InternalServerError } from '../../shared/errors/AppError';
import { PaymentModel, IPaymentDocument } from './payments.model';
import { PaymentWebhookEventModel } from './webhook-event.model';
import { BookingModel } from '../bookings/bookings.model';
import { InventoryHoldModel } from '../bookings/inventory-hold.model';
import { IBookingLean, IInventoryHoldLean } from '../bookings/bookings.types';
import {
  IPaymentLean,
  IPaymentWebhookEventLean,
  CreatePaymentRecordData,
  PaymentStatus,
  PaymentWebhookStatus,
  PaymentProvider,
} from './payments.types';

const MAX_TX_RETRIES = 3;

const isTransientTransactionError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { errorLabels?: string[]; code?: number; message?: string };
  if (Array.isArray(err.errorLabels) && err.errorLabels.includes('TransientTransactionError')) {
    return true;
  }
  if (err.code === 112 || (typeof err.message === 'string' && err.message.includes('WriteConflict'))) {
    return true;
  }
  return false;
};

const isUnsupportedTransactionError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { message?: string; code?: number };
  if (typeof err.message === 'string') {
    return (
      err.message.includes('Transactions are not supported') ||
      err.message.includes('replica set') ||
      err.message.includes('standalone')
    );
  }
  return false;
};

export class PaymentsRepository {
  public inMemoryPayments = new Map<string, IPaymentLean>();
  public inMemoryWebhookEvents = new Map<string, IPaymentWebhookEventLean>();
  public inMemoryBookingsRef?: Map<string, IBookingLean>;
  public inMemoryHoldsRef?: Map<string, IInventoryHoldLean>;

  public setBookingMemoryStores(
    bookings: Map<string, IBookingLean>,
    holds: Map<string, IInventoryHoldLean>,
  ): void {
    this.inMemoryBookingsRef = bookings;
    this.inMemoryHoldsRef = holds;
  }

  public async withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
    const requireTransactions =
      env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

    if (mongoose.connection.readyState === 0) {
      if (requireTransactions) {
        throw new InternalServerError(
          'Production payment operations require a connected MongoDB replica-set transaction topology',
          'TRANSACTION_REQUIRED',
        );
      }
      return await fn(undefined);
    }

    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } catch (txError: unknown) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }

        if (isUnsupportedTransactionError(txError)) {
          if (requireTransactions) {
            throw new InternalServerError(
              'Payment operations require a MongoDB replica set transaction topology',
              'TRANSACTION_REQUIRED',
            );
          }
          return await fn(undefined);
        }

        if (isTransientTransactionError(txError) && attempt < MAX_TX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 50));
          continue;
        }

        throw txError;
      } finally {
        await session.endSession();
      }
    }

    throw new InternalServerError(
      'Transaction failed after maximum retries',
      'TRANSACTION_FAILED',
    );
  }

  public async createPayment(
    data: CreatePaymentRecordData,
    session?: ClientSession,
  ): Promise<IPaymentLean> {
    if (mongoose.connection.readyState === 0) {
      const _id = new Types.ObjectId();
      const now = new Date();
      const lean: IPaymentLean = {
        _id,
        paymentReference: data.paymentReference,
        bookingId: data.bookingId,
        holdId: data.holdId,
        touristAccountId: data.touristAccountId,
        businessProfileId: data.businessProfileId,
        provider: data.provider,
        providerOrderId: data.providerOrderId || null,
        providerPaymentId: null,
        amountPaise: data.amountPaise,
        currency: data.currency,
        status: data.status,
        failureCode: null,
        failureDescription: null,
        reconciliationStatus: null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.inMemoryPayments.set(_id.toString(), lean);
      return lean;
    }

    const docs = await PaymentModel.create([data], { session });
    return docs[0].toObject();
  }

  public async findPaymentById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IPaymentLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryPayments.get(idStr) || null;
    }
    return PaymentModel.findById(id).session(session || null).lean<IPaymentLean>().exec();
  }

  public async findPaymentByReference(
    paymentReference: string,
    session?: ClientSession,
  ): Promise<IPaymentLean | null> {
    const refUpper = paymentReference.trim().toUpperCase();
    if (mongoose.connection.readyState === 0) {
      for (const p of this.inMemoryPayments.values()) {
        if (p.paymentReference.toUpperCase() === refUpper) {
          return p;
        }
      }
      return null;
    }
    return PaymentModel.findOne({ paymentReference: refUpper })
      .session(session || null)
      .lean<IPaymentLean>()
      .exec();
  }

  public async findPaymentByProviderOrderId(
    orderId: string,
    session?: ClientSession,
  ): Promise<IPaymentLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const p of this.inMemoryPayments.values()) {
        if (p.providerOrderId === orderId) {
          return p;
        }
      }
      return null;
    }
    return PaymentModel.findOne({ providerOrderId: orderId })
      .session(session || null)
      .lean<IPaymentLean>()
      .exec();
  }

  public async findPaymentByProviderPaymentId(
    paymentId: string,
    session?: ClientSession,
  ): Promise<IPaymentLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const p of this.inMemoryPayments.values()) {
        if (p.providerPaymentId === paymentId) {
          return p;
        }
      }
      return null;
    }
    return PaymentModel.findOne({ providerPaymentId: paymentId })
      .session(session || null)
      .lean<IPaymentLean>()
      .exec();
  }

  public async findPaymentByBookingId(
    bookingId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IPaymentLean | null> {
    const bIdStr = bookingId.toString();
    if (mongoose.connection.readyState === 0) {
      for (const p of this.inMemoryPayments.values()) {
        if (p.bookingId.toString() === bIdStr) {
          return p;
        }
      }
      return null;
    }
    return PaymentModel.findOne({ bookingId })
      .sort({ createdAt: -1 })
      .session(session || null)
      .lean<IPaymentLean>()
      .exec();
  }

  public async updatePayment(
    id: string | Types.ObjectId,
    update: Partial<IPaymentLean>,
    session?: ClientSession,
  ): Promise<IPaymentLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      const p = this.inMemoryPayments.get(idStr);
      if (!p) return null;
      const updated: IPaymentLean = {
        ...p,
        ...update,
        updatedAt: new Date(),
      };
      this.inMemoryPayments.set(idStr, updated);
      return updated;
    }

    return PaymentModel.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, session },
    )
      .lean<IPaymentLean>()
      .exec();
  }

  public async listPayments(filter: {
    touristAccountId: string | Types.ObjectId;
    status?: PaymentStatus;
    page?: number;
    limit?: number;
  }): Promise<{ items: IPaymentLean[]; total: number }> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    if (mongoose.connection.readyState === 0) {
      const accountIdStr = filter.touristAccountId.toString();
      const all = Array.from(this.inMemoryPayments.values()).filter((p) => {
        if (p.touristAccountId.toString() !== accountIdStr) return false;
        if (filter.status && p.status !== filter.status) return false;
        return true;
      });
      all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        items: all.slice(skip, skip + limit),
        total: all.length,
      };
    }

    const query: FilterQuery<IPaymentDocument> = {
      touristAccountId: filter.touristAccountId,
    };
    if (filter.status) {
      query.status = filter.status;
    }

    const [items, total] = await Promise.all([
      PaymentModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IPaymentLean[]>()
        .exec(),
      PaymentModel.countDocuments(query).exec(),
    ]);

    return { items, total };
  }

  public async findWebhookEvent(
    provider: PaymentProvider,
    providerEventId: string,
    session?: ClientSession,
  ): Promise<IPaymentWebhookEventLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const ev of this.inMemoryWebhookEvents.values()) {
        if (ev.provider === provider && ev.providerEventId === providerEventId) {
          return ev;
        }
      }
      return null;
    }
    return PaymentWebhookEventModel.findOne({ provider, providerEventId })
      .session(session || null)
      .lean<IPaymentWebhookEventLean>()
      .exec();
  }

  public async recordWebhookEvent(
    eventData: Omit<IPaymentWebhookEventLean, '_id' | 'createdAt' | 'updatedAt'>,
    session?: ClientSession,
  ): Promise<IPaymentWebhookEventLean> {
    if (mongoose.connection.readyState === 0) {
      const _id = new Types.ObjectId();
      const now = new Date();
      const lean: IPaymentWebhookEventLean = {
        _id,
        ...eventData,
        createdAt: now,
        updatedAt: now,
      };
      this.inMemoryWebhookEvents.set(_id.toString(), lean);
      return lean;
    }

    const docs = await PaymentWebhookEventModel.create([eventData], { session });
    return docs[0].toObject();
  }

  public async updateWebhookEventStatus(
    id: string | Types.ObjectId,
    status: PaymentWebhookStatus,
    failureCode?: string | null,
    session?: ClientSession,
  ): Promise<IPaymentWebhookEventLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      const ev = this.inMemoryWebhookEvents.get(idStr);
      if (!ev) return null;
      ev.processingStatus = status;
      if (failureCode !== undefined) ev.failureCode = failureCode;
      ev.processedAt = new Date();
      ev.updatedAt = new Date();
      return ev;
    }

    return PaymentWebhookEventModel.findByIdAndUpdate(
      id,
      {
        $set: {
          processingStatus: status,
          processedAt: new Date(),
          failureCode: failureCode || null,
        },
      },
      { new: true, session },
    )
      .lean<IPaymentWebhookEventLean>()
      .exec();
  }

  /**
   * ATOMIC BOOKING CONFIRMATION & HOLD CONSUMPTION
   *
   * Executes conditionally inside a transaction:
   * 1. If Payment is already CAPTURED, return idempotent success.
   * 2. Inspect Hold:
   *    - If Hold is ACTIVE and expiresAt > now:
   *      Transition Payment to CAPTURED.
   *      Transition Hold to CONSUMED.
   *      Transition Booking to CONFIRMED.
   *    - If Hold is EXPIRED or RELEASED or expiresAt <= now (LATE PAYMENT):
   *      DO NOT confirm Booking!
   *      DO NOT consume Hold!
   *      Mark Payment as CAPTURED with reconciliationStatus = 'FLAGGED_FOR_MANUAL_REVIEW'.
   */
  public async confirmBookingAndConsumeHold(
    params: {
      paymentId: string | Types.ObjectId;
      providerPaymentId: string;
      paidAt?: Date;
    },
    session?: ClientSession,
  ): Promise<{
    payment: IPaymentLean;
    booking: IBookingLean;
    hold: IInventoryHoldLean;
    isLatePayment: boolean;
  }> {
    const now = params.paidAt || new Date();
    const paymentIdStr = params.paymentId.toString();

    // -------------------------------------------------------------------------
    // IN-MEMORY MOCK FOR NON-DB TEST RUNS
    // -------------------------------------------------------------------------
    if (mongoose.connection.readyState === 0) {
      const payment = this.inMemoryPayments.get(paymentIdStr);
      if (!payment) {
        throw new InternalServerError('Payment record not found in store', 'PAYMENT_NOT_FOUND');
      }

      const booking = this.inMemoryBookingsRef?.get(payment.bookingId.toString());
      const hold = this.inMemoryHoldsRef?.get(payment.holdId.toString());

      if (!booking || !hold) {
        throw new InternalServerError('Associated booking or hold not found', 'BOOKING_OR_HOLD_NOT_FOUND');
      }

      // Idempotent short-circuit
      if (payment.status === PAYMENT_STATUSES.CAPTURED) {
        return {
          payment,
          booking,
          hold,
          isLatePayment: payment.reconciliationStatus === 'FLAGGED_FOR_MANUAL_REVIEW',
        };
      }

      const isHoldExpired = hold.status !== INVENTORY_HOLD_STATUSES.ACTIVE || hold.expiresAt.getTime() <= now.getTime();

      if (isHoldExpired) {
        // Late payment branch
        payment.status = PAYMENT_STATUSES.CAPTURED;
        payment.providerPaymentId = params.providerPaymentId;
        payment.paidAt = now;
        payment.reconciliationStatus = 'FLAGGED_FOR_MANUAL_REVIEW';
        payment.failureCode = 'LATE_PAYMENT_HOLD_EXPIRED';
        payment.failureDescription = 'Payment captured after inventory hold expired or was released';
        payment.updatedAt = now;

        return { payment, booking, hold, isLatePayment: true };
      }

      // Valid payment branch
      hold.status = INVENTORY_HOLD_STATUSES.CONSUMED;
      hold.updatedAt = now;

      booking.status = BOOKING_STATUSES.CONFIRMED;
      booking.paidAt = now;
      booking.confirmedAt = now;
      booking.paymentId = payment._id;
      booking.paymentReference = payment.paymentReference;
      booking.updatedAt = now;

      payment.status = PAYMENT_STATUSES.CAPTURED;
      payment.providerPaymentId = params.providerPaymentId;
      payment.paidAt = now;
      payment.updatedAt = now;

      return { payment, booking, hold, isLatePayment: false };
    }

    // -------------------------------------------------------------------------
    // PRODUCTION MONGOOSE / MONGODB REPLICA SET TRANSACTION
    // -------------------------------------------------------------------------
    const payment = await PaymentModel.findById(params.paymentId).session(session || null);
    if (!payment) {
      throw new InternalServerError('Payment record not found', 'PAYMENT_NOT_FOUND');
    }

    const booking = await BookingModel.findById(payment.bookingId).session(session || null);
    const hold = await InventoryHoldModel.findById(payment.holdId).session(session || null);

    if (!booking || !hold) {
      throw new InternalServerError('Associated booking or hold not found', 'BOOKING_OR_HOLD_NOT_FOUND');
    }

    // Idempotent short-circuit
    if (payment.status === PAYMENT_STATUSES.CAPTURED) {
      return {
        payment: payment.toObject(),
        booking: booking.toObject(),
        hold: hold.toObject(),
        isLatePayment: payment.reconciliationStatus === 'FLAGGED_FOR_MANUAL_REVIEW',
      };
    }

    const isHoldExpired = hold.status !== INVENTORY_HOLD_STATUSES.ACTIVE || hold.expiresAt.getTime() <= now.getTime();

    if (isHoldExpired) {
      // Late payment: record captured payment but flag for reconciliation without confirming booking
      payment.status = PAYMENT_STATUSES.CAPTURED;
      payment.providerPaymentId = params.providerPaymentId;
      payment.paidAt = now;
      payment.reconciliationStatus = 'FLAGGED_FOR_MANUAL_REVIEW';
      payment.failureCode = 'LATE_PAYMENT_HOLD_EXPIRED';
      payment.failureDescription = 'Payment captured after inventory hold expired or was released';
      await payment.save({ session });

      return {
        payment: payment.toObject(),
        booking: booking.toObject(),
        hold: hold.toObject(),
        isLatePayment: true,
      };
    }

    // Happy Path: Hold is active and unexpired
    hold.status = INVENTORY_HOLD_STATUSES.CONSUMED;
    await hold.save({ session });

    booking.status = BOOKING_STATUSES.CONFIRMED;
    booking.paidAt = now;
    booking.confirmedAt = now;
    booking.paymentId = payment._id;
    booking.paymentReference = payment.paymentReference;
    await booking.save({ session });

    payment.status = PAYMENT_STATUSES.CAPTURED;
    payment.providerPaymentId = params.providerPaymentId;
    payment.paidAt = now;
    await payment.save({ session });

    return {
      payment: payment.toObject(),
      booking: booking.toObject(),
      hold: hold.toObject(),
      isLatePayment: false,
    };
  }
}

export const paymentsRepository = new PaymentsRepository();
