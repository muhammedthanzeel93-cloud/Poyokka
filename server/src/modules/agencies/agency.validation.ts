import {
  registerAgencySchema,
  updateAgencySchema,
  uploadAgencyDocumentSchema,
  agencyIdParamSchema,
  agencyDocumentIdParamSchema,
  adminAgenciesQuerySchema,
  reviewAgencySchema,
} from '@kerala-tourism/validation';

import type {
  RegisterAgencyInput,
  UpdateAgencyInput,
  UploadAgencyDocumentInput,
  AgencyIdParamInput,
  AgencyDocumentIdParamInput,
  AdminAgenciesQueryInput,
  ReviewAgencyInput,
} from '@kerala-tourism/validation';

export {
  registerAgencySchema,
  updateAgencySchema,
  uploadAgencyDocumentSchema,
  agencyIdParamSchema,
  agencyDocumentIdParamSchema,
  adminAgenciesQuerySchema,
  reviewAgencySchema,
};

export type {
  RegisterAgencyInput,
  UpdateAgencyInput,
  UploadAgencyDocumentInput,
  AgencyIdParamInput,
  AgencyDocumentIdParamInput,
  AdminAgenciesQueryInput,
  ReviewAgencyInput,
};

/**
 * Validates actual binary content (magic bytes) against the declared MIME type.
 * Prevents disguised malicious payloads or mismatched file signatures.
 */
export function validateFileSignature(buffer: Buffer, mimeType: string): boolean {
  if (!buffer || buffer.length < 4) {
    return false;
  }

  switch (mimeType.toLowerCase()) {
    case 'application/pdf':
      // PDF begins with %PDF (0x25 0x50 0x44 0x46)
      return (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
      );

    case 'image/jpeg':
    case 'image/jpg':
      // JPEG begins with 0xFF 0xD8 0xFF
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    case 'image/png':
      // PNG begins with 89 50 4E 47 0D 0A 1A 0A
      if (buffer.length < 8) return false;
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );

    case 'image/webp':
      // RIFF....WEBP (0-3: 'RIFF', 8-11: 'WEBP')
      if (buffer.length < 12) return false;
      return (
        buffer[0] === 0x52 && // R
        buffer[1] === 0x49 && // I
        buffer[2] === 0x46 && // F
        buffer[3] === 0x46 && // F
        buffer[8] === 0x57 && // W
        buffer[9] === 0x45 && // E
        buffer[10] === 0x42 && // B
        buffer[11] === 0x50 // P
      );

    default:
      return false;
  }
}
