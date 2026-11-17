import type { ClientSession, Types } from 'mongoose';
import type {
  AgencyCategory,
  AgencyDocumentType,
  KeralaDistrict,
  VerificationStatus,
} from '@kerala-tourism/shared-types';

export interface AgencyRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AgencyDocumentLean {
  _id: Types.ObjectId;
  documentType: AgencyDocumentType;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  uploadedAt: Date;
}

export interface AgencyLean {
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
  documents: AgencyDocumentLean[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgencyPersistenceInput {
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
}

export interface UpdateAgencyPersistenceInput {
  agencyName?: string;
  businessCategory?: AgencyCategory;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string | null;
  address?: string;
  district?: KeralaDistrict;
  state?: string;
  pinCode?: string;
  logoMediaId?: Types.ObjectId | null;
}

export interface AddAgencyDocumentInput {
  documentType: AgencyDocumentType;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
}

export interface PaginatedAgenciesResult {
  items: AgencyLean[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AgencyTransitionParams {
  agencyId: string;
  expectedStatus: VerificationStatus;
  nextStatus: VerificationStatus;
  reviewedBy: Types.ObjectId;
  reviewedAt: Date;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  session?: ClientSession;
}
