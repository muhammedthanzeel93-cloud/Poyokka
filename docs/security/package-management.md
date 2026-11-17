# Security Architecture: Travel Packages & Package Management

## 1. Threat Model & Vulnerability Analysis

The Travel Packages system operates in a multi-tenant marketplace where commercial entities (Travel Agencies) publish high-value tourism offerings. A compromised package management system could expose private agency data, allow unauthorized package hijacking, enable malicious price manipulation, or overwhelm discovery endpoints with denial-of-service payloads.

| Threat Category | Potential Attack Vector | Defense Mechanism Implemented |
|---|---|---|
| **BOLA / IDOR** | Agency A crafts `PATCH /api/v1/business/packages/:id` with Agency B's package ID | Agency ownership is strictly asserted against caller's authenticated `AgencyModel`; unauthorized attempts are concealed with `404 RESOURCE_NOT_FOUND`. |
| **Privilege Escalation** | Agency passes `status: "PUBLISHED"` or `agencyId` in `POST /packages` body | Strict Zod schema validation strips client ownership/status fields; status is defaulted to `DRAFT` and ownership is anchored to `req.user.id`. |
| **Commercial Gate Bypass** | Unverified business or tourist attempts package creation | Dual-check via `requireVerifiedBusiness` middleware and authoritative database check on `AgencyModel.verificationStatus === 'VERIFIED'`. |
| **State Desynchronization** | Concurrent administrative review approvals or rejections | Conditional atomic transitions executed inside multi-document MongoDB ACID replica-set transactions with transient retry backoff. |
| **Unpublished Data Leakage** | Client requests draft, rejected, or suspended agency package | Public aggregation pipeline and slug lookup enforce `status === 'PUBLISHED'`, agency `verificationStatus === 'VERIFIED'`, and account `status === 'ACTIVE'`. |
| **ReDoS in Search** | Attacker sends malicious regex patterns in `GET /packages/search?q=...` | Keyword search input is escaped via `escapeRegex()` before regex compilation, or executed via covered index stages. |
| **Media Spoofing** | Attacker specifies another user's private media as package cover | System validates that all `coverMediaId` and `galleryMediaIds` have `uploaderAccountId === req.user.id`. |
| **Mutation Flooding** | Attacker scripts automated bursts of package creations/edits | Throttled by dedicated `packageMutationRateLimiter` (40 requests / 15 minutes per account/IP). |

---

## 2. Agency Ownership & BOLA / IDOR Invariants

### 2.1 Authoritative Identity Derivation
In accordance with the **Split-Identity Paradigm**, package ownership is never accepted from the HTTP request body:
```typescript
// SECURE: Ownership is strictly derived from the authenticated principal
const userObjId = new Types.ObjectId(req.user.id);
const agency = await this.assertVerifiedAgency(userObjId);

const persistenceInput: CreatePackagePersistenceInput = {
  agencyId: agency._id,
  createdBy: userObjId,
  updatedBy: userObjId,
  // ...
};
```

### 2.2 404 Concealment Defense
When an authenticated agency attempts to access or modify a package belonging to another business, the application emits `404 RESOURCE_NOT_FOUND` rather than `403 FORBIDDEN`. This completely prevents resource enumeration attacks and ensures an attacker cannot determine whether a given ObjectId exists.

---

## 3. Package State Machine & Lifecycle Guarding

Travel packages follow a finite state machine:

```
[ DRAFT ] <-------------------+
    |                         |
    | submit-review           |
    v                         |
[ PENDING_REVIEW ]            |
    |          \              |
    | APPROVE   \ REJECT      |
    v            v            |
[ PUBLISHED ]  [ REJECTED ] --+ (edit & resubmit)
    |
    | (archive)
    v
[ ARCHIVED ] (terminal state)
```

- **Mutation Restriction**: Packages in `PENDING_REVIEW` or `PUBLISHED` cannot be modified directly via `PATCH /packages/:packageId`. Doing so triggers `400 PACKAGE_NOT_MODIFIABLE`.
- **Review Pre-conditions**: A package can only transition from `DRAFT`/`REJECTED` to `PENDING_REVIEW` if it satisfies completeness requirements (description >= 20 chars, itinerary >= 1 day).
- **Admin Review Invariants**: Only administrators with `MODERATE_PACKAGES` can approve or reject packages. Rejection requires a mandatory reason (min 5 characters) that is recorded in both the package document and the immutable audit log.

---

## 4. Multi-Document ACID Transactions & Audit Integrity

Administrative reviews execute inside a MongoDB WiredTiger replica-set transaction runner:
1. Validates that the package exists and that the owning agency is currently `VERIFIED`. If the agency has been suspended or revoked, approval is aborted with `400 AGENCY_NOT_VERIFIED`.
2. Updates `TravelPackageModel.status` to `PUBLISHED` or `REJECTED`.
3. Appends an immutable audit record to `auditLogs` collection via `AuditLogService`.

If any step in the transaction fails, all changes are rolled back automatically, preventing orphaned published packages or unrecorded administrative actions.
