import { Schema, model, Document, Model, Types } from 'mongoose';
import {
  AGENCY_CATEGORIES,
  AGENCY_DOCUMENT_TYPES,
  KERALA_DISTRICTS,
  VERIFICATION_STATUSES,
} from '@kerala-tourism/constants';
import type {
  AgencyCategory,
  AgencyDocumentType,
  KeralaDistrict,
  VerificationStatus,
} from '@kerala-tourism/shared-types';

export interface IAgencyDocumentSubdocument {
  _id: Types.ObjectId;
  documentType: AgencyDocumentType;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  uploadedAt: Date;
}

export interface IAgencyDocument extends Document {
  _id: Types.ObjectId;
  accountId: Types.ObjectId;
  businessProfileId: Types.ObjectId;
  agencyName: string;
  registrationNumber: string;
  businessCategory: AgencyCategory;
  description: string;
  contactEmail: string;
  contactPhone: string;
  website?: string | null;
  address: string;
  district: KeralaDistrict;
  state: string;
  pinCode: string;
  logoMediaId?: Types.ObjectId | null;
  verificationStatus: VerificationStatus;
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  documents: IAgencyDocumentSubdocument[];
  createdAt: Date;
  updatedAt: Date;
}

const agencyDocumentSchema = new Schema<IAgencyDocumentSubdocument>(
  {
    documentType: {
      type: String,
      enum: {
        values: Object.values(AGENCY_DOCUMENT_TYPES),
        message: 'Invalid agency document type: {VALUE}',
      },
      required: [true, 'Document type is required'],
    },
    originalFileName: {
      type: String,
      required: [true, 'Original file name is required'],
      trim: true,
      maxlength: [255, 'File name cannot exceed 255 characters'],
    },
    fileSize: {
      type: Number,
      required: [true, 'File size is required'],
      min: [1, 'File size must be greater than 0 bytes'],
    },
    mimeType: {
      type: String,
      required: [true, 'MIME type is required'],
      trim: true,
    },
    storageKey: {
      type: String,
      required: [true, 'Storage key reference is required'],
      trim: true,
      validate: {
        validator: (v: string) => !v.startsWith('http://') && !v.startsWith('https://'),
        message: 'Documents must be stored as secure vault storage keys, not public URLs',
      },
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

export const agencySchema = new Schema<IAgencyDocument>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Business account ID is required'],
      immutable: true,
    },
    businessProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: [true, 'Business profile ID is required'],
      immutable: true,
    },
    agencyName: {
      type: String,
      required: [true, 'Agency name is required'],
      trim: true,
      minlength: [2, 'Agency name must be at least 2 characters'],
      maxlength: [100, 'Agency name cannot exceed 100 characters'],
    },
    registrationNumber: {
      type: String,
      required: [true, 'Registration number is required'],
      trim: true,
      uppercase: true,
      minlength: [3, 'Registration number must be at least 3 characters'],
      maxlength: [50, 'Registration number cannot exceed 50 characters'],
    },
    businessCategory: {
      type: String,
      enum: {
        values: Object.values(AGENCY_CATEGORIES),
        message: 'Invalid agency business category: {VALUE}',
      },
      required: [true, 'Business category is required'],
    },
    description: {
      type: String,
      required: [true, 'Agency description is required'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters'],
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    contactEmail: {
      type: String,
      required: [true, 'Contact email is required'],
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
      trim: true,
    },
    website: {
      type: String,
      trim: true,
      default: null,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
      minlength: [5, 'Address must be at least 5 characters'],
      maxlength: [300, 'Address cannot exceed 300 characters'],
    },
    district: {
      type: String,
      enum: {
        values: KERALA_DISTRICTS,
        message: 'Invalid Kerala district: {VALUE}',
      },
      required: [true, 'District is required'],
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      default: 'Kerala',
    },
    pinCode: {
      type: String,
      required: [true, 'PIN code is required'],
      trim: true,
    },
    logoMediaId: {
      type: Schema.Types.ObjectId,
      ref: 'Media',
      default: null,
    },
    verificationStatus: {
      type: String,
      enum: {
        values: Object.values(VERIFICATION_STATUSES),
        message: 'Invalid verification status: {VALUE}',
      },
      default: VERIFICATION_STATUSES.PENDING,
      required: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [1000, 'Rejection reason cannot exceed 1000 characters'],
      default: null,
    },
    documents: {
      type: [agencyDocumentSchema],
      default: () => [],
    },
  },
  {
    collection: 'agencies',
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        if (ret['_id']) {
          ret['id'] = String(ret['_id']);
        }
        delete ret['__v'];
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret['__v'];
        return ret;
      },
    },
  },
);

// Enforce one agency profile per business account
agencySchema.index({ accountId: 1 }, { unique: true });

// Enforce uniqueness of registration number
agencySchema.index({ registrationNumber: 1 }, { unique: true });

// Admin verification status triage queries (sorted newest-first)
agencySchema.index(
  { verificationStatus: 1, createdAt: -1, _id: -1 },
  { name: 'idx_agencies_status_created' },
);

// District-filtered verification queries
agencySchema.index(
  { district: 1, verificationStatus: 1 },
  { name: 'idx_agencies_district_status' },
);

// Chronological sorting index
agencySchema.index(
  { createdAt: -1, _id: -1 },
  { name: 'idx_agencies_created' },
);

export const AgencyModel: Model<IAgencyDocument> = model<IAgencyDocument>('Agency', agencySchema);
