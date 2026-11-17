# Business Travel Agency Management API Specification (Day 19)

The Travel Agency module enables verified business accounts registered as `TRAVEL_AGENCY` to create and manage their agency profile, upload required compliance documents, and inspect their verification lifecycle under the Split-Identity paradigm.

---

## Base Path & Security Pre-requisites

- **Base Path**: `/api/v1/business/agency`
- **Security Chain**:
  1. `authenticate` (Valid Bearer JWT access token)
  2. `requireActiveAccount` (Account status must be `ACTIVE`)
  3. `requireAccountType('BUSINESS')` (Account must be `BUSINESS`)
  4. Eligibility check: `BusinessProfile.businessType === 'TRAVEL_AGENCY'`

---

## Endpoints Summary

| Method | Endpoint | Description | Rate Limit | Permissions |
|---|---|---|---|---|
| `POST` | `/api/v1/business/agency` | Register travel agency profile | 20 req / 15 min | `BUSINESS` account with `TRAVEL_AGENCY` |
| `GET` | `/api/v1/business/agency` | Retrieve own agency profile | Standard | `BUSINESS` account |
| `PATCH` | `/api/v1/business/agency` | Update own agency profile details | 20 req / 15 min | `BUSINESS` account |
| `POST` | `/api/v1/business/agency/documents` | Upload compliance document metadata | 15 req / 15 min | `BUSINESS` account |
| `DELETE` | `/api/v1/business/agency/documents/:documentId` | Delete an uploaded document | 20 req / 15 min | `BUSINESS` account |

---

## 1. Register Travel Agency Profile

Creates the travel agency entity linked to the authenticated business account. Initial verification status is automatically assigned as `PENDING`.

- **Method**: `POST`
- **URL**: `/api/v1/business/agency`
- **Rate Limit**: `agencyMutationRateLimiter` (20 req / 15 min)

### Headers
```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### Request Body
```json
{
  "agencyName": "Kerala Backwaters & Hills Travel",
  "registrationNumber": "KL-TOUR-2026-9872",
  "businessCategory": "TOUR_OPERATOR",
  "description": "Premier inbound tour operator specializing in eco-friendly backwater and hill station tours.",
  "contactEmail": "info@keralabackwaters.com",
  "contactPhone": "+919847012345",
  "website": "https://www.keralabackwaters.com",
  "address": "4th Floor, Tourism Complex, MG Road",
  "district": "Ernakulam",
  "state": "Kerala",
  "pinCode": "682016",
  "logoMediaId": "65b53e89a1c2d3e4f5060708"
}
```

### Response `201 Created`
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
    "description": "Premier inbound tour operator specializing in eco-friendly backwater and hill station tours.",
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
    "documents": [],
    "documentsCount": 0,
    "createdAt": "2026-11-13T04:30:00.000Z",
    "updatedAt": "2026-11-13T04:30:00.000Z"
  }
}
```

### Error Responses
- `400 Bad Request` (`INELIGIBLE_BUSINESS_TYPE`): If the account's `businessType` is not `TRAVEL_AGENCY`.
- `409 Conflict` (`AGENCY_ALREADY_EXISTS`): If the business account already has an agency profile.
- `409 Conflict` (`REGISTRATION_NUMBER_EXISTS`): If another agency is already registered with this registration number.

---

## 2. Get Own Travel Agency Profile

Retrieves the authenticated business's agency details, including all uploaded compliance documents (without exposing internal storage keys).

- **Method**: `GET`
- **URL**: `/api/v1/business/agency`

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
    "description": "Premier inbound tour operator specializing in eco-friendly backwater and hill station tours.",
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

## 3. Update Travel Agency Profile

Allows the agency owner to modify contact details, address, description, or business category. Modification of `verificationStatus`, `registrationNumber`, `accountId`, or `businessProfileId` is strictly forbidden.

- **Method**: `PATCH`
- **URL**: `/api/v1/business/agency`
- **Rate Limit**: `agencyMutationRateLimiter` (20 req / 15 min)

### Request Body
```json
{
  "description": "Updated description with new hill station routes and monsoon specials.",
  "contactPhone": "+919847099999",
  "website": "https://www.keralabackwaters.com/monsoon"
}
```

### Response `200 OK`
```json
{
  "success": true,
  "data": { ... }
}
```

---

## 4. Upload Agency Compliance Document

Uploads a compliance document (e.g., GST Certificate, Trade License, Department of Tourism Registration). Binary magic bytes are validated against the declared MIME type to reject disguised malicious files.

- **Method**: `POST`
- **URL**: `/api/v1/business/agency/documents`
- **Rate Limit**: `agencyDocumentRateLimiter` (15 req / 15 min)

### Allowed Formats & Limits
- Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`
- Maximum file size: `5 MB` (`5,242,880 bytes`)
- Maximum documents per agency: `10`

### Request Body
```json
{
  "documentType": "GST_CERTIFICATE",
  "originalFileName": "gst_certificate_2026.pdf",
  "fileSize": 1048576,
  "mimeType": "application/pdf",
  "fileData": "JVBERi0xLjQKJ..."
}
```

### Response `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "673456789abcdef012345700",
    "documentType": "GST_CERTIFICATE",
    "originalFileName": "gst_certificate_2026.pdf",
    "fileSize": 1048576,
    "mimeType": "application/pdf",
    "uploadedAt": "2026-11-13T04:40:00.000Z"
  }
}
```

### Error Responses
- `400 Bad Request` (`FILE_TOO_LARGE`): File size exceeds 5MB.
- `400 Bad Request` (`INVALID_FILE_SIGNATURE`): Magic bytes do not match declared MIME type.
- `400 Bad Request` (`MAX_DOCUMENTS_REACHED`): Agency already has 10 documents.

---

## 5. Delete Agency Document

Removes an uploaded compliance document from the agency profile and automatically synchronizes with the parent `BusinessProfile.documents` array inside an ACID transaction.

- **Method**: `DELETE`
- **URL**: `/api/v1/business/agency/documents/:documentId`
- **Rate Limit**: `agencyMutationRateLimiter` (20 req / 15 min)

### Response `200 OK`
```json
{
  "success": true,
  "message": "Agency document removed successfully"
}
```

### Error Responses
- `404 Not Found` (`DOCUMENT_NOT_FOUND`): Document ID does not belong to this agency.
