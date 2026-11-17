/**
 * Comprehensive Booking Details Screen
 */

import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BOOKING_STATUSES, THEME_COLORS } from '@kerala-tourism/constants';
import { BookingDto } from '@kerala-tourism/shared-types';
import { Header } from '../components/Header';
import { formatPaiseToInr, PriceBreakdownCard } from '../components/PriceBreakdownCard';
import { ErrorView, LoadingView } from '../components/StateViews';
import { StatusBadge } from '../components/StatusBadge';
import { useAppNavigation } from '../navigation/NavigationContext';
import { bookingService } from '../services/booking.service';

interface BookingDetailsScreenProps {
  bookingId: string;
}

export const BookingDetailsScreen: React.FC<BookingDetailsScreenProps> = ({ bookingId }) => {
  const { navigate, reset } = useAppNavigation();
  const [booking, setBooking] = useState<BookingDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadBooking = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await bookingService.getBooking(bookingId);
      setBooking(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load booking details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooking();
  }, [bookingId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Header title="Booking Details" />
        <LoadingView message="Loading booking details..." />
      </View>
    );
  }

  if (error || !booking) {
    return (
      <View style={styles.container}>
        <Header title="Booking Details" />
        <ErrorView message={error || 'Booking not found'} onRetry={loadBooking} />
      </View>
    );
  }

  const priceSnapshot = booking.priceSnapshot;
  const isPendingPayment = booking.status === BOOKING_STATUSES.AWAITING_PAYMENT;
  const isConfirmed = booking.status === BOOKING_STATUSES.CONFIRMED;

  return (
    <View style={styles.container}>
      <Header title="Booking Details" subtitle={booking.bookingReference} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Reference & Status Header Card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.labelMuted}>BOOKING REFERENCE</Text>
              <Text style={styles.refCode}>{booking.bookingReference}</Text>
            </View>
            <StatusBadge status={booking.status} />
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Check-In Date</Text>
            <Text style={styles.fieldValue}>{booking.checkInDate} (12:00 PM IST)</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Check-Out Date</Text>
            <Text style={styles.fieldValue}>{booking.checkOutDate} (11:00 AM IST)</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Stay Duration</Text>
            <Text style={styles.fieldValue}>
              {booking.nights} Night{booking.nights > 1 ? 's' : ''} ({booking.numberOfRooms} Room
              {booking.numberOfRooms > 1 ? 's' : ''})
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Guests</Text>
            <Text style={styles.fieldValue}>
              {booking.adults} Adults{booking.children ? `, ${booking.children} Children` : ''}
            </Text>
          </View>
        </View>

        {/* Primary Guest Details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Primary Guest Details</Text>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Name</Text>
            <Text style={styles.fieldValue}>{booking.guestDetails.primaryGuestName}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text style={styles.fieldValue}>{booking.guestDetails.email}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <Text style={styles.fieldValue}>{booking.guestDetails.phone}</Text>
          </View>

          {booking.guestDetails.specialRequests ? (
            <View style={styles.infoRow}>
              <Text style={styles.fieldLabel}>Special Requests</Text>
              <Text style={styles.fieldValue}>{booking.guestDetails.specialRequests}</Text>
            </View>
          ) : null}
        </View>

        {/* Payment Transaction Details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment Information</Text>

          <View style={styles.infoRow}>
            <Text style={styles.fieldLabel}>Payment Status</Text>
            <Text style={[styles.fieldValue, isConfirmed ? styles.paidText : null]}>
              {isConfirmed ? '✓ PAID & CAPTURED' : isPendingPayment ? 'PENDING' : 'NOT PAID'}
            </Text>
          </View>

          {booking.paymentReference ? (
            <View style={styles.infoRow}>
              <Text style={styles.fieldLabel}>Payment Reference</Text>
              <Text style={styles.monoValue}>{booking.paymentReference}</Text>
            </View>
          ) : null}

          {booking.paidAt ? (
            <View style={styles.infoRow}>
              <Text style={styles.fieldLabel}>Paid At</Text>
              <Text style={styles.fieldValue}>
                {new Date(booking.paidAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
              </Text>
            </View>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.totalLabel}>Total Reservation Amount</Text>
            <Text style={styles.totalValue}>{formatPaiseToInr(priceSnapshot.totalPaise)}</Text>
          </View>
        </View>

        {/* Price Breakdown Component */}
        <PriceBreakdownCard
          basePricePaise={priceSnapshot.basePricePaise}
          subtotalPaise={priceSnapshot.subtotalPaise}
          taxesPaise={priceSnapshot.taxesPaise}
          totalPaise={priceSnapshot.totalPaise}
          nights={booking.nights}
          numberOfRooms={booking.numberOfRooms}
          currency={priceSnapshot.currency}
        />

        {/* Action Button */}
        {isPendingPayment ? (
          <TouchableOpacity
            style={styles.actionBtnPrimary}
            onPress={() =>
              navigate('PaymentCheckout', {
                bookingId: booking.id,
                bookingReference: booking.bookingReference,
                holdId: booking.holdId || '',
                propertyName: 'Reserved Property',
                totalPaise: priceSnapshot.totalPaise,
                totalInr: priceSnapshot.totalInr,
              })
            }
          >
            <Text style={styles.actionBtnPrimaryText}>Resume Payment & Confirm</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actionBtnSecondary} onPress={() => reset('Explore')}>
            <Text style={styles.actionBtnSecondaryText}>Explore More Stays</Text>
          </TouchableOpacity>
        )}
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
  card: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  labelMuted: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
  },
  refCode: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 10,
  },
  divider: {
    height: 1,
    backgroundColor: THEME_COLORS.MUTED_BORDER,
    marginVertical: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  fieldValue: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME_COLORS.CHARCOAL,
  },
  monoValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369A1',
    fontFamily: 'monospace',
  },
  paidText: {
    color: THEME_COLORS.SUCCESS_GREEN,
    fontWeight: '700',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  actionBtnPrimary: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  actionBtnPrimaryText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  actionBtnSecondary: {
    backgroundColor: THEME_COLORS.WHITE,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  actionBtnSecondaryText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 14,
  },
});
