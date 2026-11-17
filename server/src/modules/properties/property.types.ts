import { Types } from 'mongoose';
import type {
  BusinessType,
  GeoPoint,
  KeralaDistrict,
  PropertyFacility,
  PropertyStatus,
  PropertyType,
} from '@kerala-tourism/shared-types';

export interface PropertyLean {
  _id: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  accountId: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  name: string;
  slug: string;
  propertyType: PropertyType;
  shortDescription?: string | null;
  description?: string | null;
  address: string;
  district: KeralaDistrict;
  city?: string | null;
  state: string;
  postalCode?: string | null;
  location: GeoPoint;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  facilities: PropertyFacility[];
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds: Types.ObjectId[];
  status: PropertyStatus;
  submittedAt?: Date | null;
  publishedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  rejectionReason?: string | null;
  archivedAt?: Date | null;
  supportsHourly?: boolean;
  supportsDaily?: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Backward compatibility fields
  ownerId?: string;
  category?: string;
  amenities?: string[];
  isVerified?: boolean;
}

export interface CreatePropertyPersistenceInput {
  businessProfileId: Types.ObjectId;
  accountId: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  name: string;
  slug: string;
  propertyType: PropertyType;
  shortDescription?: string | null;
  description?: string | null;
  address: string;
  district: KeralaDistrict;
  city?: string | null;
  state?: string;
  postalCode?: string | null;
  location?: GeoPoint;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  facilities?: PropertyFacility[];
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds?: Types.ObjectId[];
  status?: PropertyStatus;
  submittedAt?: Date | null;
  publishedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId | null;
  rejectionReason?: string | null;
  archivedAt?: Date | null;
  supportsHourly?: boolean;
  supportsDaily?: boolean;
}

export interface UpdatePropertyPersistenceInput {
  updatedBy: Types.ObjectId;
  name?: string;
  propertyType?: PropertyType;
  shortDescription?: string | null;
  description?: string | null;
  address?: string;
  district?: KeralaDistrict;
  city?: string | null;
  state?: string;
  postalCode?: string | null;
  location?: GeoPoint;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  facilities?: PropertyFacility[];
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds?: Types.ObjectId[];
  supportsHourly?: boolean;
  supportsDaily?: boolean;
}

export interface PropertyQueryFilters {
  status?: PropertyStatus;
  propertyType?: PropertyType;
  district?: string;
}

export interface PublicPropertyFilters {
  district?: string;
  propertyType?: PropertyType;
  facilities?: string[];
  search?: string;
  sort?: 'newest' | 'name_asc' | 'name_desc';
}

export interface NearbyPropertyFilters {
  latitude: number;
  longitude: number;
  radiusKm: number;
  propertyType?: PropertyType;
}

export interface AdminPropertyFilters {
  status?: PropertyStatus;
  propertyType?: PropertyType;
  district?: string;
  businessProfileId?: Types.ObjectId;
}

export interface PaginatedPropertiesResult<T = PropertyLean> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PublicPropertyAggregateItem extends PropertyLean {
  business: {
    _id: Types.ObjectId;
    businessName: string;
    businessType: BusinessType;
    district?: string | null;
    contactNumber?: string | null;
  };
  coverMedia?: {
    _id: Types.ObjectId;
    url: string;
  } | null;
  galleryMedia?: Array<{
    _id: Types.ObjectId;
    url: string;
  }>;
  distanceMeters?: number | null;
}
