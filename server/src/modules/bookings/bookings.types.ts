import { Types } from 'mongoose';
import { BookingStatus, InventoryHoldStatus, PriceSnapshotDto, GuestDetailsDto } from '@kerala-tourism/shared-types';

export interface IBookingLean {
  _id: Types.ObjectId;
  bookingReference: string;
  touristAccountId: Types.ObjectId;
  propertyId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  checkInDate: string; // ISO 'YYYY-MM-DD'
  checkOutDate: string; // ISO 'YYYY-MM-DD'
  numberOfRooms: number;
  adults: number;
  children: number;
  nights: number;
  status: BookingStatus;
  holdId?: Types.ObjectId | null;
  paidAt?: Date | null;
  confirmedAt?: Date | null;
  paymentId?: Types.ObjectId | null;
  paymentReference?: string | null;
  priceSnapshot: PriceSnapshotDto;
  guestDetails: GuestDetailsDto;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInventoryHoldLean {
  _id: Types.ObjectId;
  bookingId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  propertyId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  numberOfRooms: number;
  stayDates: string[]; // ['YYYY-MM-DD', ...]
  status: InventoryHoldStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IIdempotencyRecordLean {
  _id: Types.ObjectId;
  touristAccountId: Types.ObjectId;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  bookingId?: Types.ObjectId | null;
  holdId?: Types.ObjectId | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateHoldPersistenceInput {
  touristAccountId: Types.ObjectId;
  propertyId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  checkInDate: string;
  checkOutDate: string;
  numberOfRooms: number;
  adults: number;
  children: number;
  nights: number;
  stayDates: string[];
  priceSnapshot: PriceSnapshotDto;
  guestDetails: GuestDetailsDto;
  expiresAt: Date;
}

export interface BookingListQueryFilter {
  touristAccountId?: string;
  businessProfileId?: string;
  propertyId?: string;
  status?: BookingStatus;
  page?: number;
  limit?: number;
}

// Backward compatibility stubs for Day 05 placeholders
export interface CreateBookingDto {
  touristId: string;
  propertyId: string;
  roomId: string;
  mode?: string;
  checkInTime?: string;
  checkOutTime?: string;
  durationHours?: number;
  guestsCount?: number;
  totalAmount?: number;
  specialRequests?: string;
}

export interface BookingQueryFilter {
  touristId?: string;
  propertyId?: string;
  status?: BookingStatus;
  limit?: number;
}
