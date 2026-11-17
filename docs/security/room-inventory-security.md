# Room & Inventory Security Specification

## 1. Threat Modeling & Architectural Mitigations

### 1.1 Broken Object Level Authorization (BOLA / IDOR)
- **Threat**: A business attempts to inspect, modify, or archive room types or inventory belonging to another hospitality partner by manipulating `:propertyId` or `:roomTypeId`.
- **Mitigation**:
  1. The authenticated account ID is extracted exclusively from the cryptographically verified JWT payload (`req.user.id`).
  2. The service queries `BusinessProfileModel` for `accountId: req.user.id`.
  3. All property and room lookups cross-verify `property.businessProfileId === callerBusiness._id` and `room.businessProfileId === callerBusiness._id`.
  4. Non-matching queries fail closed with `404 Not Found` (`RESOURCE_NOT_FOUND`), preventing existence enumeration or identity leakage across competitors.

### 1.2 Inventory Race Conditions & Negative Overbooking
- **Threat**: Concurrent requests to block dates, hold rooms, or configure inventory could interleave non-atomically, causing negative available inventory ($availableUnits < 0$) or exceeding total physical capacity.
- **Mitigation**:
  1. Atomic MongoDB conditional updates:
     ```mongodb
     db.roomInventory.updateOne(
       { roomTypeId, date, availableUnits: { $gte: unitsToBlock } },
       { $inc: { maintenanceUnits: unitsToBlock, availableUnits: -unitsToBlock } }
     )
     ```
  2. If `matchedCount === 0`, the transaction aborts and returns `409 Conflict` (`INSUFFICIENT_AVAILABLE_INVENTORY`).
  3. Mongoose schema validator enforces $availableUnits + blockedUnits + maintenanceUnits \le totalUnits$.

### 1.3 Privilege Escalation & Unverified Businesses
- **Threat**: An unverified business or tourist attempts to publish rooms or set live inventory.
- **Mitigation**:
  - `requireActiveAccount`: Ensures `status === ACTIVE`.
  - `requireAccountType(ACCOUNT_TYPES.BUSINESS)`: Enforces business account type.
  - `requireVerifiedBusiness`: Asserts `verificationStatus === VERIFIED`.
  - Domain eligibility check: Only businesses in `ELIGIBLE_PROPERTY_BUSINESS_TYPES` (`HOTEL`, `RESORT`, `HOMESTAY`, `OTHER`) are allowed to perform room operations.

### 1.4 ReDoS & Parameter Tampering
- **Threat**: Evil regex inputs in query params or unbounded date ranges could freeze event loops or consume massive server memory.
- **Mitigation**:
  - `ROOM_RULES.MAX_INVENTORY_RANGE_DAYS = 180`: Restricts date range queries to 180 days.
  - `ROOM_RULES.MAX_STAY_NIGHTS = 30`: Restricts stay duration queries to 30 nights.
  - `parseCalendarDate`: Validates strictly formatted `YYYY-MM-DD` strings.
  - `escapeRegex`: Escapes regex metacharacters in search queries.

---

## 2. Audit Trail
All business mutations generate immutable audit logs through `AuditLogService.recordAdminAction`:
- `ROOM_TYPE_CREATED`
- `ROOM_TYPE_UPDATED`
- `ROOM_TYPE_ARCHIVED`
- `INVENTORY_CONFIGURED`
- `INVENTORY_ADJUSTED`
- `DATES_BLOCKED`
- `DATES_UNBLOCKED`

All logs record actor account ID, account type `BUSINESS`, target entity, before/after snapshots, sanitized reasons, IP address, and user agent.
