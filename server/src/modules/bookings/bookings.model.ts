import { Schema, model, Document, Types } from 'mongoose';
import { BOOKING_STATUSES } from '@kerala-tourism/constants';
import { BookingStatus, PriceSnapshotDto, GuestDetailsDto } from '@kerala-tourism/shared-types';

export interface IBookingDocument extends Document {
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

const priceDailyBreakdownSchema = new Schema(
  {
    date: { type: String, required: true },
    pricePaise: { type: Number, required: true },
    priceInr: { type: Number, required: true },
  },
  { _id: false },
);

const priceSnapshotSchema = new Schema(
  {
    basePricePaise: { type: Number, required: true },
    basePriceInr: { type: Number, required: true },
    numberOfRooms: { type: Number, required: true },
    numberOfNights: { type: Number, required: true },
    dailyBreakdown: { type: [priceDailyBreakdownSchema], required: true },
    subtotalPaise: { type: Number, required: true },
    subtotalInr: { type: Number, required: true },
    taxesPaise: { type: Number, required: true, default: 0 },
    taxesInr: { type: Number, required: true, default: 0 },
    totalPaise: { type: Number, required: true },
    totalInr: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
  },
  { _id: false },
);

const guestDetailsSchema = new Schema(
  {
    primaryGuestName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    specialRequests: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const bookingSchema = new Schema<IBookingDocument>(
  {
    bookingReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    touristAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    roomTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'RoomType',
      required: true,
      index: true,
    },
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: true,
    },
    checkInDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    checkOutDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    numberOfRooms: {
      type: Number,
      required: true,
      min: 1,
    },
    adults: {
      type: Number,
      required: true,
      min: 1,
    },
    children: {
      type: Number,
      default: 0,
      min: 0,
    },
    nights: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUSES),
      default: BOOKING_STATUSES.AWAITING_PAYMENT,
    },
    holdId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryHold',
      default: null,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
      index: true,
    },
    paymentReference: {
      type: String,
      default: null,
      trim: true,
    },
    priceSnapshot: {
      type: priceSnapshotSchema,
      required: true,
    },
    guestDetails: {
      type: guestDetailsSchema,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'bookings',
  },
);

bookingSchema.index({ touristAccountId: 1, createdAt: -1 });
bookingSchema.index({ touristAccountId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ propertyId: 1, checkInDate: 1 });
bookingSchema.index({ businessProfileId: 1, createdAt: -1 });

export const BookingModel = model<IBookingDocument>('Booking', bookingSchema);
