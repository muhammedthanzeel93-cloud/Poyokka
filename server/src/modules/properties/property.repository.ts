import mongoose, { ClientSession, FilterQuery, PipelineStage, Types } from 'mongoose';
import { env } from '../../config/env';
import { InternalServerError } from '../../shared/errors/AppError';
import { IPropertyDocument, PropertyModel } from './property.model';
import {
  AdminPropertyFilters,
  CreatePropertyPersistenceInput,
  NearbyPropertyFilters,
  PaginatedPropertiesResult,
  PropertyLean,
  PropertyQueryFilters,
  PublicPropertyAggregateItem,
  PublicPropertyFilters,
  UpdatePropertyPersistenceInput,
} from './property.types';
import {
  ACCOUNT_STATUSES,
  PROPERTY_STATUSES,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type { PropertyStatus } from '@kerala-tourism/shared-types';
import { escapeRegex } from './property.validation';

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

/**
 * Haversine formula to compute distance in meters between two [lon, lat] coordinates
 */
const haversineDistanceMeters = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
};

export class PropertyRepository {
  // In-memory backing store for disconnected unit testing
  public inMemoryStore: Map<string, PropertyLean> = new Map();

  /**
   * Coordinates multi-document writes in an atomic MongoDB ACID transaction with jittered retries
   */
  public async withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
    const requireTransactions =
      env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

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
      } catch (txError: unknown) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }

        if (isUnsupportedTransactionError(txError)) {
          if (requireTransactions) {
            throw new InternalServerError(
              'Property operations require a MongoDB replica set transaction topology',
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
      'Property transaction retries exhausted',
      'TRANSACTION_EXHAUSTED',
    );
  }

  public async createProperty(
    data: CreatePropertyPersistenceInput,
    session?: ClientSession,
  ): Promise<PropertyLean> {
    if (mongoose.connection.readyState === 0) {
      const id = new Types.ObjectId();
      const lean: PropertyLean = {
        _id: id,
        businessProfileId: data.businessProfileId,
        accountId: data.accountId,
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
        name: data.name,
        slug: data.slug,
        propertyType: data.propertyType,
        shortDescription: data.shortDescription || null,
        description: data.description || null,
        address: data.address,
        district: data.district,
        city: data.city || null,
        state: data.state || 'Kerala',
        postalCode: data.postalCode || null,
        location: data.location || { type: 'Point', coordinates: [76.2711, 10.8505] },
        contactPhone: data.contactPhone || null,
        contactEmail: data.contactEmail || null,
        website: data.website || null,
        facilities: data.facilities || [],
        coverMediaId: data.coverMediaId || null,
        galleryMediaIds: data.galleryMediaIds || [],
        status: data.status || PROPERTY_STATUSES.DRAFT,
        submittedAt: null,
        publishedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        archivedAt: null,
        supportsHourly: data.supportsHourly ?? false,
        supportsDaily: data.supportsDaily ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: data.accountId.toString(),
        category: data.propertyType,
        amenities: data.facilities || [],
        isVerified: data.status === PROPERTY_STATUSES.PUBLISHED,
      };
      this.inMemoryStore.set(id.toString(), lean);
      return lean;
    }

    const doc = new PropertyModel(data);
    await doc.save({ session });
    return doc.toObject() as unknown as PropertyLean;
  }

  public async findPropertyById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<PropertyLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      const found = this.inMemoryStore.get(idStr);
      return found ? { ...found } : null;
    }

    const query = PropertyModel.findById(id);
    if (session) query.session(session);
    return query.lean<PropertyLean>().exec();
  }

  public async findPropertyBySlug(
    slug: string,
    session?: ClientSession,
  ): Promise<PropertyLean | null> {
    const cleanSlug = slug.trim().toLowerCase();
    if (mongoose.connection.readyState === 0) {
      for (const item of this.inMemoryStore.values()) {
        if (item.slug === cleanSlug) return { ...item };
      }
      return null;
    }

    const query = PropertyModel.findOne({ slug: cleanSlug });
    if (session) query.session(session);
    return query.lean<PropertyLean>().exec();
  }

  public async countPropertiesBySlugPrefix(slugPrefix: string): Promise<number> {
    if (mongoose.connection.readyState === 0) {
      let count = 0;
      for (const item of this.inMemoryStore.values()) {
        if (item.slug.startsWith(slugPrefix)) count += 1;
      }
      return count;
    }

    return PropertyModel.countDocuments({
      slug: new RegExp(`^${escapeRegex(slugPrefix)}`),
    });
  }

  public async updateProperty(
    id: string | Types.ObjectId,
    data: UpdatePropertyPersistenceInput,
    session?: ClientSession,
  ): Promise<PropertyLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      const existing = this.inMemoryStore.get(idStr);
      if (!existing) return null;
      const updated: PropertyLean = {
        ...existing,
        ...data,
        updatedAt: new Date(),
      };
      this.inMemoryStore.set(idStr, updated);
      return updated;
    }

    const query = PropertyModel.findByIdAndUpdate(
      id,
      { $set: { ...data, updatedAt: new Date() } },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<PropertyLean>().exec();
  }

  public async updatePropertyStatus(
    id: string | Types.ObjectId,
    status: PropertyStatus,
    additionalFields: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<PropertyLean | null> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      const existing = this.inMemoryStore.get(idStr);
      if (!existing) return null;
      const updated: PropertyLean = {
        ...existing,
        status,
        ...additionalFields,
        updatedAt: new Date(),
      };
      this.inMemoryStore.set(idStr, updated);
      return updated;
    }

    const query = PropertyModel.findByIdAndUpdate(
      id,
      { $set: { status, ...additionalFields, updatedAt: new Date() } },
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<PropertyLean>().exec();
  }

  public async deleteProperty(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<boolean> {
    const idStr = id.toString();
    if (mongoose.connection.readyState === 0) {
      return this.inMemoryStore.delete(idStr);
    }

    const res = await PropertyModel.findByIdAndDelete(id, { session });
    return !!res;
  }

  public async findBusinessProperties(
    businessProfileId: Types.ObjectId,
    filters: PropertyQueryFilters,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPropertiesResult> {
    if (mongoose.connection.readyState === 0) {
      const matches: PropertyLean[] = [];
      for (const item of this.inMemoryStore.values()) {
        if (item.businessProfileId.toString() !== businessProfileId.toString()) continue;
        if (filters.status && item.status !== filters.status) continue;
        if (filters.propertyType && item.propertyType !== filters.propertyType) continue;
        if (filters.district && item.district.toLowerCase() !== filters.district.toLowerCase())
          continue;
        matches.push(item);
      }
      matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = matches.length;
      const skip = (page - 1) * limit;
      const items = matches.slice(skip, skip + limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    const query: FilterQuery<IPropertyDocument> = { businessProfileId };
    if (filters.status) query.status = filters.status;
    if (filters.propertyType) query.propertyType = filters.propertyType;
    if (filters.district) query.district = filters.district;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      PropertyModel.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<PropertyLean[]>(),
      PropertyModel.countDocuments(query),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async findNearbyProperties(
    filters: NearbyPropertyFilters,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPropertiesResult<PublicPropertyAggregateItem>> {
    const maxDistanceMeters = filters.radiusKm * 1000;

    if (mongoose.connection.readyState === 0) {
      const candidateList: PublicPropertyAggregateItem[] = [];
      for (const item of this.inMemoryStore.values()) {
        if (item.status !== PROPERTY_STATUSES.PUBLISHED) continue;
        if (filters.propertyType && item.propertyType !== filters.propertyType) continue;
        const [lon, lat] = item.location.coordinates;
        const dist = haversineDistanceMeters(filters.longitude, filters.latitude, lon, lat);
        if (dist <= maxDistanceMeters) {
          candidateList.push({
            ...item,
            distanceMeters: dist,
            business: {
              _id: item.businessProfileId,
              businessName: 'Verified Hospitality Partner',
              businessType: 'HOTEL',
              district: item.district,
            },
          });
        }
      }
      candidateList.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
      const total = candidateList.length;
      const skip = (page - 1) * limit;
      const items = candidateList.slice(skip, skip + limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // Real MongoDB $geoNear Aggregation Pipeline
    const matchQuery: Record<string, unknown> = {
      status: PROPERTY_STATUSES.PUBLISHED,
    };
    if (filters.propertyType) {
      matchQuery.propertyType = filters.propertyType;
    }

    const pipeline: PipelineStage[] = [
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [filters.longitude, filters.latitude],
          },
          distanceField: 'distanceMeters',
          maxDistance: maxDistanceMeters,
          query: matchQuery,
          spherical: true,
        },
      },
      // Verify business is active and verified
      {
        $lookup: {
          from: 'businessprofiles',
          localField: 'businessProfileId',
          foreignField: '_id',
          as: 'businessDoc',
        },
      },
      { $unwind: '$businessDoc' },
      {
        $match: {
          'businessDoc.verificationStatus': VERIFICATION_STATUSES.VERIFIED,
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'accountDoc',
        },
      },
      { $unwind: '$accountDoc' },
      {
        $match: {
          'accountDoc.status': ACCOUNT_STATUSES.ACTIVE,
        },
      },
      // Lookup cover media
      {
        $lookup: {
          from: 'media',
          localField: 'coverMediaId',
          foreignField: '_id',
          as: 'coverMediaArr',
        },
      },
      // Lookup gallery media
      {
        $lookup: {
          from: 'media',
          localField: 'galleryMediaIds',
          foreignField: '_id',
          as: 'galleryMedia',
        },
      },
      {
        $project: {
          _id: 1,
          businessProfileId: 1,
          accountId: 1,
          createdBy: 1,
          updatedBy: 1,
          name: 1,
          slug: 1,
          propertyType: 1,
          shortDescription: 1,
          description: 1,
          address: 1,
          district: 1,
          city: 1,
          state: 1,
          postalCode: 1,
          location: 1,
          contactPhone: 1,
          contactEmail: 1,
          website: 1,
          facilities: 1,
          coverMediaId: 1,
          galleryMediaIds: 1,
          status: 1,
          submittedAt: 1,
          publishedAt: 1,
          reviewedAt: 1,
          reviewedBy: 1,
          rejectionReason: 1,
          archivedAt: 1,
          createdAt: 1,
          updatedAt: 1,
          distanceMeters: { $round: ['$distanceMeters', 0] },
          business: {
            _id: '$businessDoc._id',
            businessName: '$businessDoc.businessName',
            businessType: '$businessDoc.businessType',
            district: '$businessDoc.businessAddress.district',
            contactNumber: '$businessDoc.contactNumber',
          },
          coverMedia: { $arrayElemAt: ['$coverMediaArr', 0] },
          galleryMedia: 1,
        },
      },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [facetResult] = await PropertyModel.aggregate(pipeline);
    const items = (facetResult?.items || []) as PublicPropertyAggregateItem[];
    const total = facetResult?.totalCount?.[0]?.count || 0;

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async findPublicProperties(
    filters: PublicPropertyFilters,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPropertiesResult<PublicPropertyAggregateItem>> {
    if (mongoose.connection.readyState === 0) {
      const matches: PublicPropertyAggregateItem[] = [];
      for (const item of this.inMemoryStore.values()) {
        if (item.status !== PROPERTY_STATUSES.PUBLISHED) continue;
        if (filters.district && item.district.toLowerCase() !== filters.district.toLowerCase())
          continue;
        if (filters.propertyType && item.propertyType !== filters.propertyType) continue;
        if (filters.facilities && filters.facilities.length > 0) {
          const hasAllFacilities = filters.facilities.every((f) => item.facilities.includes(f as any));
          if (!hasAllFacilities) continue;
        }
        if (filters.search) {
          const s = filters.search.toLowerCase();
          const matchName = item.name.toLowerCase().includes(s);
          const matchDesc = item.shortDescription?.toLowerCase().includes(s) || false;
          if (!matchName && !matchDesc) continue;
        }
        matches.push({
          ...item,
          distanceMeters: null,
          business: {
            _id: item.businessProfileId,
            businessName: 'Verified Hospitality Partner',
            businessType: 'HOTEL',
            district: item.district,
          },
        });
      }

      if (filters.sort === 'name_asc') {
        matches.sort((a, b) => a.name.localeCompare(b.name));
      } else if (filters.sort === 'name_desc') {
        matches.sort((a, b) => b.name.localeCompare(a.name));
      } else {
        matches.sort((a, b) => {
          const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : a.createdAt.getTime();
          const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : b.createdAt.getTime();
          return dateB - dateA;
        });
      }

      const total = matches.length;
      const skip = (page - 1) * limit;
      const items = matches.slice(skip, skip + limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // Real MongoDB Aggregation Pipeline
    const matchQuery: Record<string, unknown> = {
      status: PROPERTY_STATUSES.PUBLISHED,
    };
    if (filters.district) matchQuery.district = filters.district;
    if (filters.propertyType) matchQuery.propertyType = filters.propertyType;
    if (filters.facilities && filters.facilities.length > 0) {
      matchQuery.facilities = { $all: filters.facilities };
    }
    if (filters.search) {
      const rx = new RegExp(escapeRegex(filters.search), 'i');
      matchQuery.$or = [{ name: rx }, { shortDescription: rx }, { description: rx }];
    }

    let sortStage: Record<string, 1 | -1> = { publishedAt: -1, _id: -1 };
    if (filters.sort === 'name_asc') sortStage = { name: 1, _id: -1 };
    if (filters.sort === 'name_desc') sortStage = { name: -1, _id: -1 };

    const pipeline: PipelineStage[] = [
      { $match: matchQuery },
      // Join business profile and enforce VERIFIED
      {
        $lookup: {
          from: 'businessprofiles',
          localField: 'businessProfileId',
          foreignField: '_id',
          as: 'businessDoc',
        },
      },
      { $unwind: '$businessDoc' },
      {
        $match: {
          'businessDoc.verificationStatus': VERIFICATION_STATUSES.VERIFIED,
        },
      },
      // Join account and enforce ACTIVE
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'accountDoc',
        },
      },
      { $unwind: '$accountDoc' },
      {
        $match: {
          'accountDoc.status': ACCOUNT_STATUSES.ACTIVE,
        },
      },
      // Lookup cover media
      {
        $lookup: {
          from: 'media',
          localField: 'coverMediaId',
          foreignField: '_id',
          as: 'coverMediaArr',
        },
      },
      // Lookup gallery media
      {
        $lookup: {
          from: 'media',
          localField: 'galleryMediaIds',
          foreignField: '_id',
          as: 'galleryMedia',
        },
      },
      { $sort: sortStage },
      {
        $project: {
          _id: 1,
          businessProfileId: 1,
          accountId: 1,
          createdBy: 1,
          updatedBy: 1,
          name: 1,
          slug: 1,
          propertyType: 1,
          shortDescription: 1,
          description: 1,
          address: 1,
          district: 1,
          city: 1,
          state: 1,
          postalCode: 1,
          location: 1,
          contactPhone: 1,
          contactEmail: 1,
          website: 1,
          facilities: 1,
          coverMediaId: 1,
          galleryMediaIds: 1,
          status: 1,
          submittedAt: 1,
          publishedAt: 1,
          reviewedAt: 1,
          reviewedBy: 1,
          rejectionReason: 1,
          archivedAt: 1,
          createdAt: 1,
          updatedAt: 1,
          business: {
            _id: '$businessDoc._id',
            businessName: '$businessDoc.businessName',
            businessType: '$businessDoc.businessType',
            district: '$businessDoc.businessAddress.district',
            contactNumber: '$businessDoc.contactNumber',
          },
          coverMedia: { $arrayElemAt: ['$coverMediaArr', 0] },
          galleryMedia: 1,
        },
      },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [facetResult] = await PropertyModel.aggregate(pipeline);
    const items = (facetResult?.items || []) as PublicPropertyAggregateItem[];
    const total = facetResult?.totalCount?.[0]?.count || 0;

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async findAdminProperties(
    filters: AdminPropertyFilters,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedPropertiesResult> {
    if (mongoose.connection.readyState === 0) {
      const matches: PropertyLean[] = [];
      for (const item of this.inMemoryStore.values()) {
        if (filters.status && item.status !== filters.status) continue;
        if (filters.propertyType && item.propertyType !== filters.propertyType) continue;
        if (filters.district && item.district.toLowerCase() !== filters.district.toLowerCase())
          continue;
        if (filters.businessProfileId && item.businessProfileId.toString() !== filters.businessProfileId.toString())
          continue;
        matches.push(item);
      }
      matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = matches.length;
      const skip = (page - 1) * limit;
      const items = matches.slice(skip, skip + limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    const query: FilterQuery<IPropertyDocument> = {};
    if (filters.status) query.status = filters.status;
    if (filters.propertyType) query.propertyType = filters.propertyType;
    if (filters.district) query.district = filters.district;
    if (filters.businessProfileId) query.businessProfileId = filters.businessProfileId;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      PropertyModel.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<PropertyLean[]>(),
      PropertyModel.countDocuments(query),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

export const propertyRepository = new PropertyRepository();
