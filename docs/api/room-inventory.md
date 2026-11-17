# Room Inventory & Availability API Specification

## 1. Overview
The Room Inventory API manages physical room counts, sellable inventory, and operational holds (maintenance, VIP, owner holds) on a per-calendar-date basis for each room type.
Public availability scans allow tourists to search for properties and room types that can accommodate their stay duration and party size.

---

## 2. Invariants & Calculation Rules
On any calendar date $d$ for room type $r$:
1. $availableUnits \ge 0$
2. $blockedUnits \ge 0$
3. $maintenanceUnits \ge 0$
4. $availableUnits + blockedUnits + maintenanceUnits \le totalUnits$
5. $availableUnits = totalUnits - blockedUnits - maintenanceUnits$

---

## 3. Endpoints

### 3.1 Host Inventory Management

#### `GET /api/v1/business/rooms/:roomTypeId/inventory`
Fetches inventory allocations for a bounded date range.
- **Access**: Authenticated `BUSINESS` account owning `:roomTypeId`.
- **Query Parameters**:
  - `startDate`: Optional `YYYY-MM-DD` (defaults to today in UTC Asia/Kolkata).
  - `endDate`: Optional `YYYY-MM-DD` (defaults to today + 30 days).
  - Maximum date span: 180 days.
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "67375a00e811aa0012345700",
      "propertyId": "673750a1e811aa0012345670",
      "roomTypeId": "673752e2e811aa0012345678",
      "businessProfileId": "67374fe1e811aa0012345660",
      "date": "2026-12-01",
      "totalUnits": 10,
      "availableUnits": 8,
      "blockedUnits": 1,
      "maintenanceUnits": 1,
      "createdAt": "2026-11-16T10:00:00.000Z",
      "updatedAt": "2026-11-16T10:00:00.000Z"
    }
  ],
  "total": 1,
  "startDate": "2026-12-01",
  "endDate": "2026-12-01",
  "message": "Room inventory retrieved successfully"
}
```

---

#### `PUT /api/v1/business/rooms/:roomTypeId/inventory`
Bulk-configures or overrides inventory allocations across a date range.
- **Access**: Authenticated `BUSINESS` account owning `:roomTypeId`.
- **Rate Limit**: 30 requests / 15 minutes.
- **Request Body**:
```json
{
  "startDate": "2026-12-01",
  "endDate": "2026-12-31",
  "totalUnits": 10,
  "blockedUnits": 0,
  "maintenanceUnits": 0
}
```
- **Validation**:
  - `totalUnits >= blockedUnits + maintenanceUnits`
  - Range span $\le 180$ days.
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "Inventory configured successfully",
    "configuredDatesCount": 31
  },
  "message": "Inventory configured successfully"
}
```

---

#### `PATCH /api/v1/business/rooms/:roomTypeId/inventory/:inventoryId`
Updates allocations for a single inventory record.
- **Access**: Authenticated `BUSINESS` account owning `:roomTypeId`.
- **Request Body**:
```json
{
  "totalUnits": 12,
  "blockedUnits": 2,
  "maintenanceUnits": 1
}
```
- **Response**: `200 OK`

---

#### `POST /api/v1/business/rooms/:roomTypeId/block-dates`
Atomically blocks units for maintenance or host hold across a date range using conditional MongoDB updates.
- **Access**: Authenticated `BUSINESS` account owning `:roomTypeId`.
- **Request Body**:
```json
{
  "startDate": "2026-12-10",
  "endDate": "2026-12-15",
  "unitsToBlock": 2,
  "blockType": "MAINTENANCE",
  "reason": "Air conditioner servicing and deep clean"
}
```
- **Atomic Concurrency Guarantee**:
  Executes `updateOne({ roomTypeId, date, availableUnits: { $gte: unitsToBlock } }, { $inc: { maintenanceUnits: unitsToBlock, availableUnits: -unitsToBlock } })`.
  If any date lacks sufficient units, the transaction rolls back with `409 Conflict` (`INSUFFICIENT_AVAILABLE_INVENTORY`).
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "message": "Dates blocked successfully",
    "affectedDatesCount": 6
  },
  "message": "Dates blocked successfully"
}
```

---

#### `POST /api/v1/business/rooms/:roomTypeId/unblock-dates`
Atomically unblocks units from maintenance or hold back into sellable inventory.
- **Access**: Authenticated `BUSINESS` account owning `:roomTypeId`.
- **Request Body**:
```json
{
  "startDate": "2026-12-10",
  "endDate": "2026-12-15",
  "unitsToUnblock": 2,
  "blockType": "MAINTENANCE"
}
```
- **Response**: `200 OK`

---

### 3.2 Public Availability Scans

#### `GET /api/v1/properties/:propertyId/availability`
Checks live room availability and pricing across a multi-day stay.
- **Access**: Public.
- **Query Parameters**:
  - `checkIn`: `YYYY-MM-DD`
  - `checkOut`: `YYYY-MM-DD` (strictly $> checkIn$, max 30 nights)
  - `adults`: integer ($\ge 1$, default 1)
  - `children`: integer ($\ge 0$, default 0)
  - `rooms`: integer ($\ge 1$, default 1)
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "propertyId": "673750a1e811aa0012345670",
    "propertyName": "Kumarakom Heritage Lake Resort",
    "checkIn": "2026-12-01",
    "checkOut": "2026-12-04",
    "nightsCount": 3,
    "availableRoomTypes": [
      {
        "roomType": {
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
          "facilities": ["WIFI", "AIR_CONDITIONING", "SEA_VIEW"],
          "basePrice": 650000,
          "pricePerNight": 6500.0,
          "pricePerNightPaise": 650000,
          "currency": "INR",
          "pricingUnit": "PER_NIGHT",
          "coverMediaId": null,
          "galleryMediaIds": [],
          "coverImageUrl": null,
          "galleryImageUrls": [],
          "totalUnits": 10
        },
        "requestedRooms": 1,
        "availableUnitsAcrossStay": 7,
        "isAvailable": true,
        "nightsCount": 3,
        "pricePerNight": 6500.0,
        "totalStayPrice": 19500.0,
        "currency": "INR"
      }
    ]
  },
  "message": "Property room availability retrieved successfully"
}
```
