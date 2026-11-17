# Database Architecture & Design: Room Types & Inventory

## 1. Architectural Strategy: Room Type vs Physical Unit
In modern hospitality systems (and consistent with Kerala Tourism requirements), inventory management operates on a **Room-Type Inventory Aggregation Model**:
- A property defines room categories (e.g., Deluxe Room, Suite, Beachfront Villa).
- Each room type has a physical capacity count (`totalUnits: 12`).
- Day-to-day sellable capacity is tracked on the `roomInventory` collection per calendar date.
- This avoids unnecessary O(N) physical room entity churn while guaranteeing O(1) multi-day availability lookups and updates.

---

## 2. Collections & Schema

### 2.1 `roomTypes` Collection
- **Model**: `RoomTypeModel` (`server/src/modules/rooms/room-type.model.ts`)
- **Key Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Ref: `properties`)
  - `businessProfileId`: `ObjectId` (Ref: `businessProfiles`)
  - `accountId`: `ObjectId` (Ref: `accounts`)
  - `name`: `String` (2–100 chars)
  - `slug`: `String` (URL-safe, unique per property)
  - `description`: `String` (nullable)
  - `roomCategory`: `String` (`STANDARD`, `DELUXE`, `PREMIUM`, `SUITE`, `VILLA`, `STUDIO`, `DORMITORY`, `COTTAGE`, `OTHER`)
  - `maxAdults`: `Int32` ($\ge 1$)
  - `maxChildren`: `Int32` ($\ge 0$)
  - `maxOccupancy`: `Int32` ($\ge maxAdults$)
  - `bedConfiguration`: `String`
  - `bedCount`: `Int32` ($\ge 1$)
  - `roomSize`: `Double` (nullable)
  - `roomSizeUnit`: `String` (`SQ_FT`, `SQ_M`)
  - `facilities`: `Array<String>` (Enum values from `ROOM_FACILITIES`)
  - `basePrice`: `Int64` (Stored in integer **paise**, $1\text{ INR} = 100\text{ paise}$)
  - `currency`: `String` (Default `'INR'`)
  - `pricingUnit`: `String` (`PER_NIGHT`, `PER_DAY`)
  - `coverMediaId`: `ObjectId` (Ref: `media`, nullable)
  - `galleryMediaIds`: `Array<ObjectId>` (Ref: `media`)
  - `status`: `String` (`ACTIVE`, `INACTIVE`, `ARCHIVED`)
  - `totalUnits`: `Int32` (Physical units of this room type, $\ge 1$)
  - `createdAt`: `Date`
  - `updatedAt`: `Date`

- **Indexes**:
  - `_id_`: Default primary key
  - `idx_room_types_property_status`: `{ propertyId: 1, status: 1 }`
  - `idx_room_types_business_status`: `{ businessProfileId: 1, status: 1 }`
  - `idx_room_types_property_slug`: `{ propertyId: 1, slug: 1 }` (Unique, sparse)

---

### 2.2 `roomInventory` Collection
- **Model**: `RoomInventoryModel` (`server/src/modules/rooms/inventory.model.ts`)
- **Key Fields**:
  - `_id`: `ObjectId`
  - `propertyId`: `ObjectId` (Ref: `properties`)
  - `roomTypeId`: `ObjectId` (Ref: `roomTypes`)
  - `businessProfileId`: `ObjectId` (Ref: `businessProfiles`)
  - `date`: `Date` (Normalized UTC midnight representing calendar date in `Asia/Kolkata`)
  - `totalUnits`: `Int32` (Total configured capacity, $\ge 0$)
  - `availableUnits`: `Int32` (Sellable inventory: $totalUnits - blockedUnits - maintenanceUnits$)
  - `blockedUnits`: `Int32` (Host/VIP holds, $\ge 0$)
  - `maintenanceUnits`: `Int32` (Out of service units, $\ge 0$)
  - `createdAt`: `Date`
  - `updatedAt`: `Date`

- **Invariants**:
  - $availableUnits \ge 0$
  - $blockedUnits \ge 0$
  - $maintenanceUnits \ge 0$
  - $availableUnits + blockedUnits + maintenanceUnits \le totalUnits$
  - $availableUnits = totalUnits - blockedUnits - maintenanceUnits$

- **Indexes**:
  - `_id_`: Default primary key
  - `idx_room_inventory_room_date`: `{ roomTypeId: 1, date: 1 }` (Unique compound index)
  - `idx_room_inventory_property_date`: `{ propertyId: 1, date: 1 }`
  - `idx_room_inventory_business_date`: `{ businessProfileId: 1, date: 1 }`
  - `idx_room_inventory_lookup`: `{ roomTypeId: 1, date: 1, availableUnits: 1 }` (Covered index for public booking availability lookups)

---

## 3. Atomic Concurrency Mechanics

### 3.1 Conditional Maintenance / Hold Blocking
```mongodb
db.roomInventory.updateOne(
  {
    roomTypeId: ObjectId("..."),
    date: ISODate("2026-12-01T00:00:00Z"),
    availableUnits: { $gte: 2 }
  },
  {
    $inc: {
      maintenanceUnits: 2,
      availableUnits: -2
    }
  }
)
```
- If concurrent requests attempt to block more units than available, `matchedCount === 0`.
- The transaction fails closed with `409 Conflict` (`INSUFFICIENT_AVAILABLE_INVENTORY`).

### 3.2 Unblocking
```mongodb
db.roomInventory.updateOne(
  {
    roomTypeId: ObjectId("..."),
    date: ISODate("2026-12-01T00:00:00Z"),
    maintenanceUnits: { $gte: 2 }
  },
  {
    $inc: {
      maintenanceUnits: -2,
      availableUnits: 2
    }
  }
)
```
- Restores units to sellable inventory only if currently in maintenance.
