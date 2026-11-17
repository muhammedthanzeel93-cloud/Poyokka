# Business Verification & Agency Security Architecture (Day 19)

---

## 1. Split-Identity Architecture & BOLA Defense

- **Strict Identity Anchoring**: All business-facing routes (`POST /api/v1/business/agency`, `GET`, `PATCH`, `POST /documents`, `DELETE /documents/:documentId`) derive the account identity strictly from authenticated JWT context (`req.user.id`).
- **No Client Account Injection**: `accountId`, `businessProfileId`, and `verificationStatus` cannot be modified by user payloads. Zod validation schemas (`registerAgencySchema`, `updateAgencySchema`) enforce `.strict()`, rejecting any foreign or elevated fields.
- **BOLA / IDOR Prevention**: Document deletion verifies that the requested `documentId` actually exists as a subdocument belonging to the caller's own agency. Attempts to delete another agency's document return `404 DOCUMENT_NOT_FOUND` without leaking the existence of other records.

---

## 2. Compliance Document Vault Security & Magic Byte Validation

- **No Public URLs**: Document references must be stored as private vault storage keys (e.g. `vault/agencies/:agencyId/:uuid`). The Mongoose schema explicitly validates that `storageKey` never starts with `http://` or `https://`.
- **Zero Information Leakage in DTOs**: Internal `storageKey` vault paths are strictly omitted from all public and administrative API responses (`AgencyDto`, `AgencyDocumentDto`).
- **Binary Signature (Magic Byte) Validation**: Declared MIME types and file extensions are never trusted on their own. Binary contents are decoded and inspected for authentic magic bytes:
  - `application/pdf`: `%PDF` (`0x25 0x50 0x44 0x46`)
  - `image/jpeg`: `0xFF 0xD8 0xFF`
  - `image/png`: `\x89PNG\r\n\x1a\n` (`0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`)
  - `image/webp`: `RIFF....WEBP` (`0x52 0x49 0x46 0x46` at bytes 0-3, `0x57 0x45 0x42 0x50` at bytes 8-11)
- **Size & Count Guardrails**: Files are constrained to a maximum of 5MB (`5,242,880 bytes`). Agencies are capped at a maximum of 10 compliance documents to prevent denial-of-service and storage exhaustion.

---

## 3. Dual-Collection Atomic State Synchronization

- **Zero-Drift Invariant**: The platform uses both `AgencyModel` (for agency-specific domain information) and `BusinessProfileModel` (for global merchant operations). When an admin reviews and approves or rejects an agency, both `Agency.verificationStatus` and `BusinessProfile.verificationStatus` are updated atomically inside a MongoDB ACID transaction.
- **Fail-Closed in Production**: `AgencyRepository.withTransaction` enforces that in `production`, all mutations require a MongoDB replica set transaction topology. Any topology failure immediately rolls back without corrupting state or leaving dangling documents.
- **Race Condition Immunity**: Concurrency conflicts are handled via conditional `findOneAndUpdate` queries ensuring only the expected current status can be transitioned, preventing double-reviews or split-brain status updates.

---

## 4. RBAC & Administrative Governance

- **Granular Permissions**:
  - `VIEW_AGENCIES`: Allows reading agency profiles and compliance document metadata.
  - `VERIFY_AGENCIES`: Required to approve, reject, or place an agency under review.
- **Immutable Audit Logging**: Every state transition (`AGENCY_APPROVED`, `AGENCY_REJECTED`, `AGENCY_UNDER_REVIEW`, `AGENCY_VERIFICATION_STATUS_UPDATED`) records an immutable `AuditLog` entry detailing:
  - `actorAccountId` & `actorAdminLevel`
  - `beforeState` & `afterState`
  - `reason` (mandatory for `REJECTED`)
  - `ipAddress` & `userAgent`
- **Commercial Operations Gating**: Unverified agencies cannot publish tour packages or manage commercial listings; commercial routes enforce `requireVerifiedBusiness` which checks `businessProfile.verificationStatus === 'VERIFIED'`.
