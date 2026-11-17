/**
 * Mobile Payment Lifecycle Service
 *
 * Coordinates payment creation, Razorpay checkout launch,
 * cryptographic verification, and state recovery.
 */

import {
  BookingDto,
  PaymentDto,
  RazorpayCheckoutDataDto,
} from '@kerala-tourism/shared-types';
import { api } from './api';
import {
  razorpayAdapter,
  RazorpaySuccessResponse,
} from './razorpay.adapter';

export interface PaymentFlowResult {
  payment: PaymentDto;
  booking: BookingDto;
  isConfirmed: boolean;
  message: string;
}

export class PaymentService {
  /**
   * Initiates payment order on backend for the given booking
   */
  public async initiatePayment(
    bookingId: string,
    idempotencyKey?: string,
  ): Promise<{ payment: PaymentDto; checkoutData: RazorpayCheckoutDataDto }> {
    const res = await api.payments.createPayment(bookingId, idempotencyKey);
    return res.data;
  }

  /**
   * Launches Razorpay checkout interface with backend checkout data
   */
  public async launchCheckout(
    checkoutData: RazorpayCheckoutDataDto,
  ): Promise<RazorpaySuccessResponse> {
    return razorpayAdapter.open({
      keyId: checkoutData.keyId,
      orderId: checkoutData.orderId,
      amountPaise: checkoutData.amountPaise,
      currency: checkoutData.currency,
      name: checkoutData.businessName,
      description: checkoutData.description,
      prefill: checkoutData.prefill,
      notes: checkoutData.notes,
      themeColor: '#145C43',
    });
  }

  /**
   * Submits checkout credentials to backend verification endpoint
   */
  public async verifyPayment(
    paymentId: string,
    razorpayResult: RazorpaySuccessResponse,
  ): Promise<PaymentFlowResult> {
    const res = await api.payments.verifyPayment({
      paymentId,
      razorpay_order_id: razorpayResult.razorpay_order_id,
      razorpay_payment_id: razorpayResult.razorpay_payment_id,
      razorpay_signature: razorpayResult.razorpay_signature,
    });
    return res.data;
  }

  /**
   * Full end-to-end checkout orchestration:
   * 1. Creates payment & order on backend
   * 2. Launches Razorpay SDK
   * 3. Submits verification to backend
   * 4. Returns authoritative confirmed booking
   */
  public async executeBookingCheckout(
    bookingId: string,
    idempotencyKey?: string,
  ): Promise<PaymentFlowResult> {
    // 1. Initiate backend payment
    const { payment, checkoutData } = await this.initiatePayment(bookingId, idempotencyKey);

    // 2. Launch mobile checkout
    const razorpayResult = await this.launchCheckout(checkoutData);

    // 3. Verify signature on backend
    return this.verifyPayment(payment.id, razorpayResult);
  }

  /**
   * Recovery helper: fetches authoritative payment and booking status
   * when an app interruption or network disconnect occurs post-checkout.
   */
  public async recoverPaymentStatus(
    bookingId: string,
    paymentId?: string,
  ): Promise<{ booking: BookingDto; payment: PaymentDto | null }> {
    const bookingRes = await api.bookings.getById(bookingId);
    let payment: PaymentDto | null = null;

    if (paymentId) {
      try {
        const paymentRes = await api.payments.getById(paymentId);
        payment = paymentRes.data;
      } catch {
        // Fall back to querying by booking ID
      }
    }

    if (!payment) {
      try {
        const paymentRes = await api.payments.getByBookingId(bookingId);
        payment = paymentRes.data;
      } catch {
        payment = null;
      }
    }

    return {
      booking: bookingRes.data,
      payment,
    };
  }
}

export const paymentService = new PaymentService();
