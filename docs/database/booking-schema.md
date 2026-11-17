# Booking Engine Database Schema & Data Models

## 1. Domain Collections

The Booking Engine domain comprises three collections:
1. `bookings`: Master reservation records.
2. `inventoryHolds`: Temporary inventory reservation records.
3. `idempotencyKeys`: Idempotency tracking records.

---

## 2. Collection 34: `bookings`

### 2.1 Schema Definition
```typescript
interface IBookingDocument extends Document {
  _id: Types.ObjectId;
  bookingReference: string; // Unique alphanumeric code, e.g. 'KL-A9B3-7281'
  touristAccountId: Types.ObjectId; // Ref: accounts._id (tourist identity)
  propertyId: Types.ObjectId; // Ref: properties._id
  roomTypeId: Types.ObjectId; // Ref: roomTypes._id
  businessProfileId: Types.ObjectId; // Ref: businessProfiles._id (property merchant)
  checkInDate: string; // ISO date 'YYYY-MM-DD'
  checkOutDate: string; // ISO date 'YYYY-MM-DD'
  numberOfRooms: number; // Requested room count
  adults: number; // Adult guest count
  children: number; // Child guest count
  nights: number; // Stay nights count
  status: BookingStatus; // 'AWAITING_PAYMENT' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED'
  holdId?: Types.ObjectId | null; // Ref: inventoryHolds._id
  priceSnapshot: {
    basePricePaise: number;
    basePriceInr: number;
    numberOfRooms: number;
    numberOfNights: number;
    dailyBreakdown: Array<{
      date: string;
      pricePaise: number;
      priceInr: number;
    }>;
    subtotalPaise: number;
    subtotalInr: number;
    taxesPaise: number;
    taxesInr: number;
    totalPaise: number;
    totalInr: number;
    currency: string;
  };
  guestDetails: {
    primaryGuestName: string;
    email: string;
    phone: string;
    specialRequests?: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.2 Indexing Strategy
- `{ bookingReference: 1 }`: Unique index for customer reference lookup.
- `{ touristAccountId: 1, createdAt: -1 }`: Efficient tourist booking history queries.
- `{ propertyId: 1, checkInDate: 1 }`: Property host booking schedule queries.
- `{ businessProfileId: 1, createdAt: -1 }`: Merchant dashboard booking list queries.
- `{ holdId: 1 }`: Sparse index for hold-to-booking resolution.

---

## 3. Collection 35: `inventoryHolds`

### 3.1 Schema Definition
```typescript
interface IInventoryHoldDocument extends Document {
  _id: Types.ObjectId;
  bookingId: Types.ObjectId; // Ref: bookings._id (Unique 1:1 relationship)
  roomTypeId: Types.ObjectId; // Ref: roomTypes._id
  propertyId: Types.ObjectId; // Ref: properties._id
  businessProfileId: Types.ObjectId; // Ref: businessProfiles._id
  touristAccountId: Types.ObjectId; // Ref: accounts._id
  numberOfRooms: number;
  stayDates: string[]; // Array of stay nights ['2026-12-01', '2026-12-02', ...]
  status: InventoryHoldStatus; // 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED'
  expiresAt: Date; // Timestamp when hold expires (15 min after creation)
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 Indexing Strategy
- `{ bookingId: 1 }`: Unique index ensuring one hold per reservation.
- `{ status: 1, expiresAt: 1 }`: Compound index for high-throughput expiry worker polling.
- `{ touristAccountId: 1, status: 1 }`: Querying tourist active holds.
- `{ expiresAt: 1 }`: MongoDB TTL index (`expireAfterSeconds: 604800` / 7 days) for disk pruning.

---

## 4. Collection: `idempotencyKeys`

### 4.1 Schema Definition
```typescript
interface IIdempotencyRecordDocument extends Document {
  _id: Types.ObjectId;
  touristAccountId: Types.ObjectId; // Scoped to authenticated tourist
  key: string; // Client supplied Idempotency-Key
  requestHash: string; // SHA-256 hash of JSON request body
  responseStatus: number; // HTTP response code (e.g., 201)
  responseBody: unknown; // Cached JSON payload
  bookingId?: Types.ObjectId | null;
  holdId?: Types.ObjectId | null;
  expiresAt: Date; // TTL timestamp (24 hours after creation)
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.2 Indexing Strategy
- `{ touristAccountId: 1, key: 1 }`: Unique compound index preventing collision across users.
- `{ expiresAt: 1 }`: MongoDB TTL index (`expireAfterSeconds: 0`) for automatic 24-hour cleanup.
