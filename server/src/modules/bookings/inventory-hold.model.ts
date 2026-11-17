import { Schema, model, Document, Types } from 'mongoose';
import { INVENTORY_HOLD_STATUSES } from '@kerala-tourism/constants';
import { InventoryHoldStatus } from '@kerala-tourism/shared-types';

export interface IInventoryHoldDocument extends Document {
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

const inventoryHoldSchema = new Schema<IInventoryHoldDocument>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    roomTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'RoomType',
      required: true,
      index: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: true,
      index: true,
    },
    touristAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    numberOfRooms: {
      type: Number,
      required: true,
      min: 1,
    },
    stayDates: {
      type: [String],
      required: true,
      validate: {
        validator: (dates: string[]) => Array.isArray(dates) && dates.length > 0 && dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
        message: 'Stay dates must contain at least one valid YYYY-MM-DD date string',
      },
    },
    status: {
      type: String,
      enum: Object.values(INVENTORY_HOLD_STATUSES),
      default: INVENTORY_HOLD_STATUSES.ACTIVE,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'inventoryHolds',
  },
);

// Compound index for active hold expiry scanning worker
inventoryHoldSchema.index({ status: 1, expiresAt: 1 });
// Compound index for tourist hold queries
inventoryHoldSchema.index({ touristAccountId: 1, status: 1 });
// 7-day TTL index strictly for eventual storage document pruning (NOT for business logic inventory release)
inventoryHoldSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 604800 });

export const InventoryHoldModel = model<IInventoryHoldDocument>('InventoryHold', inventoryHoldSchema);
