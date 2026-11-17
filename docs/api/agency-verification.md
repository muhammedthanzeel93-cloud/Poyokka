# Admin Travel Agency Verification & Management API Specification (Day 19)

The Admin Travel Agency module equips platform administrators with tools to inspect registered travel agencies, review compliance documentation, and transition verification states with dual-collection atomic synchronization.

---

## Base Path & Security Pre-requisites

- **Base Path**: `/api/v1/admin/agencies`
- **Security Chain**:
  1. `authenticate` (Valid Bearer JWT access token)
  2. `requireActiveAccount` (Admin account must be active)
  3. `requireAccountType('ADMIN')` (Only admins)
  4. Granular Permission Checks:
     - `requirePermission('VIEW_AGENCIES')` for listing and inspection
     - `requirePermission('VERIFY_AGENCIES')` for status transitions

---

## Endpoints Summary

| Method | Endpoint | Description | Rate Limit | Permissions |
|---|---|---|---|---|
| `GET` | `/api/v1/admin/agencies` | List agencies with filtering and pagination | Standard | `VIEW_AGENCIES` |
| `GET` | `/api/v1/admin/agencies/:agencyId` | Inspect detailed agency profile | Standard | `VIEW_AGENCIES` |
| `PATCH` | `/api/v1/admin/agencies/:agencyId/review` | Transition agency verification status | 30 req / 15 min | `VERIFY_AGENCIES` |

---

## 1. List Travel Agencies

Retrieves a paginated list of agencies with optional filtering by status, district, and ReDoS-safe search query.

- **Method**: `GET`
- **URL**: `/api/v1/admin/agencies`
- **Permission**: `VIEW_AGENCIES`

### Query Parameters
- `verificationStatus` (*optional*): `PENDING` | `UNDER_REVIEW` | `VERIFIED` | `REJECTED`
- `district` (*optional*): Kerala district name (e.g. `Ernakulam`, `Wayanad`)
- `search` (*optional*): String query searching `agencyName`, `registrationNumber`, `contactEmail`, and `contactPhone` (escaped for ReDoS protection)
- `page` (*optional*, default: `1`, max: `10000`)
- `limit` (*optional*, default: `20`, max: `50`)

### Response `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "673456789abcdef012345678",
      "accountId": "65a123456789abcdef012345",
      "businessProfileId": "65a987654321fedcba098765",
      "agencyName": "Kerala Backwaters & Hills Travel",
      "registrationNumber": "KL-TOUR-2026-9872",
      "businessCategory": "TOUR_OPERATOR",
      "description": "Premier inbound tour operator...",
      "contactEmail": "info@keralabackwaters.com",
      "contactPhone": "+919847012345",
      "website": "https://www.keralabackwaters.com",
      "address": "4th Floor, Tourism Complex, MG Road",
      "district": "Ernakulam",
      "state": "Kerala",
      "pinCode": "682016",
      "logoMediaId": "65b53e89a1c2d3e4f5060708",
      "verificationStatus": "PENDING",
      "reviewedBy": null,
      "reviewedAt": null,
      "verifiedAt": null,
      "rejectionReason": null,
      "documentsCount": 2,
      "createdAt": "2026-11-13T04:30:00.000Z",
      "updatedAt": "2026-11-13T04:35:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## 2. Get Detailed Agency Profile

Returns full agency metadata and document metadata (without internal storage vault paths) for moderator review.

- **Method**: `GET`
- **URL**: `/api/v1/admin/agencies/:agencyId`
- **Permission**: `VIEW_AGENCIES`

### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "673456789abcdef012345678",
    "accountId": "65a123456789abcdef012345",
    "businessProfileId": "65a987654321fedcba098765",
    "agencyName": "Kerala Backwaters & Hills Travel",
    "registrationNumber": "KL-TOUR-2026-9872",
    "businessCategory": "TOUR_OPERATOR",
    "description": "Premier inbound tour operator...",
    "contactEmail": "info@keralabackwaters.com",
    "contactPhone": "+919847012345",
    "website": "https://www.keralabackwaters.com",
    "address": "4th Floor, Tourism Complex, MG Road",
    "district": "Ernakulam",
    "state": "Kerala",
    "pinCode": "682016",
    "logoMediaId": "65b53e89a1c2d3e4f5060708",
    "verificationStatus": "PENDING",
    "documents": [
      {
        "id": "673456789abcdef012345699",
        "documentType": "BUSINESS_REGISTRATION",
        "originalFileName": "kerala_gov_registration.pdf",
        "fileSize": 1048576,
        "mimeType": "application/pdf",
        "uploadedAt": "2026-11-13T04:35:00.000Z"
      }
    ],
    "documentsCount": 1,
    "createdAt": "2026-11-13T04:30:00.000Z",
    "updatedAt": "2026-11-13T04:35:00.000Z"
  }
}
```

---

## 3. Review Agency & Transition Verification Status

Transitions the agency verification status (`UNDER_REVIEW`, `VERIFIED`, `REJECTED`). Executes inside a MongoDB ACID transaction that simultaneously updates `Agency.verificationStatus` and `BusinessProfile.verificationStatus`, and records an immutable `AuditLog` entry.

- **Method**: `PATCH`
- **URL**: `/api/v1/admin/agencies/:agencyId/review`
- **Permission**: `VERIFY_AGENCIES`
- **Rate Limit**: `adminMutationRateLimiter` (30 req / 15 min)

### Request Body (Approval)
```json
{
  "status": "VERIFIED"
}
```

### Request Body (Rejection)
```json
{
  "status": "REJECTED",
  "rejectionReason": "Submitted trade license is expired. Please submit a valid 2026-2027 renewal."
}
```

### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "673456789abcdef012345678",
    "agencyName": "Kerala Backwaters & Hills Travel",
    "verificationStatus": "VERIFIED",
    "reviewedBy": "65a000000000000000000001",
    "reviewedAt": "2026-11-13T04:45:00.000Z",
    "verifiedAt": "2026-11-13T04:45:00.000Z",
    "rejectionReason": null,
    "updatedAt": "2026-11-13T04:45:00.000Z"
  },
  "auditLog": {
    "id": "673456789abcdef012345755",
    "action": "AGENCY_APPROVED",
    "targetEntityType": "AGENCY",
    "targetEntityId": "673456789abcdef012345678",
    "actorAccountId": "65a000000000000000000001",
    "actorAccountType": "ADMIN",
    "actorAdminLevel": "SUPER_ADMIN",
    "timestamp": "2026-11-13T04:45:00.000Z"
  },
  "message": "Agency status successfully transitioned to VERIFIED"
}
```

### Error Responses
- `400 Bad Request` (`REJECTION_REASON_REQUIRED`): Rejection requested without `rejectionReason`.
- `400 Bad Request` (`INVALID_STATUS_TRANSITION`): Agency is already in the requested status.
- `403 Forbidden` (`INSUFFICIENT_PERMISSIONS`): Admin lacks `VERIFY_AGENCIES`.
- `409 Conflict` (`CONCURRENT_MODIFICATION`): Another admin concurrently modified the status.
