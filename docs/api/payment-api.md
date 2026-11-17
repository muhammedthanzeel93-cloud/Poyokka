# Payment & Webhook API Reference (Day 24)

## Base URLs
- Tourist Payment Endpoints: `/api/v1/tourist`
- Webhook Endpoints: `/api/v1/webhooks`
- Legacy Health/Module Probe: `/api/v1/payments`

---

## 1. Initiate Payment Order
Initiates an internal payment record and generates a public Razorpay checkout order for an active booking.

- **Route**: `POST /api/v1/tourist/bookings/:bookingId/payments`
- **Auth**: Required (`TOURIST`, `ACTIVE`)
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Idempotency-Key: <uuid>` (Optional, 24h caching)
- **Response**: `201 Created`
```json
{
  "success": true,
  "message": "Payment order initiated successfully",
  "data": {
    "payment": {
      "id": "673752e5058a98f1d2c10001",
      "paymentReference": "PAY-20261117-9A1B2C",
      "bookingId": "673752e5058a98f1d2c10002",
      "holdId": "673752e5058a98f1d2c10003",
      "touristAccountId": "673752e5058a98f1d2c10004",
      "businessProfileId": "673752e5058a98f1d2c10005",
      "provider": "RAZORPAY",
      "providerOrderId": "order_O8x9y7z6a5b4c3",
      "providerPaymentId": null,
      "amountPaise": 1500000,
      "amountInr": 15000,
      "currency": "INR",
      "status": "PENDING",
      "failureCode": null,
      "failureDescription": null,
      "reconciliationStatus": null,
      "paidAt": null,
      "createdAt": "2026-11-17T09:00:00.000Z",
      "updatedAt": "2026-11-17T09:00:00.000Z"
    },
    "checkoutData": {
      "keyId": "rzp_test_placeholder_key_id",
      "orderId": "order_O8x9y7z6a5b4c3",
      "amountPaise": 1500000,
      "currency": "INR",
      "businessName": "Wayanad Rainforest Retreat",
      "description": "Booking Reservation #BKG-20261120-TEST01",
      "prefill": {
        "name": "Aarav Patel",
        "email": "aarav.patel@example.com",
        "contact": "+919876543210"
      },
      "notes": {
        "bookingId": "673752e5058a98f1d2c10002",
        "paymentReference": "PAY-20261117-9A1B2C"
      }
    }
  }
}
```

---

## 2. Verify Payment Signature & Confirm Booking
Verifies Razorpay HMAC-SHA256 signature and executes atomic confirmation.

- **Route**: `POST /api/v1/tourist/payments/verify`
- **Auth**: Required (`TOURIST`, `ACTIVE`)
- **Headers**:
  - `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "paymentId": "673752e5058a98f1d2c10001",
  "razorpay_order_id": "order_O8x9y7z6a5b4c3",
  "razorpay_payment_id": "pay_P1q2w3e4r5t6y7",
  "razorpay_signature": "4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c"
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Payment verified successfully and booking confirmed",
  "data": {
    "payment": {
      "id": "673752e5058a98f1d2c10001",
      "status": "CAPTURED",
      "providerPaymentId": "pay_P1q2w3e4r5t6y7",
      "paidAt": "2026-11-17T09:05:00.000Z"
    },
    "booking": {
      "id": "673752e5058a98f1d2c10002",
      "status": "CONFIRMED",
      "confirmedAt": "2026-11-17T09:05:00.000Z",
      "paymentId": "673752e5058a98f1d2c10001",
      "paymentReference": "PAY-20261117-9A1B2C"
    },
    "isConfirmed": true,
    "message": "Payment verified successfully and booking confirmed"
  }
}
```

---

## 3. Ingest Razorpay Webhook
Public webhook endpoint for asynchronous gateway notifications.

- **Route**: `POST /api/v1/webhooks/razorpay`
- **Auth**: Public (HMAC-SHA256 signature header verified)
- **Headers**:
  - `x-razorpay-signature: <hex>` (Required)
  - `x-razorpay-event-id: <string>` (Optional)
  - `content-type: application/json`
- **Supported Events**:
  - `payment.captured`
  - `payment.failed`
  - `payment.authorized`
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Webhook processed successfully",
  "data": {
    "received": true,
    "event": "payment.captured",
    "eventId": "evt_O9x8y7z6a5b4c3",
    "status": "PROCESSED"
  }
}
```

---

## 4. Retrieve Payment Details
- **Route**: `GET /api/v1/tourist/payments/:paymentId`
- **Auth**: Required (`TOURIST`)
- **Response**: `200 OK` (404 Concealment if owned by another tourist)

---

## 5. Retrieve Payment by Booking ID
- **Route**: `GET /api/v1/tourist/bookings/:bookingId/payment`
- **Auth**: Required (`TOURIST`)
- **Response**: `200 OK` (404 Concealment if owned by another tourist)
