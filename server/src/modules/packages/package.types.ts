import { Types } from 'mongoose';
import type {
  PackageCategory,
  PackagePricingUnit,
  PackageStatus,
} from '@kerala-tourism/shared-types';

export interface IItineraryDay {
  dayNumber: number;
  title: string;
  description: string;
  activities: string[];
  destinationId?: Types.ObjectId | null;
  estimatedDuration?: string | null;
}

export interface IPackageGroupPricingTier {
  minPax: number;
  maxPax: number;
  pricePerPerson: number;
}

export interface PackageLean {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  packageCategory: PackageCategory;
  tags: string[];
  destinationIds: Types.ObjectId[];
  startLocation?: string | null;
  endLocation?: string | null;
  itinerary: IItineraryDay[];
  durationDays: number;
  durationNights: number;
  inclusions: string[];
  exclusions: string[];
  importantInformation?: string | null;
  cancellationPolicy?: string | null;
  currency: string;
  basePrice: number;
  childPrice?: number | null;
  groupPricing?: IPackageGroupPricingTier[];
  pricingUnit: PackagePricingUnit;
  maxGroupSize?: number | null;
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds: Types.ObjectId[];
  status: PackageStatus;
  submittedAt?: Date | null;
  publishedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  rejectionReason?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePackagePersistenceInput {
  agencyId: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  packageCategory: PackageCategory;
  tags: string[];
  destinationIds: Types.ObjectId[];
  startLocation?: string | null;
  endLocation?: string | null;
  itinerary: IItineraryDay[];
  durationDays: number;
  durationNights: number;
  inclusions: string[];
  exclusions: string[];
  importantInformation?: string | null;
  cancellationPolicy?: string | null;
  currency: string;
  basePrice: number;
  childPrice?: number | null;
  groupPricing?: IPackageGroupPricingTier[];
  pricingUnit: PackagePricingUnit;
  maxGroupSize?: number | null;
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds: Types.ObjectId[];
  status?: PackageStatus;
}

export interface UpdatePackagePersistenceInput {
  updatedBy: Types.ObjectId;
  title?: string;
  slug?: string;
  shortDescription?: string;
  description?: string;
  packageCategory?: PackageCategory;
  tags?: string[];
  destinationIds?: Types.ObjectId[];
  startLocation?: string | null;
  endLocation?: string | null;
  itinerary?: IItineraryDay[];
  durationDays?: number;
  durationNights?: number;
  inclusions?: string[];
  exclusions?: string[];
  importantInformation?: string | null;
  cancellationPolicy?: string | null;
  currency?: string;
  basePrice?: number;
  childPrice?: number | null;
  groupPricing?: IPackageGroupPricingTier[];
  pricingUnit?: PackagePricingUnit;
  maxGroupSize?: number | null;
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds?: Types.ObjectId[];
  status?: PackageStatus;
  submittedAt?: Date | null;
  publishedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  rejectionReason?: string | null;
  archivedAt?: Date | null;
}

export interface PackageQueryFilters {
  agencyId?: Types.ObjectId;
  status?: PackageStatus;
  packageCategory?: PackageCategory;
  destinationId?: Types.ObjectId;
  district?: string;
  minDays?: number;
  maxDays?: number;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
}

export interface PaginatedPackagesResult {
  items: PackageLean[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}
