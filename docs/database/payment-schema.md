# Payment Database Schema & Indexing Strategy (Collections 39 & 40)

## 1. Collection 39: `payments`

Tracks all internal financial transaction records and provider gateway references.

```typescript
export interface IPaymentDocument extends Document {
  _id: Types.ObjectId;
  paymentReference: string;           // Unique reference: PAY-YYYYMMDD-XXXXXX
  bookingId: Types.ObjectId;          // Foreign Key -> bookings._id
  holdId: Types.ObjectId;             // Foreign Key -> inventoryHolds._id
  touristAccountId: Types.ObjectId;   // Foreign Key -> accounts._id
  businessProfileId: Types.ObjectId;  // Foreign Key -> businessProfiles._id
  provider: 'RAZORPAY';              // Payment Gateway Provider
  providerOrderId?: string | null;    // Provider order ID (e.g. order_XXXXX)
  providerPaymentId?: string | null;  // Provider payment ID (e.g. pay_XXXXX)
  amountPaise: number;                // Integer paise (1 INR = 100 paise)
  currency: string;                   // 'INR'
  status: PaymentStatus;              // CREATED | PENDING | AUTHORIZED | CAPTURED | FAILED | CANCELLED | REFUND_PENDING | REFUNDED
  failureCode?: string | null;        // Gateway error code
  failureDescription?: string | null; // Sanitized gateway error description
  reconciliationStatus?: string | null; // FLAGGED_FOR_MANUAL_REVIEW
  paidAt?: Date | null;               // Timestamp of verified payment
  createdAt: Date;
  updatedAt: Date;
}
```

### Indexes for `payments`:
- `{ paymentReference: 1 }` (unique, sparse: false) — Ensures internal reference uniqueness.
- `{ bookingId: 1, createdAt: -1 }` — Enables efficient lookups of payment attempts per reservation.
- `{ touristAccountId: 1, createdAt: -1 }` — Scopes tourist payment history and ownership queries.
- `{ provider: 1, providerOrderId: 1 }` — Fast lookup during webhook ingestion and verification.
- `{ provider: 1, providerPaymentId: 1 }` — Fast lookup by provider transaction ID.
- `{ status: 1 }` — Administrative reconciliation and filtering.

---

## 2. Collection 40: `paymentWebhookEvents`

Stores ingested webhook notifications to guarantee idempotent event deduplication and cryptographic audit trails.

```typescript
export interface IPaymentWebhookEventDocument extends Document {
  _id: Types.ObjectId;
  provider: 'RAZORPAY';
  providerEventId: string;            // Provider event ID (e.g. evt_XXXXX)
  eventType: string;                  // e.g. payment.captured, payment.failed
  paymentId?: Types.ObjectId | null;  // Matched internal payment ID
  providerPaymentId?: string | null;  // e.g. pay_XXXXX
  providerOrderId?: string | null;    // e.g. order_XXXXX
  payloadHash: string;                // SHA-256 hash of raw incoming request body
  processingStatus: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';
  receivedAt: Date;
  processedAt?: Date | null;
  failureCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Indexes for `paymentWebhookEvents`:
- `{ provider: 1, providerEventId: 1 }` (unique) — Eliminates duplicate webhook processing.
- `{ processingStatus: 1, receivedAt: 1 }` — Worker queries for failed/unprocessed events.
- `{ providerPaymentId: 1 }` — Historical lookup by payment reference.
- `{ createdAt: 1 }` with `expireAfterSeconds: 2592000` (30 days) — Automatic TTL storage pruning.
