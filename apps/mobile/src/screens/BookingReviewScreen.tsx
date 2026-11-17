/**
 * Booking Review & Hold Confirmation Screen
 *
 * Displays live 15-minute countdown banner, authoritative price breakdown,
 * primary guest details form, and voluntary hold cancellation.
 */

import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import {
  CreateBookingHoldResponseDto,
  PublicRoomTypeDto,
} from '@kerala-tourism/shared-types';
import { GuestForm, GuestFormData, GuestFormErrors } from '../components/GuestForm';
import { Header } from '../components/Header';
import { HoldCountdownBanner } from '../components/HoldCountdownBanner';
import { PriceBreakdownCard } from '../components/PriceBreakdownCard';
import { useAuth } from '../context/AuthContext';
import { useBooking } from '../context/BookingContext';
import { useAppNavigation } from '../navigation/NavigationContext';

interface BookingReviewScreenProps {
  bookingHold: CreateBookingHoldResponseDto;
  propertyId: string;
  propertyName: string;
  roomType: PublicRoomTypeDto;
}

export const BookingReviewScreen: React.FC<BookingReviewScreenProps> = ({
  bookingHold,
  propertyId: _propertyId,
  propertyName,
  roomType,
}) => {
  const { navigate, goBack } = useAppNavigation();
  const { user } = useAuth();
  const { remainingSeconds, isHoldExpired, releaseHold } = useBooking();

  const booking = bookingHold.booking;
  const priceSnapshot = booking.priceSnapshot;

  const [guestData, setGuestData] = useState<GuestFormData>({
    primaryGuestName:
      user?.profile?.displayName ||
      `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim() ||
      'Rahul Varma',
    email: user?.email || 'tourist@example.com',
    phone: user?.profile?.phone || '9847012345',
    specialRequests: '',
  });

  const [formErrors, setFormErrors] = useState<GuestFormErrors>({});
  const [cancelling, setCancelling] = useState<boolean>(false);

  const handleFieldChange = (field: keyof GuestFormData, value: string) => {
    setGuestData((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateForm = (): boolean => {
    const errors: GuestFormErrors = {};
    if (!guestData.primaryGuestName || guestData.primaryGuestName.trim().length < 2) {
      errors.primaryGuestName = 'Primary guest name must be at least 2 characters';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!guestData.email || !emailRegex.test(guestData.email.trim())) {
      errors.email = 'Please enter a valid email address';
    }
    if (!guestData.phone || guestData.phone.trim().length < 10) {
      errors.phone = 'Mobile phone number must be at least 10 digits';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProceedToPayment = () => {
    if (isHoldExpired || remainingSeconds <= 0) {
      Alert.alert(
        'Hold Expired',
        'Your 15-minute inventory hold has expired. Please return to the property page to check current availability.',
        [{ text: 'OK', onPress: () => goBack() }],
      );
      return;
    }

    if (!validateForm()) {
      return;
    }

    navigate('PaymentCheckout', {
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      holdId: bookingHold.hold.id,
      propertyName,
      totalPaise: priceSnapshot.totalPaise,
      totalInr: priceSnapshot.totalInr,
    });
  };

  const handleCancelReservation = async () => {
    Alert.alert(
      'Release Hold?',
      'Are you sure you want to cancel this reservation? The held room will be immediately restored to public availability.',
      [
        { text: 'Keep Hold', style: 'cancel' },
        {
          text: 'Release Hold',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await releaseHold();
            } finally {
              setCancelling(false);
              goBack();
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Header title="Review & Confirm Hold" subtitle={booking.bookingReference} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Live Hold Expiry Banner */}
        <HoldCountdownBanner remainingSeconds={remainingSeconds} isExpired={isHoldExpired} />

        {/* Stay Summary Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.bookingRefLabel}>Booking Reference</Text>
          <Text style={styles.bookingRef}>{booking.bookingReference}</Text>

          <View style={styles.divider} />

          <Text style={styles.propName}>{propertyName}</Text>
          <Text style={styles.roomName}>{roomType.name}</Text>

          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>CHECK-IN</Text>
              <Text style={styles.metaVal}>{booking.checkInDate}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>CHECK-OUT</Text>
              <Text style={styles.metaVal}>{booking.checkOutDate}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>STAY DURATION</Text>
              <Text style={styles.metaVal}>
                {booking.nights} Night{booking.nights > 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>RESERVED</Text>
              <Text style={styles.metaVal}>
                {booking.numberOfRooms} Room{booking.numberOfRooms > 1 ? 's' : ''} ({booking.adults}A
                {booking.children ? `, ${booking.children}C` : ''})
              </Text>
            </View>
          </View>
        </View>

        {/* Guest Details Form */}
        <GuestForm data={guestData} errors={formErrors} onChange={handleFieldChange} />

        {/* Server Authoritative Price Breakdown */}
        <PriceBreakdownCard
          basePricePaise={priceSnapshot.basePricePaise}
          subtotalPaise={priceSnapshot.subtotalPaise}
          taxesPaise={priceSnapshot.taxesPaise}
          totalPaise={priceSnapshot.totalPaise}
          nights={booking.nights}
          numberOfRooms={booking.numberOfRooms}
          currency={priceSnapshot.currency}
        />

        {/* Actions */}
        <TouchableOpacity
          style={[styles.payButton, isHoldExpired || cancelling ? styles.btnDisabled : null]}
          onPress={handleProceedToPayment}
          disabled={isHoldExpired || cancelling}
        >
          <Text style={styles.payButtonText}>
            {isHoldExpired ? 'Hold Expired — Rebook' : 'Continue to Razorpay Checkout'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancelReservation}
          disabled={cancelling}
        >
          <Text style={styles.cancelButtonText}>
            {cancelling ? 'Releasing Room...' : 'Cancel Reservation & Release Hold'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F7F1',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryCard: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  bookingRefLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  bookingRef: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
    letterSpacing: 1,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: THEME_COLORS.MUTED_BORDER,
    marginVertical: 12,
  },
  propName: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
  },
  roomName: {
    fontSize: 14,
    color: THEME_COLORS.NATURE_GREEN,
    fontWeight: '600',
    marginTop: 2,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 12,
  },
  metaItem: {
    width: '46%',
    backgroundColor: '#FAFAF9',
    padding: 10,
    borderRadius: 8,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
  },
  metaVal: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginTop: 2,
  },
  payButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  payButtonText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: THEME_COLORS.ERROR_RED,
    fontWeight: '600',
    fontSize: 14,
  },
});
