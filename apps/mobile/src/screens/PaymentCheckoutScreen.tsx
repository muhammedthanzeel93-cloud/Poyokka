/**
 * Razorpay Mobile Payment Checkout & Verification Screen
 *
 * Initiates payment with backend, launches Razorpay mobile interface,
 * submits signature verification to POST /api/v1/tourist/payments/verify,
 * and recovers authoritative status in case of network interruptions.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { Header } from '../components/Header';
import { formatPaiseToInr } from '../components/PriceBreakdownCard';
import { useBooking } from '../context/BookingContext';
import { useAppNavigation } from '../navigation/NavigationContext';
import { paymentService } from '../services/payment.service';

interface PaymentCheckoutScreenProps {
  bookingId: string;
  bookingReference: string;
  holdId: string;
  propertyName: string;
  totalPaise: number;
  totalInr: number;
}

type CheckoutPhase =
  | 'INITIALIZING'
  | 'READY_TO_PAY'
  | 'AWAITING_SDK'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'CANCELLED'
  | 'ERROR';

export const PaymentCheckoutScreen: React.FC<PaymentCheckoutScreenProps> = ({
  bookingId,
  bookingReference,
  holdId: _holdId,
  propertyName,
  totalPaise,
  totalInr: _totalInr,
}) => {
  const { navigate, replace } = useAppNavigation();
  const { isHoldExpired, clearBookingState } = useBooking();

  const [phase, setPhase] = useState<CheckoutPhase>('INITIALIZING');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [checkoutData, setCheckoutData] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize payment order on backend
  const initPayment = async () => {
    setPhase('INITIALIZING');
    setErrorMessage(null);

    try {
      const res = await paymentService.initiatePayment(bookingId);
      setPaymentId(res.payment.id);
      setCheckoutData(res.checkoutData);
      setPhase('READY_TO_PAY');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not initiate payment session');
      setPhase('ERROR');
    }
  };

  useEffect(() => {
    initPayment();
  }, [bookingId]);

  // Launch Razorpay SDK
  const handleLaunchPayment = async () => {
    if (!checkoutData || !paymentId) return;

    if (isHoldExpired) {
      Alert.alert(
        'Hold Expired',
        'Your inventory hold expired before payment was started. Please return and check availability again.',
      );
      return;
    }

    setPhase('AWAITING_SDK');
    setErrorMessage(null);

    try {
      // 1. Launch Razorpay Mobile Checkout
      const razorpayResult = await paymentService.launchCheckout(checkoutData);

      // 2. Submit credentials for backend verification
      setPhase('VERIFYING');
      const verifyResult = await paymentService.verifyPayment(paymentId, razorpayResult);

      if (verifyResult.isConfirmed) {
        setPhase('SUCCESS');
        clearBookingState();
        replace('BookingConfirmation', {
          booking: verifyResult.booking,
          propertyName,
          paymentReference: verifyResult.payment.paymentReference,
        });
      } else {
        // Late payment or reconciliation required
        Alert.alert(
          'Booking Under Review',
          verifyResult.message ||
            'Payment was processed but booking confirmation is pending manual review.',
          [
            {
              text: 'View History',
              onPress: () => navigate('BookingHistory'),
            },
          ],
        );
      }
    } catch (err: any) {
      if (err?.code === 'PAYMENT_CANCELLED') {
        setPhase('CANCELLED');
        setErrorMessage('Payment was cancelled. Your hold is still active.');
      } else {
        setPhase('ERROR');
        setErrorMessage(err?.message || 'Payment processing failed');
      }
    }
  };

  // Recovery: check authoritative backend payment status if app disconnected
  const handleCheckStatus = async () => {
    setPhase('VERIFYING');
    try {
      const recovery = await paymentService.recoverPaymentStatus(bookingId, paymentId || undefined);
      if (recovery.booking.status === 'CONFIRMED') {
        setPhase('SUCCESS');
        clearBookingState();
        replace('BookingConfirmation', {
          booking: recovery.booking,
          propertyName,
          paymentReference: recovery.payment?.paymentReference,
        });
      } else {
        setPhase('READY_TO_PAY');
        Alert.alert(
          'Payment Status',
          `Booking status is currently ${recovery.booking.status}. Payment has not been finalized yet.`,
        );
      }
    } catch (err: any) {
      setPhase('ERROR');
      setErrorMessage(err?.message || 'Unable to verify payment status with server');
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Secure Payment" subtitle={bookingReference} />

      <View style={styles.content}>
        {/* Payment Summary Box */}
        <View style={styles.summaryBox}>
          <Text style={styles.shieldIcon}>🔒</Text>
          <Text style={styles.amountLabel}>Total Amount Due</Text>
          <Text style={styles.amountValue}>{formatPaiseToInr(totalPaise)}</Text>
          <Text style={styles.gatewayNotice}>
            Secured by Razorpay • 256-Bit SSL Encryption • PCI-DSS Compliant
          </Text>
        </View>

        {/* Phase State Views */}
        {phase === 'INITIALIZING' ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={THEME_COLORS.FOREST_GREEN} />
            <Text style={styles.stateText}>Setting up secure Razorpay order...</Text>
          </View>
        ) : null}

        {phase === 'AWAITING_SDK' ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={THEME_COLORS.FOREST_GREEN} />
            <Text style={styles.stateText}>Awaiting Razorpay checkout response...</Text>
            <Text style={styles.stateSub}>Please complete your transaction in the payment window</Text>
          </View>
        ) : null}

        {phase === 'VERIFYING' ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={THEME_COLORS.FOREST_GREEN} />
            <Text style={styles.stateText}>Authorizing payment & confirming room...</Text>
            <Text style={styles.stateSub}>Validating cryptographic signature with backend</Text>
          </View>
        ) : null}

        {phase === 'READY_TO_PAY' || phase === 'CANCELLED' ? (
          <View style={styles.actionSection}>
            {phase === 'CANCELLED' && errorMessage ? (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>⚠️ {errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.payNowButton} onPress={handleLaunchPayment}>
              <Text style={styles.payNowText}>
                Pay {formatPaiseToInr(totalPaise)} with Razorpay
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={handleCheckStatus}>
              <Text style={styles.secondaryButtonText}>Check Payment Status</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === 'ERROR' ? (
          <View style={styles.errorSection}>
            <View style={styles.errorBanner}>
              <Text style={styles.errorTitle}>Payment Error</Text>
              <Text style={styles.errorDescription}>{errorMessage}</Text>
            </View>

            <TouchableOpacity style={styles.payNowButton} onPress={handleLaunchPayment}>
              <Text style={styles.payNowText}>Retry Payment</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={handleCheckStatus}>
              <Text style={styles.secondaryButtonText}>Verify With Server</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F7F1',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  summaryBox: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    marginTop: 10,
  },
  shieldIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  amountLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amountValue: {
    fontSize: 32,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
    marginVertical: 6,
  },
  gatewayNotice: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
  },
  centerState: {
    alignItems: 'center',
    padding: 20,
  },
  stateText: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginTop: 14,
    textAlign: 'center',
  },
  stateSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
  actionSection: {
    gap: 12,
    marginBottom: 20,
  },
  warningBanner: {
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME_COLORS.WARNING_AMBER,
    marginBottom: 6,
  },
  warningText: {
    fontSize: 13,
    color: '#B45309',
    fontWeight: '600',
    textAlign: 'center',
  },
  payNowButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME_COLORS.FOREST_GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  payNowText: {
    color: THEME_COLORS.WHITE,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#E2E8F0',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  errorSection: {
    gap: 12,
    marginBottom: 20,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME_COLORS.ERROR_RED,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.ERROR_RED,
    marginBottom: 4,
  },
  errorDescription: {
    fontSize: 13,
    color: '#991B1B',
    lineHeight: 18,
  },
});
