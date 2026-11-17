import { Schema, model, Document, Model, Types } from 'mongoose';
import {
  ROOM_CATEGORIES,
  ROOM_FACILITIES,
  ROOM_PRICING_UNITS,
  ROOM_RULES,
  ROOM_SIZE_UNITS,
  ROOM_STATUSES,
} from '@kerala-tourism/constants';
import type {
  RoomCategory,
  RoomFacility,
  RoomPricingUnit,
  RoomSizeUnit,
  RoomStatus,
} from '@kerala-tourism/shared-types';

export interface IRoomTypeDocument extends Document {
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

const roomTypeSchema = new Schema<IRoomTypeDocument>(
  {
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property ID is required'],
      index: true,
    },
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: [true, 'Business profile ID is required'],
      index: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Room type name is required'],
      trim: true,
      minlength: [ROOM_RULES.MIN_NAME_LENGTH, `Room name must be at least ${ROOM_RULES.MIN_NAME_LENGTH} characters`],
      maxlength: [ROOM_RULES.MAX_NAME_LENGTH, `Room name cannot exceed ${ROOM_RULES.MAX_NAME_LENGTH} characters`],
    },
    slug: {
      type: String,
      required: [true, 'Room slug is required'],
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [ROOM_RULES.MAX_DESCRIPTION_LENGTH, `Description cannot exceed ${ROOM_RULES.MAX_DESCRIPTION_LENGTH} characters`],
      default: null,
    },
    roomCategory: {
      type: String,
      enum: {
        values: Object.values(ROOM_CATEGORIES),
        message: 'Invalid room category: {VALUE}',
      },
      required: [true, 'Room category is required'],
      default: ROOM_CATEGORIES.STANDARD,
    },
    maxAdults: {
      type: Number,
      required: [true, 'Max adults capacity is required'],
      min: [ROOM_RULES.MIN_CAPACITY_ADULTS, `Max adults must be at least ${ROOM_RULES.MIN_CAPACITY_ADULTS}`],
      max: [ROOM_RULES.MAX_CAPACITY_ADULTS, `Max adults cannot exceed ${ROOM_RULES.MAX_CAPACITY_ADULTS}`],
    },
    maxChildren: {
      type: Number,
      default: 0,
      min: [ROOM_RULES.MIN_CAPACITY_CHILDREN, 'Max children cannot be negative'],
      max: [ROOM_RULES.MAX_CAPACITY_CHILDREN, `Max children cannot exceed ${ROOM_RULES.MAX_CAPACITY_CHILDREN}`],
    },
    maxOccupancy: {
      type: Number,
      required: [true, 'Max occupancy is required'],
      min: [ROOM_RULES.MIN_OCCUPANCY, `Max occupancy must be at least ${ROOM_RULES.MIN_OCCUPANCY}`],
      max: [ROOM_RULES.MAX_OCCUPANCY, `Max occupancy cannot exceed ${ROOM_RULES.MAX_OCCUPANCY}`],
      validate: {
        validator(this: IRoomTypeDocument, val: number): boolean {
          return val >= (this.maxAdults || 1);
        },
        message: 'Max occupancy must be greater than or equal to max adults',
      },
    },
    bedConfiguration: {
      type: String,
      required: [true, 'Bed configuration is required'],
      trim: true,
      maxlength: [100, 'Bed configuration cannot exceed 100 characters'],
    },
    bedCount: {
      type: Number,
      required: [true, 'Bed count is required'],
      min: [ROOM_RULES.MIN_BED_COUNT, 'Bed count must be at least 1'],
      max: [ROOM_RULES.MAX_BED_COUNT, `Bed count cannot exceed ${ROOM_RULES.MAX_BED_COUNT}`],
      default: 1,
    },
    roomSize: {
      type: Number,
      min: [1, 'Room size must be positive'],
      default: null,
    },
    roomSizeUnit: {
      type: String,
      enum: {
        values: Object.values(ROOM_SIZE_UNITS),
        message: 'Invalid room size unit: {VALUE}',
      },
      default: ROOM_SIZE_UNITS.SQ_FT,
    },
    facilities: {
      type: [String],
      enum: {
        values: Object.values(ROOM_FACILITIES),
        message: 'Invalid room facility: {VALUE}',
      },
      default: () => [],
    },
    basePrice: {
      type: Number,
      required: [true, 'Base price is required'],
      min: [ROOM_RULES.MIN_PRICE_PAISE, `Base price must be at least ${ROOM_RULES.MIN_PRICE_PAISE} paise`],
      max: [ROOM_RULES.MAX_PRICE_PAISE, `Base price cannot exceed ${ROOM_RULES.MAX_PRICE_PAISE} paise`],
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
      uppercase: true,
    },
    pricingUnit: {
      type: String,
      enum: {
        values: Object.values(ROOM_PRICING_UNITS),
        message: 'Invalid pricing unit: {VALUE}',
      },
      default: ROOM_PRICING_UNITS.PER_NIGHT,
    },
    coverMediaId: {
      type: Schema.Types.ObjectId,
      ref: 'Media',
      default: null,
    },
    galleryMediaIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
      default: () => [],
    },
    status: {
      type: String,
      enum: {
        values: Object.values(ROOM_STATUSES),
        message: 'Invalid room status: {VALUE}',
      },
      default: ROOM_STATUSES.ACTIVE,
      required: [true, 'Room status is required'],
    },
    totalUnits: {
      type: Number,
      required: [true, 'Total units is required'],
      min: [1, 'Total units must be at least 1'],
      max: [ROOM_RULES.MAX_INVENTORY_UNITS, `Total units cannot exceed ${ROOM_RULES.MAX_INVENTORY_UNITS}`],
      default: 1,
    },
  },
  {
    timestamps: true,
    collection: 'roomTypes',
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as Types.ObjectId).toString();
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Compound and Unique Indexes
roomTypeSchema.index({ propertyId: 1, status: 1 }, { name: 'idx_room_types_property_status' });
roomTypeSchema.index({ businessProfileId: 1, status: 1 }, { name: 'idx_room_types_business_status' });
roomTypeSchema.index({ propertyId: 1, slug: 1 }, { unique: true, sparse: true, name: 'idx_room_types_property_slug' });

export const RoomTypeModel: Model<IRoomTypeDocument> = model<IRoomTypeDocument>('RoomType', roomTypeSchema);
