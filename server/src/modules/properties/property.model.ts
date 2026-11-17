import { Schema, model, Document, Model, Types } from 'mongoose';
import {
  GEOSPATIAL_RULES,
  KERALA_DISTRICTS,
  PROPERTY_RULES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
} from '@kerala-tourism/constants';
import type {
  GeoPoint,
  KeralaDistrict,
  PropertyFacility,
  PropertyStatus,
  PropertyType,
} from '@kerala-tourism/shared-types';

export interface IPropertyDocument extends Document {
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
  // Backward compatibility getters
  ownerId?: string;
  category?: string;
  amenities?: string[];
  isVerified?: boolean;
}

const propertySchema = new Schema<IPropertyDocument>(
  {
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: [true, 'Business profile ID is required'],
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Created by account ID is required'],
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Updated by account ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Property name is required'],
      trim: true,
      minlength: [PROPERTY_RULES.MIN_NAME_LENGTH, `Property name must be at least ${PROPERTY_RULES.MIN_NAME_LENGTH} characters`],
      maxlength: [PROPERTY_RULES.MAX_NAME_LENGTH, `Property name cannot exceed ${PROPERTY_RULES.MAX_NAME_LENGTH} characters`],
    },
    slug: {
      type: String,
      required: [true, 'Property slug is required'],
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be URL-safe lowercase with hyphen separators'],
    },
    propertyType: {
      type: String,
      required: [true, 'Property type is required'],
      enum: {
        values: Object.values(PROPERTY_TYPES),
        message: 'Invalid property type: {VALUE}',
      },
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [PROPERTY_RULES.MAX_SHORT_DESCRIPTION_LENGTH, `Short description cannot exceed ${PROPERTY_RULES.MAX_SHORT_DESCRIPTION_LENGTH} characters`],
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [PROPERTY_RULES.MAX_DESCRIPTION_LENGTH, `Description cannot exceed ${PROPERTY_RULES.MAX_DESCRIPTION_LENGTH} characters`],
      default: null,
    },
    address: {
      type: String,
      required: [true, 'Property address is required'],
      trim: true,
      minlength: [5, 'Address must be at least 5 characters'],
    },
    district: {
      type: String,
      required: [true, 'District is required'],
      enum: {
        values: KERALA_DISTRICTS as unknown as string[],
        message: 'Invalid Kerala district: {VALUE}',
      },
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      required: true,
      default: 'Kerala',
      trim: true,
    },
    postalCode: {
      type: String,
      trim: true,
      default: null,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: [true, 'GeoJSON type must be Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: [true, 'Coordinates [longitude, latitude] are required'],
        validate: {
          validator: function (coords: number[]) {
            if (!Array.isArray(coords) || coords.length !== 2) return false;
            const [lng, lat] = coords;
            return (
              lng >= -180 &&
              lng <= 180 &&
              lat >= -90 &&
              lat <= 90 &&
              lng >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LONGITUDE &&
              lng <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LONGITUDE &&
              lat >= GEOSPATIAL_RULES.KERALA_BOUNDS.MIN_LATITUDE &&
              lat <= GEOSPATIAL_RULES.KERALA_BOUNDS.MAX_LATITUDE
            );
          },
          message:
            'Coordinates must be within Kerala geographic bounds (74.86 <= lng <= 77.42, 8.18 <= lat <= 12.85)',
        },
        default: [76.2711, 10.8505], // Default Kerala center
      },
    },
    contactPhone: {
      type: String,
      trim: true,
      default: null,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    website: {
      type: String,
      trim: true,
      default: null,
    },
    facilities: {
      type: [String],
      default: [],
    },
    coverMediaId: {
      type: Schema.Types.ObjectId,
      ref: 'Media',
      default: null,
    },
    galleryMediaIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Media',
      },
    ],
    status: {
      type: String,
      enum: {
        values: Object.values(PROPERTY_STATUSES),
        message: 'Invalid property status: {VALUE}',
      },
      default: PROPERTY_STATUSES.DRAFT,
      required: true,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [PROPERTY_RULES.MAX_REJECTION_REASON_LENGTH, `Rejection reason cannot exceed ${PROPERTY_RULES.MAX_REJECTION_REASON_LENGTH} characters`],
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    supportsHourly: {
      type: Boolean,
      default: false,
    },
    supportsDaily: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'properties',
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as Types.ObjectId).toString();
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
    },
  },
);

// Backward compatibility virtuals
propertySchema.virtual('ownerId').get(function (this: IPropertyDocument) {
  return this.accountId ? this.accountId.toString() : '';
});

propertySchema.virtual('category').get(function (this: IPropertyDocument) {
  return this.propertyType;
});

propertySchema.virtual('amenities').get(function (this: IPropertyDocument) {
  return this.facilities || [];
});

propertySchema.virtual('isVerified').get(function (this: IPropertyDocument) {
  return this.status === PROPERTY_STATUSES.PUBLISHED;
});

// Primary & SEO Unique Indexes
propertySchema.index({ slug: 1 }, { unique: true, name: 'idx_properties_slug' });

// Geospatial 2dsphere index for nearby discovery
propertySchema.index({ location: '2dsphere' }, { name: 'idx_properties_location_2dsphere' });

// Business Management Compound Indexes
propertySchema.index(
  { businessProfileId: 1, status: 1, createdAt: -1 },
  { name: 'idx_properties_business_status_created' },
);
propertySchema.index(
  { accountId: 1, status: 1, createdAt: -1 },
  { name: 'idx_properties_account_status_created' },
);

// Public Discovery Indexes
propertySchema.index(
  { status: 1, publishedAt: -1, _id: -1 },
  { name: 'idx_properties_public_published' },
);
propertySchema.index(
  { status: 1, district: 1, publishedAt: -1 },
  { name: 'idx_properties_public_district' },
);
propertySchema.index(
  { status: 1, propertyType: 1, publishedAt: -1 },
  { name: 'idx_properties_public_type' },
);
propertySchema.index({ facilities: 1 }, { name: 'idx_properties_facilities' });

export const PropertyModel: Model<IPropertyDocument> = model<IPropertyDocument>(
  'Property',
  propertySchema,
);
