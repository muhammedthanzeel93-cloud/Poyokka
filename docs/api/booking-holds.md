# Booking Engine & Inventory Hold API Reference

## Base URL
`/api/v1/tourist/bookings`

## Authentication & Authorization
All endpoints require:
- Valid JWT in `Authorization: Bearer <token>`.
- Active account status (`ACCOUNT_STATUSES.ACTIVE`).
- Tourist account type (`ACCOUNT_TYPES.TOURIST`).

---

## 1. Create Temporary Booking Hold

Reserves room inventory across the specified stay dates and creates a booking record in `AWAITING_PAYMENT` status with a 15-minute hold validity window.

- **Method**: `POST`
- **Path**: `/holds`
- **Rate Limit**: 30 requests per 15 minutes per tourist account/IP
- **Headers**:
  - `Idempotency-Key` *(Optional, recommended)*: Unique client string for safe retry.

### Request Body
```json
{
  "propertyId": "651a2b3c4d5e6f7a8b9c0d1e",
  "roomTypeId": "651a2b3c4d5e6f7a8b9c0d2f",
  "checkInDate": "2026-12-01",
  "checkOutDate": "2026-12-04",
  "numberOfRooms": 2,
  "adults": 4,
  "children": 1,
  "guestDetails": {
    "primaryGuestName": "Anoop Nair",
    "email": "anoop.nair@example.com",
    "phone": "+919876543210",
    "specialRequests": "Upper floor room preferred with mountain view"
  }
}
```

### Validation Rules
- `checkInDate`: Must be in `YYYY-MM-DD` format and cannot be in the past relative to `Asia/Kolkata` local time. Maximum 180 days in advance.
- `checkOutDate`: Must be strictly after `checkInDate`.
- `nights`: Max 30 nights.
- `numberOfRooms`: 1 to 10 rooms.
- `adults`: 1 to 30 adults, cannot exceed `roomType.maxAdults * numberOfRooms`.
- `children`: 0 to 30 children; `adults + children` cannot exceed `roomType.maxOccupancy * numberOfRooms`.

### Success Response (`201 Created`)
```json
{
  "success": true,
  "message": "Temporary inventory hold created successfully",
  "data": {
    "booking": {
      "id": "6738910a2b3c4d5e6f7a8b9c",
      "bookingReference": "KL-7F2A-4819",
      "touristAccountId": "651a2b3c4d5e6f7a8b9c0d1e",
      "propertyId": "651a2b3c4d5e6f7a8b9c0d1e",
      "roomTypeId": "651a2b3c4d5e6f7a8b9c0d2f",
      "businessProfileId": "651a2b3c4d5e6f7a8b9c0d3a",
      "checkInDate": "2026-12-01",
      "checkOutDate": "2026-12-04",
      "numberOfRooms": 2,
      "adults": 4,
      "children": 1,
      "nights": 3,
      "status": "AWAITING_PAYMENT",
      "holdId": "6738910a2b3c4d5e6f7a8b9d",
      "priceSnapshot": {
        "basePricePaise": 500000,
        "basePriceInr": 5000,
        "numberOfRooms": 2,
        "numberOfNights": 3,
        "dailyBreakdown": [
          { "date": "2026-12-01", "pricePaise": 500000, "priceInr": 5000 },
          { "date": "2026-12-02", "pricePaise": 500000, "priceInr": 5000 },
          { "date": "2026-12-03", "pricePaise": 500000, "priceInr": 5000 }
        ],
        "subtotalPaise": 3000000,
        "subtotalInr": 30000,
        "taxesPaise": 0,
        "taxesInr": 0,
        "totalPaise": 3000000,
        "totalInr": 30000,
        "currency": "INR"
      },
      "guestDetails": {
        "primaryGuestName": "Anoop Nair",
        "email": "anoop.nair@example.com",
        "phone": "+919876543210",
        "specialRequests": "Upper floor room preferred with mountain view"
      },
      "createdAt": "2026-11-16T15:00:00.000Z",
      "updatedAt": "2026-11-16T15:00:00.000Z"
    },
    "hold": {
      "id": "6738910a2b3c4d5e6f7a8b9d",
      "bookingId": "6738910a2b3c4d5e6f7a8b9c",
      "roomTypeId": "651a2b3c4d5e6f7a8b9c0d2f",
      "propertyId": "651a2b3c4d5e6f7a8b9c0d1e",
      "businessProfileId": "651a2b3c4d5e6f7a8b9c0d3a",
      "touristAccountId": "651a2b3c4d5e6f7a8b9c0d1e",
      "numberOfRooms": 2,
      "stayDates": ["2026-12-01", "2026-12-02", "2026-12-03"],
      "status": "ACTIVE",
      "expiresAt": "2026-11-16T15:15:00.000Z",
      "createdAt": "2026-11-16T15:00:00.000Z",
      "updatedAt": "2026-11-16T15:00:00.000Z"
    },
    "expiresAt": "2026-11-16T15:15:00.000Z",
    "remainingSeconds": 900
  }
}
```

### Error Responses
- `400 Bad Request`: Validation failure (past check-in date, occupancy exceeded, duration > 30 nights).
- `404 Not Found`: Property or room type does not exist, is not active, or is not published.
- `409 Conflict`: Insufficient room inventory available for one or more requested stay dates (`INSUFFICIENT_INVENTORY`) or idempotency key payload mismatch (`IDEMPOTENCY_PAYLOAD_MISMATCH`).
- `429 Too Many Requests`: Rate limit exceeded on hold creation.

---

## 2. Inspect Active Hold

Retrieves hold status and live remaining seconds.

- **Method**: `GET`
- **Path**: `/holds/:holdId`
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "message": "Hold details retrieved successfully",
  "data": {
    "hold": {
      "id": "6738910a2b3c4d5e6f7a8b9d",
      "bookingId": "6738910a2b3c4d5e6f7a8b9c",
      "status": "ACTIVE",
      "expiresAt": "2026-11-16T15:15:00.000Z",
      "numberOfRooms": 2,
      "stayDates": ["2026-12-01", "2026-12-02", "2026-12-03"]
    },
    "remainingSeconds": 642
  }
}
```

---

## 3. Voluntary Release of Inventory Hold

Allows the tourist to voluntarily abandon the hold before payment, immediately releasing reserved units back to available inventory.

- **Method**: `DELETE`
- **Path**: `/holds/:holdId`
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "message": "Hold successfully released and inventory returned"
}
```

---

## 4. Retrieve Specific Booking

- **Method**: `GET`
- **Path**: `/:bookingId`
- **Success Response (`200 OK`)**:
```json
{
  "success": true,
  "message": "Booking details retrieved successfully",
  "data": {
    "id": "6738910a2b3c4d5e6f7a8b9c",
    "bookingReference": "KL-7F2A-4819",
    "status": "AWAITING_PAYMENT",
    "priceSnapshot": { ... },
    "guestDetails": { ... }
  }
}
```

---

## 5. List Tourist Bookings

- **Method**: `GET`
- **Path**: `/`
- **Query Parameters**:
  - `status`: Optional filter (`AWAITING_PAYMENT`, `CONFIRMED`, etc.)
  - `page`: Page number (default: 1)
  - `limit`: Limit per page (default: 20, max: 50)
