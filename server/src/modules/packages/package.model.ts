import { Schema, model, Document, Model, Types } from 'mongoose';
import {
  PACKAGE_CATEGORIES,
  PACKAGE_PRICING_UNITS,
  PACKAGE_RULES,
  PACKAGE_STATUSES,
} from '@kerala-tourism/constants';
import type {
  PackageCategory,
  PackagePricingUnit,
  PackageStatus,
} from '@kerala-tourism/shared-types';

export interface IItineraryDaySubdocument {
  dayNumber: number;
  title: string;
  description: string;
  activities: string[];
  destinationId?: Types.ObjectId | null;
  estimatedDuration?: string | null;
}

export interface IPackageGroupPricingSubdocument {
  minPax: number;
  maxPax: number;
  pricePerPerson: number;
}

export interface ITravelPackageDocument extends Document {
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
  itinerary: IItineraryDaySubdocument[];
  durationDays: number;
  durationNights: number;
  inclusions: string[];
  exclusions: string[];
  importantInformation?: string | null;
  cancellationPolicy?: string | null;
  currency: string;
  basePrice: number;
  childPrice?: number | null;
  groupPricing?: IPackageGroupPricingSubdocument[];
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

const itineraryDaySchema = new Schema<IItineraryDaySubdocument>(
  {
    dayNumber: {
      type: Number,
      required: [true, 'Day number is required'],
      min: [1, 'Day number must be at least 1'],
      max: [PACKAGE_RULES.MAX_ITINERARY_DAYS, `Day number cannot exceed ${PACKAGE_RULES.MAX_ITINERARY_DAYS}`],
    },
    title: {
      type: String,
      required: [true, 'Itinerary title is required'],
      trim: true,
      maxlength: [120, 'Itinerary title cannot exceed 120 characters'],
    },
    description: {
      type: String,
      required: [true, 'Itinerary description is required'],
      trim: true,
      maxlength: [2000, 'Itinerary description cannot exceed 2000 characters'],
    },
    activities: [
      {
        type: String,
        trim: true,
        maxlength: [200, 'Activity cannot exceed 200 characters'],
      },
    ],
    destinationId: {
      type: Schema.Types.ObjectId,
      ref: 'Destination',
      default: null,
    },
    estimatedDuration: {
      type: String,
      trim: true,
      maxlength: [100, 'Estimated duration cannot exceed 100 characters'],
      default: null,
    },
  },
  { _id: false },
);

const groupPricingTierSchema = new Schema<IPackageGroupPricingSubdocument>(
  {
    minPax: {
      type: Number,
      required: [true, 'minPax is required'],
      min: [1, 'minPax must be at least 1'],
    },
    maxPax: {
      type: Number,
      required: [true, 'maxPax is required'],
      min: [1, 'maxPax must be at least 1'],
    },
    pricePerPerson: {
      type: Number,
      required: [true, 'pricePerPerson is required'],
      min: [1, 'pricePerPerson must be positive'],
    },
  },
  { _id: false },
);

export const travelPackageSchema = new Schema<ITravelPackageDocument>(
  {
    agencyId: {
      type: Schema.Types.ObjectId,
      ref: 'Agency',
      required: [true, 'Agency ID is required'],
      immutable: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Creator account ID is required'],
      immutable: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Updater account ID is required'],
    },
    title: {
      type: String,
      required: [true, 'Package title is required'],
      trim: true,
      minlength: [PACKAGE_RULES.MIN_TITLE_LENGTH, `Title must be at least ${PACKAGE_RULES.MIN_TITLE_LENGTH} characters`],
      maxlength: [PACKAGE_RULES.MAX_TITLE_LENGTH, `Title cannot exceed ${PACKAGE_RULES.MAX_TITLE_LENGTH} characters`],
    },
    slug: {
      type: String,
      required: [true, 'Package slug is required'],
      trim: true,
      lowercase: true,
      immutable: true,
    },
    shortDescription: {
      type: String,
      required: [true, 'Short description is required'],
      trim: true,
      maxlength: [
        PACKAGE_RULES.MAX_SHORT_DESCRIPTION_LENGTH,
        `Short description cannot exceed ${PACKAGE_RULES.MAX_SHORT_DESCRIPTION_LENGTH} characters`,
      ],
    },
    description: {
      type: String,
      required: [true, 'Package description is required'],
      trim: true,
      maxlength: [
        PACKAGE_RULES.MAX_DESCRIPTION_LENGTH,
        `Description cannot exceed ${PACKAGE_RULES.MAX_DESCRIPTION_LENGTH} characters`,
      ],
    },
    packageCategory: {
      type: String,
      enum: {
        values: Object.values(PACKAGE_CATEGORIES),
        message: 'Invalid package category: {VALUE}',
      },
      required: [true, 'Package category is required'],
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: [PACKAGE_RULES.MAX_TAG_LENGTH, `Tag cannot exceed ${PACKAGE_RULES.MAX_TAG_LENGTH} characters`],
      },
    ],
    destinationIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Destination',
      },
    ],
    startLocation: {
      type: String,
      trim: true,
      maxlength: [120, 'Start location cannot exceed 120 characters'],
      default: null,
    },
    endLocation: {
      type: String,
      trim: true,
      maxlength: [120, 'End location cannot exceed 120 characters'],
      default: null,
    },
    itinerary: [itineraryDaySchema],
    durationDays: {
      type: Number,
      required: [true, 'Duration days is required'],
      min: [PACKAGE_RULES.MIN_DAYS, `Duration days must be at least ${PACKAGE_RULES.MIN_DAYS}`],
      max: [PACKAGE_RULES.MAX_DAYS, `Duration days cannot exceed ${PACKAGE_RULES.MAX_DAYS}`],
    },
    durationNights: {
      type: Number,
      required: [true, 'Duration nights is required'],
      min: [PACKAGE_RULES.MIN_NIGHTS, `Duration nights must be at least ${PACKAGE_RULES.MIN_NIGHTS}`],
      max: [PACKAGE_RULES.MAX_NIGHTS, `Duration nights cannot exceed ${PACKAGE_RULES.MAX_NIGHTS}`],
    },
    inclusions: [
      {
        type: String,
        trim: true,
        maxlength: [200, 'Inclusion item cannot exceed 200 characters'],
      },
    ],
    exclusions: [
      {
        type: String,
        trim: true,
        maxlength: [200, 'Exclusion item cannot exceed 200 characters'],
      },
    ],
    importantInformation: {
      type: String,
      trim: true,
      maxlength: [3000, 'Important information cannot exceed 3000 characters'],
      default: null,
    },
    cancellationPolicy: {
      type: String,
      trim: true,
      maxlength: [2000, 'Cancellation policy cannot exceed 2000 characters'],
      default: null,
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      default: 'INR',
      trim: true,
    },
    basePrice: {
      type: Number,
      required: [true, 'Base price is required'],
      min: [1, 'Base price must be positive'],
    },
    childPrice: {
      type: Number,
      min: [1, 'Child price must be positive'],
      default: null,
    },
    groupPricing: [groupPricingTierSchema],
    pricingUnit: {
      type: String,
      enum: {
        values: Object.values(PACKAGE_PRICING_UNITS),
        message: 'Invalid pricing unit: {VALUE}',
      },
      default: PACKAGE_PRICING_UNITS.PER_PERSON,
    },
    maxGroupSize: {
      type: Number,
      min: [1, 'Max group size must be at least 1'],
      default: null,
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
        values: Object.values(PACKAGE_STATUSES),
        message: 'Invalid package status: {VALUE}',
      },
      default: PACKAGE_STATUSES.DRAFT,
      index: true,
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
      maxlength: [
        PACKAGE_RULES.MAX_REJECTION_REASON_LENGTH,
        `Rejection reason cannot exceed ${PACKAGE_RULES.MAX_REJECTION_REASON_LENGTH} characters`,
      ],
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'travelPackages',
  },
);

// Indexes
travelPackageSchema.index({ slug: 1 }, { unique: true, name: 'idx_packages_slug' });
travelPackageSchema.index(
  { agencyId: 1, status: 1, createdAt: -1 },
  { name: 'idx_packages_agency_status_created' },
);
travelPackageSchema.index(
  { status: 1, publishedAt: -1, _id: -1 },
  { name: 'idx_packages_public_published' },
);
travelPackageSchema.index(
  { status: 1, packageCategory: 1, publishedAt: -1 },
  { name: 'idx_packages_public_category' },
);
travelPackageSchema.index(
  { status: 1, basePrice: 1, publishedAt: -1 },
  { name: 'idx_packages_public_price' },
);
travelPackageSchema.index(
  { status: 1, durationDays: 1, publishedAt: -1 },
  { name: 'idx_packages_public_duration' },
);
travelPackageSchema.index(
  { destinationIds: 1, status: 1 },
  { name: 'idx_packages_destinations' },
);

export const TravelPackageModel: Model<ITravelPackageDocument> = model<ITravelPackageDocument>(
  'TravelPackage',
  travelPackageSchema,
);
