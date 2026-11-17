# Accommodation Properties API Specification

This document details the public and business property management endpoints for the Kerala Tourism ecosystem.

---

## 1. Business Property Management (`/api/v1/business/properties`)

All endpoints in this section require:
- `authenticate` (Valid Bearer JWT access token)
- `requireActiveAccount` (`account.status === 'ACTIVE'`)
- `requireAccountType('BUSINESS')`
- `requireVerifiedBusiness` (`businessProfile.verificationStatus === 'VERIFIED'`, eligible accommodation business type: `HOTEL`, `RESORT`, `HOMESTAY`, `OTHER`)

Ownership is strictly enforced server-side (`accountId` and `businessProfileId` derived from `req.user.id`). Any attempt to access or modify a property owned by another business returns `404 RESOURCE_NOT_FOUND` to conceal resource existence (BOLA/IDOR protection).

### 1.1 Create Property
- **Endpoint**: `POST /api/v1/business/properties`
- **Rate Limit**: 40 req/15 min (`propertyMutationRateLimiter`)
- **Request Body**:
  ```json
  {
    "name": "Kumarakom Heritage Backwater Resort",
    "propertyType": "RESORT",
    "shortDescription": "Luxury backwater resort situated on the banks of Vembanad Lake.",
    "description": "Experience traditional Kerala architecture with private plunge pools, Ayurvedic rejuvenation, and sunset boat cruises.",
    "address": "Vembanad Lakefront, Kavanattinkara",
    "district": "Kottayam",
    "city": "Kumarakom",
    "state": "Kerala",
    "postalCode": "686563",
    "location": {
      "type": "Point",
      "coordinates": [76.4298, 9.6175]
    },
    "contactPhone": "+919847012345",
    "contactEmail": "reservations@kumarakomheritage.test",
    "website": "https://kumarakomheritage.test",
    "facilities": ["WIFI", "PARKING", "SWIMMING_POOL", "RESTAURANT", "AIR_CONDITIONING", "SPA"],
    "coverMediaId": "654321098765432109876543",
    "galleryMediaIds": ["654321098765432109876544", "654321098765432109876545"]
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "Property created successfully",
    "data": {
      "id": "673456789012345678901234",
      "businessProfileId": "671234567890123456789012",
      "accountId": "670123456789012345678901",
      "name": "Kumarakom Heritage Backwater Resort",
      "slug": "kumarakom-heritage-backwater-resort",
      "propertyType": "RESORT",
      "status": "DRAFT",
      "district": "Kottayam",
      "facilities": ["WIFI", "PARKING", "SWIMMING_POOL", "RESTAURANT", "AIR_CONDITIONING", "SPA"],
      "createdAt": "2026-11-13T14:30:00.000Z",
      "updatedAt": "2026-11-13T14:30:00.000Z"
    }
  }
  ```

### 1.2 List Own Properties
- **Endpoint**: `GET /api/v1/business/properties`
- **Query Parameters**:
  - `status`: `DRAFT` | `PENDING_REVIEW` | `PUBLISHED` | `REJECTED` | `ARCHIVED` (optional)
  - `propertyType`: `HOTEL` | `RESORT` | `HOMESTAY` | `VILLA` | `GUESTHOUSE` | `HOSTEL` | `HOUSEBOAT` | `OTHER` (optional)
  - `district`: Kerala district name (optional)
  - `page`: integer $\ge 1$ (default: 1)
  - `limit`: integer $1..50$ (default: 20)
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [ ... ],
    "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
  }
  ```

### 1.3 Get Property Detail
- **Endpoint**: `GET /api/v1/business/properties/:propertyId`
- **Response** (`200 OK`): Full `PropertyDto` with audit details, review notes, and media identifiers.

### 1.4 Update Property
- **Endpoint**: `PATCH /api/v1/business/properties/:propertyId`
- **Rules**: Strictly permitted only when `status === 'DRAFT'` or `status === 'REJECTED'`. If `PENDING_REVIEW` or `PUBLISHED`, returns `400 PROPERTY_NOT_MODIFIABLE`.
- **Response** (`200 OK`): Updated `PropertyDto`.

### 1.5 Delete / Archive Property
- **Endpoint**: `DELETE /api/v1/business/properties/:propertyId`
- **Rules**: Permanently deletes `DRAFT` properties; soft-deletes (`status = 'ARCHIVED', archivedAt = Date`) `PUBLISHED` properties.

### 1.6 Submit for Review
- **Endpoint**: `POST /api/v1/business/properties/:propertyId/submit-review`
- **Rules**: Transitions `DRAFT` or `REJECTED` property to `PENDING_REVIEW`. Sets `submittedAt = Date()`.

---

## 2. Public Property Discovery (`/api/v1/properties`)

All endpoints in this section are public and require no authentication.
Enforces the **Public Visibility Invariant**: properties are returned ONLY if `property.status === 'PUBLISHED'`, `businessProfile.verificationStatus === 'VERIFIED'`, and `account.status === 'ACTIVE'`.

### 2.1 Browse Catalog
- **Endpoint**: `GET /api/v1/properties`
- **Query Parameters**:
  - `district`: Filter by Kerala district
  - `propertyType`: Filter by accommodation type
  - `facility`: Single facility filter
  - `facilities`: Array of facility filters
  - `search`: Case-insensitive text search (ReDoS-protected)
  - `sort`: `newest` | `name_asc` | `name_desc`
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 20, max: 50)

### 2.2 Nearby Geospatial Discovery
- **Endpoint**: `GET /api/v1/properties/nearby`
- **Query Parameters**:
  - `latitude`: Number (-90 to 90, within Kerala bounds: 8.18 to 12.85) (required)
  - `longitude`: Number (-180 to 180, within Kerala bounds: 74.86 to 77.42) (required)
  - `radius`: Radius in kilometers (1 to 100, default: 25) (optional)
  - `propertyType`: Filter by accommodation category (optional)
  - `page`, `limit`: Pagination parameters
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "673456789012345678901234",
        "name": "Kumarakom Heritage Backwater Resort",
        "slug": "kumarakom-heritage-backwater-resort",
        "propertyType": "RESORT",
        "distanceMeters": 1420,
        "location": {
          "type": "Point",
          "coordinates": [76.4298, 9.6175]
        },
        "business": {
          "id": "671234567890123456789012",
          "businessName": "Kumarakom Hospitality Group",
          "businessType": "RESORT",
          "district": "Kottayam"
        }
      }
    ],
    "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
  }
  ```

### 2.3 Get Public Property by Slug
- **Endpoint**: `GET /api/v1/properties/:slug`
- **Rules**: Returns sanitized `PublicPropertyDto`. If property is unpublished, or the owning business account is suspended/unverified, returns `404 RESOURCE_NOT_FOUND`.
