# Property & Accommodation Management Security Architecture

This document details the defensive controls, authorization boundaries, and data integrity guarantees implemented in the Property Management domain.

---

## 1. Identity & Resource Ownership Protection

### 1.1 Strict Server-Side Derivation
Client requests can never supply `accountId`, `businessProfileId`, `createdBy`, or `status` in the request body. Ownership fields are strictly populated server-side from `req.user.id`. Any attempted injection is rejected via Zod `.strict()`.

### 1.2 BOLA / IDOR 404 Concealment Defense
When a business attempts to inspect (`GET /:id`), update (`PATCH /:id`), delete (`DELETE /:id`), or submit (`POST /:id/submit-review`) a property belonging to another business, the server responds with:
```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Property not found"
  }
}
```
Returning HTTP 404 rather than HTTP 403 prevents attackers from determining whether specific ObjectId identifiers exist in the system (resource enumeration defense).

---

## 2. Media Attachment & Vault Security

### 2.1 Media Ownership Validation
Before attaching `coverMediaId` or `galleryMediaIds` to a property, the service verifies that:
1. The media document exists in MongoDB (`MediaModel.findById`).
2. `media.uploaderAccountId.toString() === req.user.id` (strictly owned by the authenticated business).
3. The media is public property media and not a private verification document from the agency or business KYC vault.
4. Gallery media IDs contain zero duplicate references.

### 2.2 Storage Key Concealment
Internal storage keys (e.g. S3/MinIO bucket keys) are strictly stripped in public API projections and DTO mappers. Only public access URLs are provided to tourists.

---

## 3. Geospatial Query Defense

### 3.1 Strict Coordinate Range & Kerala Bounds Validation
GeoJSON coordinates `[longitude, latitude]` are validated:
- Longitude: -180 to 180 (and within Kerala bounds: $74.86 \le \text{lng} \le 77.42$)
- Latitude: -90 to 90 (and within Kerala bounds: $8.18 \le \text{lat} \le 12.85$)
Coordinates outside Kerala bounds fail request validation (`400 VALIDATION_ERROR`).

### 3.2 Maximum Radius Caps
Radius search (`GET /api/v1/properties/nearby`) enforces an upper limit of 100km (`PROPERTY_RULES.MAX_RADIUS_KM`). Unbounded geospatial queries that would degrade database index performance are rejected.

---

## 4. Multi-Document ACID Transactions & State Machine Guards

### 4.1 Finite State Machine
- `DRAFT` $\rightarrow$ `PENDING_REVIEW`
- `PENDING_REVIEW` $\rightarrow$ `PUBLISHED` | `REJECTED`
- `REJECTED` $\rightarrow$ `DRAFT` | `PENDING_REVIEW`
- `PUBLISHED` $\rightarrow$ `ARCHIVED`

No direct client transitions from `DRAFT` to `PUBLISHED` are permitted. Any client attempt to send `status` in `PATCH /:id` is rejected. Once `PUBLISHED`, properties cannot be modified by business accounts.

### 4.2 ACID Transactions with Jittered Retries
Admin approvals and rejections update the property status and record immutable audit logs inside an atomic MongoDB session. If a write conflict (`TransientTransactionError` / code 112) occurs, the repository retries with exponential backoff and jitter up to 8 times before failing closed.
