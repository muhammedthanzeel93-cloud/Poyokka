import mongoose, { Types, ClientSession } from 'mongoose';
import { RefundModel } from './refund.model';
import { IRefundLean } from './payments.types';
import { PaymentProvider, RefundStatus } from '@kerala-tourism/shared-types';
import { REFUND_STATUSES } from '@kerala-tourism/constants';

export interface CreateRefundRecordData {
  refundReference: string;
  paymentId: Types.ObjectId;
  bookingId: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  provider: PaymentProvider;
  providerPaymentId: string;
  providerRefundId?: string | null;
  amountPaise: number;
  currency: string;
  status: RefundStatus;
  reason?: string | null;
  adminAccountId: Types.ObjectId;
  idempotencyKey?: string | null;
  providerReference?: string | null;
}

export class RefundsRepository {
  public readonly inMemoryRefunds: Map<string, IRefundLean> = new Map();

  public async createRefund(
    data: CreateRefundRecordData,
    session?: ClientSession,
  ): Promise<IRefundLean> {
    const id = new Types.ObjectId();
    const now = new Date();

    if (mongoose.connection.readyState === 0) {
      // Enforce unique idempotencyKey per payment if specified
      if (data.idempotencyKey) {
        const existing = Array.from(this.inMemoryRefunds.values()).find(
          (r) =>
            r.paymentId.toString() === data.paymentId.toString() &&
            r.idempotencyKey === data.idempotencyKey,
        );
        if (existing) {
          const err = new Error('E11000 duplicate key error: idempotencyKey');
          (err as any).code = 11000;
          throw err;
        }
      }

      const leanRecord: IRefundLean = {
        _id: id,
        refundReference: data.refundReference,
        paymentId: data.paymentId,
        bookingId: data.bookingId,
        touristAccountId: data.touristAccountId,
        provider: data.provider,
        providerPaymentId: data.providerPaymentId,
        providerRefundId: data.providerRefundId || null,
        amountPaise: data.amountPaise,
        currency: data.currency,
        status: data.status,
        reason: data.reason || null,
        adminAccountId: data.adminAccountId,
        idempotencyKey: data.idempotencyKey || null,
        providerReference: data.providerReference || null,
        failureCode: null,
        failureDescription: null,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      this.inMemoryRefunds.set(id.toString(), leanRecord);
      return leanRecord;
    }

    const doc = new RefundModel({
      _id: id,
      ...data,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await doc.save({ session });
    return saved.toObject() as IRefundLean;
  }

  public async findRefundById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IRefundLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryRefunds.get(idStr) || null;
    }

    return RefundModel.findById(id).session(session || null).lean<IRefundLean>().exec();
  }

  public async findRefundByReference(
    reference: string,
    session?: ClientSession,
  ): Promise<IRefundLean | null> {
    const refUpper = reference.toUpperCase();
    if (mongoose.connection.readyState === 0) {
      const found = Array.from(this.inMemoryRefunds.values()).find(
        (r) => r.refundReference.toUpperCase() === refUpper,
      );
      return found || null;
    }

    return RefundModel.findOne({ refundReference: refUpper })
      .session(session || null)
      .lean<IRefundLean>()
      .exec();
  }

  public async findRefundByPaymentAndIdempotencyKey(
    paymentId: string | Types.ObjectId,
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<IRefundLean | null> {
    const pIdStr = paymentId.toString();
    if (mongoose.connection.readyState === 0) {
      const found = Array.from(this.inMemoryRefunds.values()).find(
        (r) =>
          r.paymentId.toString() === pIdStr &&
          r.idempotencyKey === idempotencyKey,
      );
      return found || null;
    }

    return RefundModel.findOne({
      paymentId: new Types.ObjectId(pIdStr),
      idempotencyKey,
    })
      .session(session || null)
      .lean<IRefundLean>()
      .exec();
  }

  public async findRefundByProviderRefundId(
    providerRefundId: string,
    session?: ClientSession,
  ): Promise<IRefundLean | null> {
    if (mongoose.connection.readyState === 0) {
      const found = Array.from(this.inMemoryRefunds.values()).find(
        (r) => r.providerRefundId === providerRefundId,
      );
      return found || null;
    }

    return RefundModel.findOne({ providerRefundId })
      .session(session || null)
      .lean<IRefundLean>()
      .exec();
  }

  public async listRefundsByPaymentId(
    paymentId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IRefundLean[]> {
    const pIdStr = paymentId.toString();
    if (mongoose.connection.readyState === 0) {
      const all = Array.from(this.inMemoryRefunds.values())
        .filter((r) => r.paymentId.toString() === pIdStr)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return all;
    }

    return RefundModel.find({ paymentId: new Types.ObjectId(pIdStr) })
      .session(session || null)
      .sort({ createdAt: -1 })
      .lean<IRefundLean[]>()
      .exec();
  }

  public async updateRefund(
    id: string | Types.ObjectId,
    update: Partial<IRefundLean>,
    session?: ClientSession,
  ): Promise<IRefundLean | null> {
    const idStr = id.toString();
    const now = new Date();

    if (mongoose.connection.readyState === 0) {
      const r = this.inMemoryRefunds.get(idStr);
      if (!r) return null;
      const updated: IRefundLean = {
        ...r,
        ...update,
        updatedAt: now,
      };
      this.inMemoryRefunds.set(idStr, updated);
      return updated;
    }

    return RefundModel.findByIdAndUpdate(
      id,
      { $set: { ...update, updatedAt: now } },
      { new: true, session },
    )
      .lean<IRefundLean>()
      .exec();
  }

  public async transitionRefundStatus(
    id: string | Types.ObjectId,
    allowedStatuses: RefundStatus[],
    targetStatus: RefundStatus,
    updateData: Partial<IRefundLean> = {},
    session?: ClientSession,
  ): Promise<IRefundLean | null> {
    const idStr = id.toString();
    const now = new Date();

    if (mongoose.connection.readyState === 0) {
      const r = this.inMemoryRefunds.get(idStr);
      if (!r) return null;
      if (!allowedStatuses.includes(r.status)) return null;
      const updated: IRefundLean = {
        ...r,
        ...updateData,
        status: targetStatus,
        updatedAt: now,
      };
      this.inMemoryRefunds.set(idStr, updated);
      return updated;
    }

    return RefundModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(idStr),
        status: { $in: allowedStatuses },
      },
      {
        $set: {
          ...updateData,
          status: targetStatus,
          updatedAt: now,
        },
      },
      { new: true, session },
    )
      .lean<IRefundLean>()
      .exec();
  }

  public async calculatePaymentRefundTotals(
    paymentId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ cumulativeRefundedPaise: number; pendingRefundPaise: number }> {
    const pIdStr = paymentId.toString();
    let cumulative = 0;
    let pending = 0;

    if (mongoose.connection.readyState === 0) {
      for (const r of this.inMemoryRefunds.values()) {
        if (r.paymentId.toString() !== pIdStr) continue;
        if (r.status === REFUND_STATUSES.PROCESSED) {
          cumulative += r.amountPaise;
        } else if (
          r.status === REFUND_STATUSES.PENDING ||
          r.status === REFUND_STATUSES.PROCESSING
        ) {
          pending += r.amountPaise;
        }
      }
      return { cumulativeRefundedPaise: cumulative, pendingRefundPaise: pending };
    }

    const refunds = await RefundModel.find({
      paymentId: new Types.ObjectId(pIdStr),
      status: {
        $in: [
          REFUND_STATUSES.PROCESSED,
          REFUND_STATUSES.PENDING,
          REFUND_STATUSES.PROCESSING,
        ],
      },
    })
      .session(session || null)
      .lean<IRefundLean[]>()
      .exec();

    for (const r of refunds) {
      if (r.status === REFUND_STATUSES.PROCESSED) {
        cumulative += r.amountPaise;
      } else {
        pending += r.amountPaise;
      }
    }

    return { cumulativeRefundedPaise: cumulative, pendingRefundPaise: pending };
  }

  public clearInMemoryStore(): void {
    this.inMemoryRefunds.clear();
  }
}

export const refundsRepository = new RefundsRepository();
