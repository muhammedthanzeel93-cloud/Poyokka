import { Types } from 'mongoose';
import type {
  RoomCategory,
  RoomFacility,
  RoomPricingUnit,
  RoomSizeUnit,
  RoomStatus,
} from '@kerala-tourism/shared-types';

export interface RoomTypeLean {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  accountId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string | null;
  roomCategory: RoomCategory;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedConfiguration: string;
  bedCount: number;
  roomSize?: number | null;
  roomSizeUnit: RoomSizeUnit;
  facilities: RoomFacility[];
  basePrice: number; // Stored in integer paise (1 INR = 100 paise)
  currency: string;
  pricingUnit: RoomPricingUnit;
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds: Types.ObjectId[];
  status: RoomStatus;
  totalUnits: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomInventoryLean {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  date: Date; // UTC midnight
  totalUnits: number;
  availableUnits: number;
  blockedUnits: number;
  maintenanceUnits: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomTypePersistenceInput {
  propertyId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  accountId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string | null;
  roomCategory: RoomCategory;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedConfiguration: string;
  bedCount: number;
  roomSize?: number | null;
  roomSizeUnit?: RoomSizeUnit;
  facilities?: RoomFacility[];
  basePrice: number;
  currency?: string;
  pricingUnit?: RoomPricingUnit;
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds?: Types.ObjectId[];
  status?: RoomStatus;
  totalUnits?: number;
}

export interface UpdateRoomTypePersistenceInput {
  name?: string;
  slug?: string;
  description?: string | null;
  roomCategory?: RoomCategory;
  maxAdults?: number;
  maxChildren?: number;
  maxOccupancy?: number;
  bedConfiguration?: string;
  bedCount?: number;
  roomSize?: number | null;
  roomSizeUnit?: RoomSizeUnit;
  facilities?: RoomFacility[];
  basePrice?: number;
  currency?: string;
  pricingUnit?: RoomPricingUnit;
  coverMediaId?: Types.ObjectId | null;
  galleryMediaIds?: Types.ObjectId[];
  status?: RoomStatus;
  totalUnits?: number;
}

export interface RoomTypeFilters {
  propertyId?: Types.ObjectId;
  businessProfileId?: Types.ObjectId;
  status?: RoomStatus;
  roomCategory?: RoomCategory;
}

export type RoomTypeQueryFilters = RoomTypeFilters;

export interface RoomAvailabilityItem {
  roomTypeId: string;
  name: string;
  slug: string;
  roomCategory: RoomCategory;
  basePrice: number;
  currency: string;
  pricingUnit: RoomPricingUnit;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  totalUnits: number;
  availableUnits: number;
  isAvailable: boolean;
  totalPrice: number;
  stayNights: number;
}

export interface PaginatedRoomTypesResult {
  items: RoomTypeLean[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateInventoryPersistenceInput {
  propertyId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  date: Date;
  totalUnits: number;
  availableUnits: number;
  blockedUnits: number;
  maintenanceUnits: number;
}

export interface UpdateInventoryPersistenceInput {
  totalUnits?: number;
  availableUnits?: number;
  blockedUnits?: number;
  maintenanceUnits?: number;
}

export interface InventoryDateRangeQuery {
  roomTypeId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
}

export interface PublicRoomAggregateItem extends RoomTypeLean {
  coverMedia?: { _id: Types.ObjectId; url: string } | null;
  galleryMedia?: Array<{ _id: Types.ObjectId; url: string }>;
}
