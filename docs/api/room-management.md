# Room Management API Specification

## 1. Overview
The Room Management API allows verified hospitality businesses (Hotels, Resorts, Homestays, Villas, Hostels, etc.) to manage distinct room types associated with their accommodation properties. Tourists and visitors can query active room configurations publicly for published properties.

---

## 2. Endpoints

### 2.1 Business Room Type Management

#### `POST /api/v1/business/properties/:propertyId/rooms`
Creates a new room type under the specified property.
- **Access**: Authenticated `BUSINESS` account with `VERIFIED` status owning `:propertyId`.
- **Rate Limit**: 60 requests / 15 minutes.
- **Request Body**:
```json
{
  "name": "Deluxe Sea View Suite",
  "description": "Spacious suite overlooking the Arabian Sea with private balcony.",
  "roomCategory": "SUITE",
  "maxAdults": 2,
  "maxChildren": 2,
  "maxOccupancy": 3,
  "bedConfiguration": "1 King Bed + 1 Sofa Bed",
  "bedCount": 2,
  "roomSize": 450,
  "roomSizeUnit": "SQ_FT",
  "facilities": ["WIFI", "AIR_CONDITIONING", "SEA_VIEW", "BALCONY", "MINIBAR"],
  "basePrice": 650000,
  "currency": "INR",
  "pricingUnit": "PER_NIGHT",
  "totalUnits": 12
}
```
- **Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "673752e2e811aa0012345678",
    "propertyId": "673750a1e811aa0012345670",
    "businessProfileId": "67374fe1e811aa0012345660",
    "accountId": "67374fa0e811aa0012345650",
    "name": "Deluxe Sea View Suite",
    "slug": "deluxe-sea-view-suite",
    "description": "Spacious suite overlooking the Arabian Sea with private balcony.",
    "roomCategory": "SUITE",
    "maxAdults": 2,
    "maxChildren": 2,
    "maxOccupancy": 3,
    "bedConfiguration": "1 King Bed + 1 Sofa Bed",
    "bedCount": 2,
    "roomSize": 450,
    "roomSizeUnit": "SQ_FT",
    "facilities": ["WIFI", "AIR_CONDITIONING", "SEA_VIEW", "BALCONY", "MINIBAR"],
    "basePrice": 650000,
    "currency": "INR",
    "pricingUnit": "PER_NIGHT",
    "coverMediaId": null,
    "galleryMediaIds": [],
    "status": "ACTIVE",
    "totalUnits": 12,
    "createdAt": "2026-11-16T10:00:00.000Z",
    "updatedAt": "2026-11-16T10:00:00.000Z"
  },
  "message": "Room type created successfully"
}
```

---

#### `GET /api/v1/business/properties/:propertyId/rooms`
Lists all room types belonging to the host's property.
- **Access**: Authenticated `BUSINESS` account owning `:propertyId`.
- **Query Parameters**:
  - `status`: Optional filter (`ACTIVE` | `INACTIVE` | `ARCHIVED`).
  - `roomCategory`: Optional filter.
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": [ ... ],
  "total": 3,
  "message": "Property room types retrieved successfully"
}
```

---

#### `GET /api/v1/business/rooms/:roomTypeId`
Retrieves single room type details.
- **Access**: Authenticated `BUSINESS` account owning the room's parent property.
- **BOLA Protection**: Returns `404 Not Found` if requested by another business.
- **Response**: `200 OK`

---

#### `PATCH /api/v1/business/rooms/:roomTypeId`
Updates attributes of a room type.
- **Access**: Authenticated `BUSINESS` account owning the room.
- **Rate Limit**: 60 requests / 15 minutes.
- **Body**: Any updatable room type field.
- **Response**: `200 OK`

---

#### `DELETE /api/v1/business/rooms/:roomTypeId`
Soft-deletes a room type (`status: ARCHIVED`).
- **Access**: Authenticated `BUSINESS` account owning the room.
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "Room type archived successfully"
  },
  "message": "Room type archived successfully"
}
```

---

### 2.2 Public Discovery

#### `GET /api/v1/properties/:propertyId/rooms`
Lists all active room types for a publicly published property.
- **Access**: Public.
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "673752e2e811aa0012345678",
      "propertyId": "673750a1e811aa0012345670",
      "name": "Deluxe Sea View Suite",
      "slug": "deluxe-sea-view-suite",
      "roomCategory": "SUITE",
      "maxAdults": 2,
      "maxChildren": 2,
      "maxOccupancy": 3,
      "bedConfiguration": "1 King Bed + 1 Sofa Bed",
      "bedCount": 2,
      "roomSize": 450,
      "roomSizeUnit": "SQ_FT",
      "facilities": ["WIFI", "AIR_CONDITIONING", "SEA_VIEW", "BALCONY", "MINIBAR"],
      "basePrice": 650000,
      "currency": "INR",
      "pricingUnit": "PER_NIGHT",
      "coverMediaId": null,
      "galleryMediaIds": [],
      "totalUnits": 12
    }
  ],
  "total": 1,
  "message": "Public property room types retrieved successfully"
}
```

---

#### `GET /api/v1/rooms/:roomTypeId`
Fetches public details of a single active room type.
- **Access**: Public.
- **Response**: `200 OK`
