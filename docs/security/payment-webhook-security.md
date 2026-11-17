# Payment & Webhook Security Architecture (Day 24)

## 1. Threat Modeling & Safeguards

| Threat Vector | Mitigation Strategy | Implemented Mechanism |
|---|---|---|
| **Price Tampering** | Client modifies amount, nights, or currency | Authoritative amounts are taken strictly from the server-persisted `priceSnapshot.totalPaise`. Client request bodies cannot set payment values. |
| **Broken Object Level Authorization (BOLA)** | Tourist A pays for or inspects Tourist B's booking | Strict `touristAccountId === req.user.id` check with 404 concealment for non-owned entities. |
| **Fake Payment Confirmation** | Client sends fake success callback without payment | Booking confirmation requires valid HMAC-SHA256 signature calculated with server's `RAZORPAY_KEY_SECRET`. |
| **Timing Attacks on Signatures** | Attacker analyzes byte-by-byte comparison timing | `crypto.timingSafeEqual` used for all signature and webhook verification comparisons. |
| **Webhook Replay Attacks** | Repeated delivery of captured webhook | Compound unique index `{ provider: 1, providerEventId: 1 }` on `paymentWebhookEvents`. Processed events return HTTP 200 immediately. |
| **Out-of-Order Webhook Downgrades** | Delayed failure webhook arrives after successful capture | Terminal state check: `CAPTURED` payments reject downward mutations to `FAILED`, `PENDING`, or `AUTHORIZED`. |
| **Credential & Secret Leaks** | Secrets exposed in frontend or client payloads | `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are never sent to clients. Only public `keyId` is shared in checkout DTO. |
| **Volumetric / Brute-Force Flooding** | Attacker floods payment or webhook endpoints | Dedicated rate limiters: `paymentInitiationRateLimiter` (30/15min), `paymentVerificationRateLimiter` (30/15min), `paymentWebhookRateLimiter` (120/min). |
| **Overbooking on Late Capture** | Payment completes after 15-minute hold expires | Late payment rule: hold remains expired, booking remains expired/cancelled, payment is flagged `FLAGGED_FOR_MANUAL_REVIEW`, inventory is not decremented. |

---

## 2. Raw Body Ingestion Architecture

Razorpay webhook verification calculates HMAC-SHA256 over the raw bytes of the incoming request:
```
HMAC_SHA256(rawBytes, RAZORPAY_WEBHOOK_SECRET) == x-razorpay-signature
```

To preserve exact byte representation without formatting alterations:
- `server/src/loaders/app.ts` configures `express.json` with a non-intrusive `verify` callback:
  ```typescript
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  ```
- The unmodified buffer `req.rawBody` is passed directly into `WebhookService.processRazorpayWebhook`, ensuring 100% cryptographic precision across all character sets.
