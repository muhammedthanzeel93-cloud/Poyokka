# Razorpay Sandbox & Operational Setup Guide (Day 24)

## 1. Environment Variables Configuration

Add the following variables to `.env` (or production secret manager):

```env
# Razorpay Sandbox Credentials (Test Mode Only)
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=YourKeySecretHere32CharactersMin
RAZORPAY_WEBHOOK_SECRET=YourWebhookSecretHere32CharsMin
```

> [!CAUTION]
> **Production Safety Invariant**:
> Never configure live Razorpay credentials (`rzp_live_*`) in developer environments. The platform is currently configured for sandbox/test operations only.

---

## 2. Webhook Setup in Razorpay Dashboard

1. Navigate to **Razorpay Dashboard** ──► **Settings** ──► **Webhooks**.
2. Click **+ Add New Webhook**.
3. **Webhook URL**: `https://api.keralatourism.local/api/v1/webhooks/razorpay`
4. **Secret**: Enter the exact secret string defined in `RAZORPAY_WEBHOOK_SECRET`.
5. **Alert Email**: Enter system operations monitoring email.
6. **Active Events**:
   - `payment.captured`
   - `payment.failed`
   - `payment.authorized`

---

## 3. Test Payment Data (Sandbox Mode)

- **UPI / VPA**: `success@razorpay` (Simulates instant capture), `failure@razorpay` (Simulates card/UPI decline).
- **Cards**:
  - Test Card: `4111 1111 1111 1111`, Expiry: Any future date, CVV: `123`.
  - OTP for 3D Secure: Any 4-6 digit numeric code (e.g. `123456`).

---

## 4. Runbook: Handling Late-Payment Exceptions

When a transaction is captured after hold expiry, it appears with:
`reconciliationStatus: "FLAGGED_FOR_MANUAL_REVIEW"` and `failureCode: "LATE_PAYMENT_HOLD_EXPIRED"`.

**Operator Action**:
1. Check if the merchant has alternative rooms available for the requested stay dates.
2. If available: Operator contacts the merchant and reallocates room.
3. If not available: Operator triggers gateway refund via upcoming Day 25 refund module.
