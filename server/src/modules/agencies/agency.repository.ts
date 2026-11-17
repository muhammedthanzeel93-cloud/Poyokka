import mongoose, { ClientSession, FilterQuery, Types } from 'mongoose';
import {
  VerificationStatus,
  AgencyDocumentType,
} from '@kerala-tourism/shared-types';
import { env } from '../../config/env';
import { InternalServerError } from '../../shared/errors/AppError';
import { AgencyModel, IAgencyDocument } from './agency.model';
import {
  AgencyLean,
  CreateAgencyPersistenceInput,
  UpdateAgencyPersistenceInput,
  PaginatedAgenciesResult,
} from './agency.types';
import { BusinessProfileModel } from '../../shared/models';
import { AdminAgenciesQueryInput } from './agency.validation';

const MAX_TX_RETRIES = 8;

const isTransientTransactionError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const maybeErr = err as {
    code?: number;
    errorLabels?: string[];
    hasErrorLabel?: (label: string) => boolean;
  };
  return (
    maybeErr.code === 112 ||
    maybeErr.errorLabels?.includes('TransientTransactionError') === true ||
    (typeof maybeErr.hasErrorLabel === 'function' &&
      maybeErr.hasErrorLabel('TransientTransactionError'))
  );
};

const isUnsupportedTransactionError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : '';
  return (
    message.includes('replica set member') ||
    message.includes('Transaction numbers are only allowed')
  );
};

export class AgencyRepository {
  /**
   * Executes multi-document writes inside a MongoDB ACID transaction with jittered retries.
   * Fails closed in production if replica-set transactions are unsupported.
   */
  public async withTransaction<T>(
    fn: (session?: ClientSession) => Promise<T>,
  ): Promise<T> {
    const requireTransactions =
      env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt += 1) {
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
              'Agency operations require a MongoDB replica set transaction topology',
              'TRANSACTION_REQUIRED',
            );
          }
          return await fn(undefined);
        }

        if (isTransientTransactionError(txError) && attempt < MAX_TX_RETRIES) {
          const jitterMs = 10 + Math.floor(Math.random() * 25);
          await new Promise((resolve) => setTimeout(resolve, jitterMs));
          continue;
        }

        throw txError;
      } finally {
        await session.endSession();
      }
    }

    throw new InternalServerError(
      'Agency transaction retries exhausted',
      'TRANSACTION_EXHAUSTED',
    );
  }

  public async findAgencyByAccountId(
    accountId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const query = AgencyModel.findOne({
      accountId: new Types.ObjectId(accountId.toString()),
    });
    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  public async findAgencyById(
    agencyId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const query = AgencyModel.findById(agencyId);
    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  public async findAgencyByRegistrationNumber(
    registrationNumber: string,
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const query = AgencyModel.findOne({
      registrationNumber: registrationNumber.trim(),
    });
    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  public async createAgency(
    data: CreateAgencyPersistenceInput,
    session?: ClientSession,
  ): Promise<AgencyLean> {
    const doc = new AgencyModel({
      ...data,
      accountId: new Types.ObjectId(data.accountId.toString()),
      businessProfileId: new Types.ObjectId(data.businessProfileId.toString()),
      registrationNumber: data.registrationNumber.trim(),
      contactEmail: data.contactEmail.trim().toLowerCase(),
      logoMediaId: data.logoMediaId ? new Types.ObjectId(data.logoMediaId.toString()) : null,
    });
    if (session) {
      await doc.save({ session });
    } else {
      await doc.save();
    }
    return doc.toObject() as AgencyLean;
  }

  public async updateAgency(
    agencyId: string | Types.ObjectId,
    data: UpdateAgencyPersistenceInput,
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const updateData: Record<string, unknown> = {};

    if (data.agencyName !== undefined) updateData.agencyName = data.agencyName;
    if (data.businessCategory !== undefined) updateData.businessCategory = data.businessCategory;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.contactEmail !== undefined)
      updateData.contactEmail = data.contactEmail.trim().toLowerCase();
    if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone;
    if (data.website !== undefined) updateData.website = data.website;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.district !== undefined) updateData.district = data.district;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.pinCode !== undefined) updateData.pinCode = data.pinCode;
    if (data.logoMediaId !== undefined) {
      updateData.logoMediaId = data.logoMediaId
        ? new Types.ObjectId(data.logoMediaId.toString())
        : null;
    }

    const query = AgencyModel.findByIdAndUpdate(
      agencyId,
      { $set: updateData },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  public async addAgencyDocument(
    agencyId: string | Types.ObjectId,
    document: {
      documentType: AgencyDocumentType;
      originalFileName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
    },
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const query = AgencyModel.findByIdAndUpdate(
      agencyId,
      {
        $push: {
          documents: {
            ...document,
            uploadedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  public async removeAgencyDocument(
    agencyId: string | Types.ObjectId,
    documentId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const query = AgencyModel.findByIdAndUpdate(
      agencyId,
      {
        $pull: {
          documents: { _id: new Types.ObjectId(documentId.toString()) },
        },
      },
      { new: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  public async findAgenciesPaginated(
    filters: AdminAgenciesQueryInput,
    session?: ClientSession,
  ): Promise<PaginatedAgenciesResult> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 50) : 20;
    const skip = (page - 1) * limit;

    const mongoFilter: FilterQuery<IAgencyDocument> = {};

    if (filters.verificationStatus) {
      mongoFilter.verificationStatus = filters.verificationStatus;
    }

    if (filters.district) {
      mongoFilter.district = filters.district;
    }

    if (filters.search && filters.search.trim().length > 0) {
      // ReDoS-safe escaped regex
      const sanitized = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(sanitized, 'i');
      mongoFilter.$or = [
        { agencyName: regex },
        { registrationNumber: regex },
        { contactEmail: regex },
        { contactPhone: regex },
      ];
    }

    const countQuery = AgencyModel.countDocuments(mongoFilter);
    const findQuery = AgencyModel.find(mongoFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    if (session) {
      countQuery.session(session);
      findQuery.session(session);
    }

    const [total, items] = await Promise.all([
      countQuery.exec(),
      findQuery.lean<AgencyLean[]>().exec(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Atomically transitions the agency verification status if current status is in allowedCurrentStatuses.
   */
  public async transitionAgencyVerificationStatusAtomic(
    agencyId: string | Types.ObjectId,
    allowedCurrentStatuses: VerificationStatus[],
    targetStatus: VerificationStatus,
    updates: {
      verifiedAt?: Date | null;
      reviewedAt?: Date | null;
      rejectionReason?: string | null;
      reviewedBy?: Types.ObjectId | null;
    },
    session?: ClientSession,
  ): Promise<AgencyLean | null> {
    const updateSet: Record<string, unknown> = {
      verificationStatus: targetStatus,
      reviewedBy: updates.reviewedBy ?? null,
      reviewedAt: updates.reviewedAt ?? new Date(),
    };

    if (updates.verifiedAt !== undefined) {
      updateSet.verifiedAt = updates.verifiedAt;
    }
    if (updates.rejectionReason !== undefined) {
      updateSet.rejectionReason = updates.rejectionReason;
    }

    const query = AgencyModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(agencyId.toString()),
        verificationStatus: { $in: allowedCurrentStatuses },
      },
      { $set: updateSet },
      { new: true, runValidators: true },
    );

    if (session) {
      query.session(session);
    }
    return query.lean<AgencyLean>().exec();
  }

  /**
   * Synchronizes verificationStatus on BusinessProfile atomically.
   */
  public async syncBusinessProfileVerificationStatus(
    accountId: string | Types.ObjectId,
    targetStatus: VerificationStatus,
    session?: ClientSession,
  ): Promise<void> {
    const query = BusinessProfileModel.updateOne(
      { accountId: new Types.ObjectId(accountId.toString()) },
      { $set: { verificationStatus: targetStatus } },
    );
    if (session) {
      query.session(session);
    }
    await query.exec();
  }

  /**
   * Mirrors document reference into BusinessProfile documents array.
   */
  public async syncBusinessProfileDocument(
    accountId: string | Types.ObjectId,
    document: {
      documentType: string;
      storageKey: string;
      originalFileName: string;
      fileSize: number;
      mimeType: string;
      uploadedAt: Date;
    },
    session?: ClientSession,
  ): Promise<void> {
    const query = BusinessProfileModel.updateOne(
      { accountId: new Types.ObjectId(accountId.toString()) },
      {
        $push: {
          documents: document,
        },
      },
    );
    if (session) {
      query.session(session);
    }
    await query.exec();
  }

  /**
   * Removes mirrored document reference from BusinessProfile by storageKey.
   */
  public async removeBusinessProfileDocumentByStorageKey(
    accountId: string | Types.ObjectId,
    storageKey: string,
    session?: ClientSession,
  ): Promise<void> {
    const query = BusinessProfileModel.updateOne(
      { accountId: new Types.ObjectId(accountId.toString()) },
      {
        $pull: {
          documents: { storageKey },
        },
      },
    );
    if (session) {
      query.session(session);
    }
    await query.exec();
  }

  public async findBusinessProfileByAccountId(
    accountId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const query = BusinessProfileModel.findOne({
      accountId: new Types.ObjectId(accountId.toString()),
    });
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }
}

export const agencyRepository = new AgencyRepository();
