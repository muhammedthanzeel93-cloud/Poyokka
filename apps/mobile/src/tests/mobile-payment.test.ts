/**
 * Mobile Payment Lifecycle, Razorpay Adapter & Recovery Suite
 */

import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import { authService } from '../services/auth.service';
import { paymentService } from '../services/payment.service';
import { razorpayAdapter, RazorpayCheckoutError } from '../services/razorpay.adapter';

describe('Mobile Payment Lifecycle & Razorpay Adapter Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    razorpayAdapter.setMockHandler(null);
    authService.setSessionForTesting('valid_tourist_jwt', {
      id: 'acc_tourist_1',
      email: 'tourist@example.com',
      accountType: 'TOURIST',
      status: 'ACTIVE',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    razorpayAdapter.setMockHandler(null);
  });

  test('1. Payment Initiation - Receives Safe Checkout Data with Zero Secrets', async () => {
    global.fetch = async (url: any) => {
      assert.match(String(url), /\/api\/v1\/tourist\/bookings\/book_123\/payments/);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          data: {
            payment: {
              id: 'pay_rec_001',
              paymentReference: 'PAY-20261117-9A1B2C',
              bookingId: 'book_123',
              amountPaise: 1008000,
              currency: 'INR',
              status: 'CREATED',
            },
            checkoutData: {
              keyId: 'rzp_test_public_key_123',
              orderId: 'order_O8x9y7z6a5b4c3',
              amountPaise: 1008000,
              currency: 'INR',
              businessName: 'Kerala Tourism Stay',
              description: 'Booking KL-B2C4-9988',
              prefill: {
                name: 'Anand Kumar',
                email: 'anand@example.com',
                contact: '9847123456',
              },
              notes: { bookingId: 'book_123' },
            },
          },
        }),
      } as any;
    };

    const res = await paymentService.initiatePayment('book_123');
    assert.equal(res.payment.paymentReference, 'PAY-20261117-9A1B2C');
    assert.equal(res.checkoutData.keyId, 'rzp_test_public_key_123');
    assert.equal(res.checkoutData.amountPaise, 1008000);
    // Secret keys or webhook secrets must never exist
    assert.equal((res.checkoutData as any).keySecret, undefined);
    assert.equal((res.checkoutData as any).webhookSecret, undefined);
  });

  test('2. Razorpay Checkout Cancellation - Throws PAYMENT_CANCELLED Error', async () => {
    razorpayAdapter.setMockHandler(async () => {
      throw new RazorpayCheckoutError('User cancelled transaction', 'PAYMENT_CANCELLED');
    });

    await assert.rejects(
      async () => {
        await paymentService.launchCheckout({
          keyId: 'rzp_test_123',
          orderId: 'order_123',
          amountPaise: 100000,
          currency: 'INR',
          businessName: 'Test',
          description: 'Test',
          prefill: { name: 'A', email: 'a@b.com', contact: '1234567890' },
          notes: {},
        });
      },
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_CANCELLED');
        assert.match(err.message, /cancelled/i);
        return true;
      },
    );
  });

  test('3. Successful Verification - Backend Commits Booking Confirmation Atomically', async () => {
    let verificationPayload: any = null;

    global.fetch = async (url: any, init: any) => {
      assert.match(String(url), /\/api\/v1\/tourist\/payments\/verify/);
      verificationPayload = JSON.parse(init.body);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            payment: {
              id: 'pay_rec_001',
              status: 'CAPTURED',
              paidAt: new Date().toISOString(),
              paymentReference: 'PAY-20261117-9A1B2C',
            },
            booking: {
              id: 'book_123',
              bookingReference: 'KL-B2C4-9988',
              status: 'CONFIRMED',
              paidAt: new Date().toISOString(),
              confirmedAt: new Date().toISOString(),
            },
            isConfirmed: true,
            message: 'Payment verified and booking confirmed successfully',
          },
        }),
      } as any;
    };

    const result = await paymentService.verifyPayment('pay_rec_001', {
      razorpay_order_id: 'order_O8x9y7z6a5b4c3',
      razorpay_payment_id: 'pay_P1q2w3e4r5t6y7',
      razorpay_signature: 'test_hmac_sha256_sig',
    });

    assert.equal(verificationPayload.paymentId, 'pay_rec_001');
    assert.equal(verificationPayload.razorpay_payment_id, 'pay_P1q2w3e4r5t6y7');
    assert.equal(result.isConfirmed, true);
    assert.equal(result.booking.status, 'CONFIRMED');
    assert.equal(result.payment.status, 'CAPTURED');
  });

  test('4. Critical Late Payment - Hold Expired Flags for Reconciliation Without Overbooking', async () => {
    global.fetch = async (url: any) => {
      assert.match(String(url), /\/api\/v1\/tourist\/payments\/verify/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            payment: {
              id: 'pay_rec_late',
              status: 'CAPTURED',
              reconciliationStatus: 'FLAGGED_FOR_MANUAL_REVIEW',
              failureCode: 'LATE_PAYMENT_HOLD_EXPIRED',
            },
            booking: {
              id: 'book_expired',
              status: 'EXPIRED',
            },
            isConfirmed: false,
            message: 'Payment captured but booking hold expired. Flagged for manual review.',
          },
        }),
      } as any;
    };

    const result = await paymentService.verifyPayment('pay_rec_late', {
      razorpay_order_id: 'order_late',
      razorpay_payment_id: 'pay_late',
      razorpay_signature: 'sig_late',
    });

    assert.equal(result.isConfirmed, false, 'Booking must never be marked confirmed for late payment');
    assert.equal(result.booking.status, 'EXPIRED');
    assert.equal(result.payment.reconciliationStatus, 'FLAGGED_FOR_MANUAL_REVIEW');
  });

  test('5. Payment Status Recovery - Reconnects Interrupted Flow With Authoritative Backend State', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tourist/bookings/book_123')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { id: 'book_123', status: 'CONFIRMED', bookingReference: 'KL-RECOVER-99' },
          }),
        } as any;
      }
      if (urlStr.includes('/api/v1/tourist/payments/pay_123')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { id: 'pay_123', status: 'CAPTURED', paymentReference: 'PAY-RECOVER-123' },
          }),
        } as any;
      }
      throw new Error(`Unexpected url: ${urlStr}`);
    };

    const recovery = await paymentService.recoverPaymentStatus('book_123', 'pay_123');
    assert.equal(recovery.booking.status, 'CONFIRMED');
    assert.equal(recovery.payment?.status, 'CAPTURED');
    assert.equal(recovery.payment?.paymentReference, 'PAY-RECOVER-123');
  });
});
