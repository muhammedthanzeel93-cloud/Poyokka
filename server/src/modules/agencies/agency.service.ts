import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  ADMIN_AUDIT_ACTIONS,
  AUDIT_TARGET_ENTITY_TYPES,
  BUSINESS_TYPES,
  VERIFICATION_STATUSES,
  AGENCY_DOCUMENT_RULES,
} from '@kerala-tourism/constants';
import type {
  AdminAuditAction,
  AdminLevel,
  AgencyDto,
  AgencyDocumentDto,
  AgencyDocumentType,
  AgencyListResponseDto,
  AgencyReviewResponseDto,
} from '@kerala-tourism/shared-types';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../shared/errors/AppError';
import { AuditLogService, auditLogService } from '../admin/audit-log.service';
import { AgencyRepository, agencyRepository } from './agency.repository';
import { AgencyLean, AgencyDocumentLean } from './agency.types';
import {
  RegisterAgencyInput,
  UpdateAgencyInput,
  UploadAgencyDocumentInput,
  AdminAgenciesQueryInput,
  ReviewAgencyInput,
  validateFileSignature,
} from './agency.validation';

export const mapAgencyDocumentToDto = (
  doc: AgencyDocumentLean | { _id: Types.ObjectId | string; documentType: string; originalFileName: string; fileSize: number; mimeType: string; uploadedAt: Date },
): AgencyDocumentDto => {
  return {
    id: doc._id.toString(),
    documentType: doc.documentType as AgencyDocumentType,
    originalFileName: doc.originalFileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    uploadedAt:
      doc.uploadedAt instanceof Date
        ? doc.uploadedAt.toISOString()
        : new Date(doc.uploadedAt).toISOString(),
  };
};

export const mapAgencyToDto = (agency: AgencyLean): AgencyDto => {
  const documents = (agency.documents || []).map(mapAgencyDocumentToDto);
  return {
    id: agency._id.toString(),
    accountId: agency.accountId.toString(),
    businessProfileId: agency.businessProfileId.toString(),
    agencyName: agency.agencyName,
    registrationNumber: agency.registrationNumber,
    businessCategory: agency.businessCategory,
    description: agency.description,
    contactEmail: agency.contactEmail,
    contactPhone: agency.contactPhone,
    website: agency.website ?? null,
    address: agency.address,
    district: agency.district,
    state: agency.state || 'Kerala',
    pinCode: agency.pinCode,
    logoMediaId: agency.logoMediaId ? agency.logoMediaId.toString() : null,
    verificationStatus: agency.verificationStatus,
    reviewedBy: agency.reviewedBy ? agency.reviewedBy.toString() : null,
    reviewedAt: agency.reviewedAt
      ? (agency.reviewedAt instanceof Date
          ? agency.reviewedAt.toISOString()
          : new Date(agency.reviewedAt).toISOString())
      : null,
    verifiedAt: agency.verifiedAt
      ? (agency.verifiedAt instanceof Date
          ? agency.verifiedAt.toISOString()
          : new Date(agency.verifiedAt).toISOString())
      : null,
    rejectionReason: agency.rejectionReason ?? null,
    documents,
    documentsCount: documents.length,
    createdAt:
      agency.createdAt instanceof Date
        ? agency.createdAt.toISOString()
        : new Date(agency.createdAt).toISOString(),
    updatedAt:
      agency.updatedAt instanceof Date
        ? agency.updatedAt.toISOString()
        : new Date(agency.updatedAt).toISOString(),
  };
};

export class AgencyService {
  constructor(
    private repository: AgencyRepository = agencyRepository,
    private auditService: AuditLogService = auditLogService,
  ) {}

  public setAuditService(service: AuditLogService): void {
    this.auditService = service;
  }

  public setRepository(repo: AgencyRepository): void {
    this.repository = repo;
  }

  public async registerAgency(
    accountId: string,
    input: RegisterAgencyInput,
    _ipAddress?: string,
    _userAgent?: string,
  ): Promise<AgencyDto> {
    const accountObjectId = new Types.ObjectId(accountId);

    // 1. Verify business profile and eligibility
    const businessProfile = await this.repository.findBusinessProfileByAccountId(accountObjectId);
    if (!businessProfile) {
      throw new NotFoundError(
        'Business profile not found for this account. Create a business profile first.',
        'BUSINESS_PROFILE_NOT_FOUND',
      );
    }

    if (businessProfile.businessType !== BUSINESS_TYPES.TRAVEL_AGENCY) {
      throw new BadRequestError(
        `Only accounts with businessType ${BUSINESS_TYPES.TRAVEL_AGENCY} can register a travel agency profile`,
        'INELIGIBLE_BUSINESS_TYPE',
      );
    }

    // 2. Prevent duplicate agency profiles for the same account
    const existingAgency = await this.repository.findAgencyByAccountId(accountObjectId);
    if (existingAgency) {
      throw new ConflictError(
        'A travel agency profile already exists for this business account',
        'AGENCY_ALREADY_EXISTS',
      );
    }

    // 3. Prevent duplicate registration numbers across the platform
    const existingByRegNo = await this.repository.findAgencyByRegistrationNumber(
      input.registrationNumber,
    );
    if (existingByRegNo) {
      throw new ConflictError(
        'A travel agency with this registration number already exists',
        'REGISTRATION_NUMBER_EXISTS',
      );
    }

    // 4. Create agency record
    const createdAgency = await this.repository.withTransaction(async (session) => {
      return this.repository.createAgency(
        {
          accountId: accountObjectId,
          businessProfileId: (businessProfile as { _id: Types.ObjectId })._id,
          agencyName: input.agencyName,
          registrationNumber: input.registrationNumber,
          businessCategory: input.businessCategory,
          description: input.description,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          website: input.website ?? null,
          address: input.address,
          district: input.district,
          state: input.state || 'Kerala',
          pinCode: input.pinCode,
          logoMediaId: input.logoMediaId ? new Types.ObjectId(input.logoMediaId) : null,
        },
        session,
      );
    });

    return mapAgencyToDto(createdAgency);
  }

  public async getOwnAgency(accountId: string): Promise<AgencyDto> {
    const agency = await this.repository.findAgencyByAccountId(accountId);
    if (!agency) {
      throw new NotFoundError(
        'Travel agency profile not found for this business account',
        'AGENCY_NOT_FOUND',
      );
    }
    return mapAgencyToDto(agency);
  }

  public async updateOwnAgency(
    accountId: string,
    input: UpdateAgencyInput,
    _ipAddress?: string,
    _userAgent?: string,
  ): Promise<AgencyDto> {
    const agency = await this.repository.findAgencyByAccountId(accountId);
    if (!agency) {
      throw new NotFoundError(
        'Travel agency profile not found for this business account',
        'AGENCY_NOT_FOUND',
      );
    }

    const updated = await this.repository.updateAgency(agency._id, {
      ...input,
      logoMediaId: input.logoMediaId ? new Types.ObjectId(input.logoMediaId) : (input.logoMediaId === null ? null : undefined),
    });
    if (!updated) {
      throw new NotFoundError('Agency not found', 'AGENCY_NOT_FOUND');
    }

    return mapAgencyToDto(updated);
  }

  public async uploadDocument(
    accountId: string,
    input: UploadAgencyDocumentInput,
    _ipAddress?: string,
    _userAgent?: string,
  ): Promise<AgencyDocumentDto> {
    const agency = await this.repository.findAgencyByAccountId(accountId);
    if (!agency) {
      throw new NotFoundError(
        'Travel agency profile not found for this business account',
        'AGENCY_NOT_FOUND',
      );
    }

    // 1. Check max documents limit
    if ((agency.documents || []).length >= AGENCY_DOCUMENT_RULES.MAX_DOCUMENTS_PER_AGENCY) {
      throw new BadRequestError(
        `Maximum document limit of ${AGENCY_DOCUMENT_RULES.MAX_DOCUMENTS_PER_AGENCY} documents reached`,
        'MAX_DOCUMENTS_REACHED',
      );
    }

    // 2. Validate file size
    if (input.fileSize > AGENCY_DOCUMENT_RULES.MAX_FILE_SIZE_BYTES) {
      throw new BadRequestError(
        'Document file size exceeds the 5MB limit',
        'FILE_TOO_LARGE',
      );
    }

    let actualFileSize = input.fileSize;

    // 3. Decode base64 and validate file signature if fileData is present
    if (input.fileData) {
      let fileBuffer: Buffer;
      try {
        fileBuffer = Buffer.from(input.fileData, 'base64');
      } catch {
        throw new BadRequestError('Invalid base64 document payload', 'INVALID_FILE_DATA');
      }

      if (fileBuffer.length === 0) {
        throw new BadRequestError('Document file cannot be empty', 'EMPTY_FILE');
      }

      if (fileBuffer.length > AGENCY_DOCUMENT_RULES.MAX_FILE_SIZE_BYTES) {
        throw new BadRequestError(
          'Document file size exceeds the 5MB limit',
          'FILE_TOO_LARGE',
        );
      }

      actualFileSize = fileBuffer.length;

      // Validate binary magic bytes against declared MIME type
      const isSignatureValid = validateFileSignature(fileBuffer, input.mimeType);
      if (!isSignatureValid) {
        throw new BadRequestError(
          'File binary content does not match the declared MIME type',
          'INVALID_FILE_SIGNATURE',
        );
      }
    }

    // 4. Generate secure vault storage key (never exposed in client DTOs)
    const storageKey = `vault/agencies/${agency._id.toString()}/${crypto.randomUUID()}`;

    // 5. Atomically persist document reference to Agency and mirror to BusinessProfile
    const updatedAgency = await this.repository.withTransaction(async (session) => {
      const updated = await this.repository.addAgencyDocument(
        agency._id,
        {
          documentType: input.documentType,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          fileSize: actualFileSize,
          storageKey,
        },
        session,
      );

      await this.repository.syncBusinessProfileDocument(
        agency.accountId,
        {
          documentType: input.documentType,
          storageKey,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          fileSize: actualFileSize,
          uploadedAt: new Date(),
        },
        session,
      );

      return updated;
    });

    if (!updatedAgency || !updatedAgency.documents || updatedAgency.documents.length === 0) {
      throw new NotFoundError('Failed to record document', 'DOCUMENT_UPLOAD_FAILED');
    }

    const newDoc = updatedAgency.documents[updatedAgency.documents.length - 1];
    return mapAgencyDocumentToDto(newDoc);
  }

  public async deleteDocument(
    accountId: string,
    documentId: string,
    _ipAddress?: string,
    _userAgent?: string,
  ): Promise<{ success: boolean; message: string }> {
    const agency = await this.repository.findAgencyByAccountId(accountId);
    if (!agency) {
      throw new NotFoundError(
        'Travel agency profile not found for this business account',
        'AGENCY_NOT_FOUND',
      );
    }

    // Find document inside agency
    const docToDelete = (agency.documents || []).find(
      (d) => d._id.toString() === documentId,
    );
    if (!docToDelete) {
      throw new NotFoundError(
        'Document not found on this agency profile',
        'DOCUMENT_NOT_FOUND',
      );
    }

    // Remove atomically from Agency and BusinessProfile
    await this.repository.withTransaction(async (session) => {
      await this.repository.removeAgencyDocument(agency._id, documentId, session);
      await this.repository.removeBusinessProfileDocumentByStorageKey(
        agency.accountId,
        docToDelete.storageKey,
        session,
      );
    });

    return {
      success: true,
      message: 'Agency document removed successfully',
    };
  }

  public async listAgenciesForAdmin(
    filters: AdminAgenciesQueryInput,
  ): Promise<AgencyListResponseDto> {
    const result = await this.repository.findAgenciesPaginated(filters);
    return {
      items: result.items.map(mapAgencyToDto),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  public async getAgencyDetailsForAdmin(agencyId: string): Promise<AgencyDto> {
    const agency = await this.repository.findAgencyById(agencyId);
    if (!agency) {
      throw new NotFoundError('Travel agency not found', 'AGENCY_NOT_FOUND');
    }
    return mapAgencyToDto(agency);
  }

  public async reviewAgency(
    agencyId: string,
    reviewerAccountId: string,
    reviewerAdminLevel: AdminLevel,
    input: ReviewAgencyInput,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AgencyReviewResponseDto> {
    const agency = await this.repository.findAgencyById(agencyId);
    if (!agency) {
      throw new NotFoundError('Travel agency not found', 'AGENCY_NOT_FOUND');
    }

    // Prevent redundant transitions to the same status
    if (agency.verificationStatus === input.status) {
      throw new BadRequestError(
        `Agency is already in ${input.status} status`,
        'INVALID_STATUS_TRANSITION',
      );
    }

    // Rejection requires a non-empty explanation
    if (input.status === VERIFICATION_STATUSES.REJECTED && !input.rejectionReason?.trim()) {
      throw new BadRequestError(
        'Rejection reason is mandatory when rejecting an agency application',
        'REJECTION_REASON_REQUIRED',
      );
    }

    const now = new Date();
    const verifiedAt = input.status === VERIFICATION_STATUSES.VERIFIED ? now : null;
    const rejectionReason =
      input.status === VERIFICATION_STATUSES.REJECTED ? input.rejectionReason!.trim() : null;

    let auditAction: AdminAuditAction = ADMIN_AUDIT_ACTIONS.AGENCY_VERIFICATION_STATUS_UPDATED;
    if (input.status === VERIFICATION_STATUSES.VERIFIED) {
      auditAction = ADMIN_AUDIT_ACTIONS.AGENCY_APPROVED;
    } else if (input.status === VERIFICATION_STATUSES.REJECTED) {
      auditAction = ADMIN_AUDIT_ACTIONS.AGENCY_REJECTED;
    } else if (input.status === VERIFICATION_STATUSES.UNDER_REVIEW) {
      auditAction = ADMIN_AUDIT_ACTIONS.AGENCY_UNDER_REVIEW;
    }

    // Atomic execution inside ACID transaction
    const { updatedAgency, auditLog } = await this.repository.withTransaction(async (session) => {
      // 1. Transition agency status conditionally
      const updated = await this.repository.transitionAgencyVerificationStatusAtomic(
        agency._id,
        [agency.verificationStatus],
        input.status,
        {
          verifiedAt,
          reviewedAt: now,
          rejectionReason,
          reviewedBy: new Types.ObjectId(reviewerAccountId),
        },
        session,
      );

      if (!updated) {
        throw new ConflictError(
          'Agency verification status was concurrently modified by another moderator',
          'CONCURRENT_MODIFICATION',
        );
      }

      // 2. Synchronize BusinessProfile verification status atomically
      await this.repository.syncBusinessProfileVerificationStatus(
        agency.accountId,
        input.status,
        session,
      );

      // 3. Record immutable audit log
      const logged = await this.auditService.recordAdminAction(
        {
          actorAccountId: reviewerAccountId,
          actorAccountType: 'ADMIN',
          actorAdminLevel: reviewerAdminLevel,
          action: auditAction,
          targetEntityId: agency._id,
          targetEntityType: AUDIT_TARGET_ENTITY_TYPES.AGENCY,
          reason:
            input.rejectionReason ||
            `Agency verification status updated to ${input.status}`,
          beforeState: {
            verificationStatus: agency.verificationStatus,
            verifiedAt: agency.verifiedAt,
            reviewedAt: agency.reviewedAt,
          },
          afterState: {
            verificationStatus: input.status,
            verifiedAt,
            reviewedAt: now,
            rejectionReason,
          },
          ipAddress,
          userAgent,
        },
        session,
      );

      return { updatedAgency: updated, auditLog: logged };
    });

    return {
      agency: mapAgencyToDto(updatedAgency),
      auditLog,
    };
  }
}

export const agencyService = new AgencyService();
