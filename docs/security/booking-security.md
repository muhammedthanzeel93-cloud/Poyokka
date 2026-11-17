# Booking Engine Security & Fraud Mitigation

## 1. Threat Analysis & Mitigations

### 1.1 Denial-of-Inventory / Hoarding Attacks
- **Threat**: Bad actors or competing properties rapidly initiate booking holds without intending to pay, exhausting all inventory for popular resorts during peak seasons.
- **Mitigations**:
  1. **Strict Rate Limiting**: Dedicated `bookingHoldRateLimiter` enforces a maximum of 30 hold attempts per 15-minute window per authenticated tourist / IP.
  2. **Short 15-Minute Hold Window**: Unpaid holds automatically expire in 15 minutes.
  3. **Autonomous Background Worker**: `BookingHoldExpiryService` continuously scans and restores inventory for expired holds in real-time.
  4. **Account & Role Verification**: Unauthenticated users or non-tourist accounts cannot acquire holds (`requireActiveAccount` + `requireAccountType(ACCOUNT_TYPES.TOURIST)`).

### 1.2 Race Conditions & Double-Booking
- **Threat**: Two tourists click "Book" simultaneously for the last remaining villa, leading to overbooking.
- **Mitigation**:
  1. **Conditional Update**: Database updates query `{ availableUnits: { $gte: numberOfRooms } }` and atomically decrement `$inc: { availableUnits: -numberOfRooms }`.
  2. **MongoDB ACID Transactions**: If any single stay date fails to match, the multi-document transaction aborts and all decrements are rolled back.
  3. **Strict Optimistic Locking**: No dirty reads or non-atomic inventory adjustments.

### 1.3 Price Tampering & Injection
- **Threat**: Malicious clients attempt to submit manipulated room rates, taxes, or currency in request payloads.
- **Mitigation**:
  1. **Zero Client Price Trust**: Client-supplied prices or currency are strictly rejected by the Zod schema (`strict()` mode).
  2. **Server-Side Integer Paise Calculation**: Room base price is fetched directly from the verified database record in integer paise.
  3. **Immutable Price Snapshot**: The final calculated price breakdown is snapshotted into the booking document for immutable auditability and downstream payment settlement.

### 1.4 Network Retries & Double Charge (Idempotency)
- **Threat**: Network timeouts cause the tourist client to retry the hold creation request, creating duplicate reservations and double deductions.
- **Mitigation**:
  1. **Idempotency-Key Header**: Clients provide a unique key for hold creation.
  2. **SHA-256 Payload Validation**: If the same key is reused with an identical payload, the cached response is returned immediately. If the payload differs, a `409 Conflict` is returned.
  3. **Scoped Compound Unique Index**: `{ touristAccountId: 1, key: 1 }` prevents cross-user key collision.
  4. **24-Hour TTL**: Idempotency records are automatically cleaned up after 24 hours.

### 1.5 Audit Trail & Observability
- All hold actions (`BOOKING_HOLD_CREATED`, `BOOKING_HOLD_RELEASED`, `BOOKING_HOLD_EXPIRED`) are permanently recorded in the immutable audit log (`AuditLogModel`) with before and after state diffs, user IDs, and timestamps.
