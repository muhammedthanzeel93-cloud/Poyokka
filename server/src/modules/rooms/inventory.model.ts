import { Schema, model, Document, Model, Types } from 'mongoose';
import { ROOM_RULES } from '@kerala-tourism/constants';

export interface IRoomInventoryDocument extends Document {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  date: Date;
  totalUnits: number;
  availableUnits: number;
  blockedUnits: number;
  maintenanceUnits: number;
  createdAt: Date;
  updatedAt: Date;
}

const roomInventorySchema = new Schema<IRoomInventoryDocument>(
  {
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property ID is required'],
      index: true,
    },
    roomTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'RoomType',
      required: [true, 'Room type ID is required'],
      index: true,
    },
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: [true, 'Business profile ID is required'],
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Inventory date is required'],
      index: true,
    },
    totalUnits: {
      type: Number,
      required: [true, 'Total units is required'],
      min: [0, 'Total units cannot be negative'],
      max: [ROOM_RULES.MAX_INVENTORY_UNITS, `Total units cannot exceed ${ROOM_RULES.MAX_INVENTORY_UNITS}`],
    },
    availableUnits: {
      type: Number,
      required: [true, 'Available units is required'],
      min: [0, 'Available units cannot be negative'],
      validate: {
        validator(this: IRoomInventoryDocument, val: number): boolean {
          const blocked = this.blockedUnits || 0;
          const maint = this.maintenanceUnits || 0;
          return val + blocked + maint <= this.totalUnits;
        },
        message: 'Available units plus blocked and maintenance units cannot exceed total units',
      },
    },
    blockedUnits: {
      type: Number,
      default: 0,
      min: [0, 'Blocked units cannot be negative'],
    },
    maintenanceUnits: {
      type: Number,
      default: 0,
      min: [0, 'Maintenance units cannot be negative'],
    },
  },
  {
    timestamps: true,
    collection: 'roomInventory',
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

// Indexes
roomInventorySchema.index({ roomTypeId: 1, date: 1 }, { unique: true, name: 'idx_room_inventory_room_date' });
roomInventorySchema.index({ propertyId: 1, date: 1 }, { name: 'idx_room_inventory_property_date' });
roomInventorySchema.index({ businessProfileId: 1, date: 1 }, { name: 'idx_room_inventory_business_date' });
roomInventorySchema.index({ roomTypeId: 1, date: 1, availableUnits: 1 }, { name: 'idx_room_inventory_lookup' });

export const RoomInventoryModel: Model<IRoomInventoryDocument> = model<IRoomInventoryDocument>(
  'RoomInventory',
  roomInventorySchema,
);
