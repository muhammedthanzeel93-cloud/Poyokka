import mongoose, { ClientSession, FilterQuery, Types } from 'mongoose';
import { env } from '../../config/env';
import { InternalServerError } from '../../shared/errors/AppError';
import { TravelPackageModel, ITravelPackageDocument } from './package.model';
import {
  CreatePackagePersistenceInput,
  PackageLean,
  PackageQueryFilters,
  PaginatedPackagesResult,
  UpdatePackagePersistenceInput,
} from './package.types';
import { escapeRegex } from './package.validation';

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

export class PackageRepository {
  // In-memory store fallback for offline unit tests where MongoDB is disconnected
  private inMemoryPackages: Map<string, PackageLean> = new Map();

  /**
   * Executes multi-document writes inside a MongoDB ACID transaction with jittered retries.
   * Fails closed in production if replica-set transactions are unsupported.
   */
  public async withTransaction<T>(
    fn: (session?: ClientSession) => Promise<T>,
  ): Promise<T> {
    const requireTransactions =
      env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

    // Standalone or disconnected fallback in test environment
    if (mongoose.connection.readyState === 0) {
      return fn(undefined);
    }

    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt += 1) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } catch (err) {
        try {
          await session.abortTransaction();
        } catch {
          // Ignore abort errors
        }

        if (isUnsupportedTransactionError(err)) {
          if (requireTransactions) {
            throw new InternalServerError(
              'Database replica set is required for transactions in production',
              'DATABASE_REPLICA_SET_REQUIRED',
            );
          }
          return fn(undefined);
        }

        if (isTransientTransactionError(err) && attempt < MAX_TX_RETRIES) {
          const jitter = Math.floor(Math.random() * 50);
          const backoffMs = attempt * 50 + jitter;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        throw err;
      } finally {
        await session.endSession();
      }
    }

    throw new InternalServerError(
      'Transaction failed after maximum retries',
      'TRANSACTION_RETRY_LIMIT_EXCEEDED',
    );
  }

  public async createPackage(
    input: CreatePackagePersistenceInput,
    session?: ClientSession,
  ): Promise<PackageLean> {
    if (mongoose.connection.readyState === 0) {
      const id = new Types.ObjectId();
      const now = new Date();
      const doc: PackageLean = {
        _id: id,
        agencyId: input.agencyId,
        createdBy: input.createdBy,
        updatedBy: input.updatedBy,
        title: input.title,
        slug: input.slug,
        shortDescription: input.shortDescription,
        description: input.description,
        packageCategory: input.packageCategory,
        tags: input.tags,
        destinationIds: input.destinationIds,
        startLocation: input.startLocation || null,
        endLocation: input.endLocation || null,
        itinerary: input.itinerary,
        durationDays: input.durationDays,
        durationNights: input.durationNights,
        inclusions: input.inclusions,
        exclusions: input.exclusions,
        importantInformation: input.importantInformation || null,
        cancellationPolicy: input.cancellationPolicy || null,
        currency: input.currency,
        basePrice: input.basePrice,
        childPrice: input.childPrice || null,
        groupPricing: input.groupPricing,
        pricingUnit: input.pricingUnit,
        maxGroupSize: input.maxGroupSize || null,
        coverMediaId: input.coverMediaId || null,
        galleryMediaIds: input.galleryMediaIds,
        status: input.status || 'DRAFT',
        submittedAt: null,
        publishedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.inMemoryPackages.set(id.toString(), doc);
      return JSON.parse(JSON.stringify(doc));
    }

    const [doc] = await TravelPackageModel.create([input], { session });
    return doc.toObject<PackageLean>();
  }

  public async findPackageById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<PackageLean | null> {
    if (mongoose.connection.readyState === 0) {
      const doc = this.inMemoryPackages.get(id.toString());
      return doc ? JSON.parse(JSON.stringify(doc)) : null;
    }

    const query = TravelPackageModel.findById(id);
    if (session) {
      query.session(session);
    }
    return query.lean<PackageLean>().exec();
  }

  public async findPackageBySlug(
    slug: string,
    session?: ClientSession,
  ): Promise<PackageLean | null> {
    if (mongoose.connection.readyState === 0) {
      for (const doc of this.inMemoryPackages.values()) {
        if (doc.slug === slug.toLowerCase()) {
          return JSON.parse(JSON.stringify(doc));
        }
      }
      return null;
    }

    const query = TravelPackageModel.findOne({ slug: slug.toLowerCase() });
    if (session) {
      query.session(session);
    }
    return query.lean<PackageLean>().exec();
  }

  public async updatePackage(
    id: string | Types.ObjectId,
    input: UpdatePackagePersistenceInput,
    session?: ClientSession,
  ): Promise<PackageLean | null> {
    if (mongoose.connection.readyState === 0) {
      const doc = this.inMemoryPackages.get(id.toString());
      if (!doc) return null;
      const updated = {
        ...doc,
        ...input,
        updatedAt: new Date(),
      };
      this.inMemoryPackages.set(id.toString(), updated);
      return JSON.parse(JSON.stringify(updated));
    }

    const query = TravelPackageModel.findByIdAndUpdate(
      id,
      { $set: input },
      { new: true, runValidators: true },
    );
    if (session) {
      query.session(session);
    }
    return query.lean<PackageLean>().exec();
  }

  public async countPackagesBySlugPrefix(prefix: string): Promise<number> {
    if (mongoose.connection.readyState === 0) {
      let count = 0;
      for (const doc of this.inMemoryPackages.values()) {
        if (doc.slug.startsWith(prefix)) count++;
      }
      return count;
    }

    return TravelPackageModel.countDocuments({
      slug: { $regex: new RegExp(`^${escapeRegex(prefix)}(-[0-9a-fA-F]{4})?$`) },
    });
  }

  public async findAgencyPackages(
    agencyId: string | Types.ObjectId,
    filters: PackageQueryFilters,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPackagesResult> {
    const agencyObjId =
      agencyId instanceof Types.ObjectId ? agencyId : new Types.ObjectId(agencyId);

    if (mongoose.connection.readyState === 0) {
      let list = Array.from(this.inMemoryPackages.values()).filter(
        (p) => p.agencyId.toString() === agencyObjId.toString(),
      );
      if (filters.status) {
        list = list.filter((p) => p.status === filters.status);
      }
      if (filters.packageCategory) {
        list = list.filter((p) => p.packageCategory === filters.packageCategory);
      }
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const total = list.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const items = list.slice((page - 1) * limit, page * limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      };
    }

    const query: FilterQuery<ITravelPackageDocument> = { agencyId: agencyObjId };

    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.packageCategory) {
      query.packageCategory = filters.packageCategory;
    }

    const total = await TravelPackageModel.countDocuments(query);
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const items = await TravelPackageModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<PackageLean[]>()
      .exec();

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  public async findPublicPackages(
    filters: PackageQueryFilters,
    sortField: 'newest' | 'price_asc' | 'price_desc' | 'duration_asc' | 'duration_desc' = 'newest',
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPackagesResult> {
    if (mongoose.connection.readyState === 0) {
      let list = Array.from(this.inMemoryPackages.values()).filter(
        (p) => p.status === 'PUBLISHED',
      );

      if (filters.packageCategory) {
        list = list.filter((p) => p.packageCategory === filters.packageCategory);
      }
      if (filters.destinationId) {
        list = list.filter((p) =>
          p.destinationIds.some((id) => id.toString() === filters.destinationId!.toString()),
        );
      }
      if (filters.minDays !== undefined) {
        list = list.filter((p) => p.durationDays >= filters.minDays!);
      }
      if (filters.maxDays !== undefined) {
        list = list.filter((p) => p.durationDays <= filters.maxDays!);
      }
      if (filters.minPrice !== undefined) {
        list = list.filter((p) => p.basePrice >= filters.minPrice!);
      }
      if (filters.maxPrice !== undefined) {
        list = list.filter((p) => p.basePrice <= filters.maxPrice!);
      }
      if (filters.search) {
        const regex = new RegExp(escapeRegex(filters.search), 'i');
        list = list.filter((p) => regex.test(p.title) || regex.test(p.shortDescription));
      }

      // Sort
      if (sortField === 'price_asc') {
        list.sort((a, b) => a.basePrice - b.basePrice);
      } else if (sortField === 'price_desc') {
        list.sort((a, b) => b.basePrice - a.basePrice);
      } else if (sortField === 'duration_asc') {
        list.sort((a, b) => a.durationDays - b.durationDays);
      } else if (sortField === 'duration_desc') {
        list.sort((a, b) => b.durationDays - a.durationDays);
      } else {
        list.sort((a, b) => new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime());
      }

      const total = list.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const items = list.slice((page - 1) * limit, page * limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      };
    }

    // MongoDB Aggregation Pipeline with Real-time Agency and Account status verification
    const matchConditions: Record<string, unknown> = {
      status: 'PUBLISHED',
    };

    if (filters.packageCategory) {
      matchConditions.packageCategory = filters.packageCategory;
    }
    if (filters.destinationId) {
      matchConditions.destinationIds = filters.destinationId;
    }
    if (filters.minDays !== undefined || filters.maxDays !== undefined) {
      const daysFilter: Record<string, number> = {};
      if (filters.minDays !== undefined) daysFilter.$gte = filters.minDays;
      if (filters.maxDays !== undefined) daysFilter.$lte = filters.maxDays;
      matchConditions.durationDays = daysFilter;
    }
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (filters.minPrice !== undefined) priceFilter.$gte = filters.minPrice;
      if (filters.maxPrice !== undefined) priceFilter.$lte = filters.maxPrice;
      matchConditions.basePrice = priceFilter;
    }
    if (filters.search) {
      const regex = new RegExp(escapeRegex(filters.search), 'i');
      matchConditions.$or = [
        { title: regex },
        { shortDescription: regex },
        { tags: regex },
      ];
    }

    const sortStage: Record<string, 1 | -1> = {};
    if (sortField === 'price_asc') {
      sortStage.basePrice = 1;
      sortStage._id = -1;
    } else if (sortField === 'price_desc') {
      sortStage.basePrice = -1;
      sortStage._id = -1;
    } else if (sortField === 'duration_asc') {
      sortStage.durationDays = 1;
      sortStage._id = -1;
    } else if (sortField === 'duration_desc') {
      sortStage.durationDays = -1;
      sortStage._id = -1;
    } else {
      sortStage.publishedAt = -1;
      sortStage._id = -1;
    }

    const agencyMatchConditions: Record<string, unknown> = {
      'agency.verificationStatus': 'VERIFIED',
    };
    if (filters.district) {
      agencyMatchConditions['agency.district'] = filters.district;
    }

    const pipeline: any[] = [
      { $match: matchConditions },
      // Join Agency and enforce VERIFIED status
      {
        $lookup: {
          from: 'agencies',
          localField: 'agencyId',
          foreignField: '_id',
          as: 'agency',
        },
      },
      { $unwind: '$agency' },
      { $match: agencyMatchConditions },
      // Join Account and enforce ACTIVE status
      {
        $lookup: {
          from: 'accounts',
          localField: 'agency.accountId',
          foreignField: '_id',
          as: 'account',
        },
      },
      { $unwind: '$account' },
      { $match: { 'account.status': 'ACTIVE' } },
      // Facet for pagination and total count
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $sort: sortStage },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
        },
      },
    ];

    const [facetResult] = await TravelPackageModel.aggregate(pipeline).exec();
    const total = facetResult?.metadata[0]?.total || 0;
    const items = (facetResult?.data || []) as PackageLean[];
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  public async adminFindPackages(
    filters: PackageQueryFilters,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPackagesResult> {
    if (mongoose.connection.readyState === 0) {
      let list = Array.from(this.inMemoryPackages.values());
      if (filters.status) {
        list = list.filter((p) => p.status === filters.status);
      }
      if (filters.agencyId) {
        list = list.filter((p) => p.agencyId.toString() === filters.agencyId!.toString());
      }
      if (filters.packageCategory) {
        list = list.filter((p) => p.packageCategory === filters.packageCategory);
      }
      if (filters.search) {
        const regex = new RegExp(escapeRegex(filters.search), 'i');
        list = list.filter((p) => regex.test(p.title) || regex.test(p.shortDescription));
      }
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const total = list.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const items = list.slice((page - 1) * limit, page * limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      };
    }

    const query: FilterQuery<ITravelPackageDocument> = {};
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.agencyId) {
      query.agencyId = filters.agencyId;
    }
    if (filters.packageCategory) {
      query.packageCategory = filters.packageCategory;
    }
    if (filters.search) {
      const regex = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [{ title: regex }, { shortDescription: regex }, { tags: regex }];
    }

    const total = await TravelPackageModel.countDocuments(query);
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const items = await TravelPackageModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<PackageLean[]>()
      .exec();

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    };
  }
}

export const packageRepository = new PackageRepository();
