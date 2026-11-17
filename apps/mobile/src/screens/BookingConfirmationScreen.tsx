/**
 * Booking Confirmation Screen
 *
 * Displays celebratory confirmation badge, booking reference,
 * property details, and navigation to Booking History.
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { BookingDto } from '@kerala-tourism/shared-types';
import { Header } from '../components/Header';
import { formatPaiseToInr } from '../components/PriceBreakdownCard';
import { StatusBadge } from '../components/StatusBadge';
import { useAppNavigation } from '../navigation/NavigationContext';

interface BookingConfirmationScreenProps {
  booking: BookingDto;
  propertyName: string;
  paymentReference?: string;
}

export const BookingConfirmationScreen: React.FC<BookingConfirmationScreenProps> = ({
  booking,
  propertyName,
  paymentReference,
}) => {
  const { navigate, reset } = useAppNavigation();

  return (
    <View style={styles.container}>
      <Header title="Reservation Confirmed" showBack={false} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Success Hero Badge */}
        <View style={styles.heroCard}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkIcon}>✓</Text>
          </View>
          <Text style={styles.heroTitle}>Room Confirmed!</Text>
          <Text style={styles.heroSubtitle}>
            Your reservation at {propertyName} has been successfully paid and confirmed.
          </Text>
        </View>

        {/* Confirmation Details Card */}
        <View style={styles.detailsCard}>
          <View style={styles.refRow}>
            <View>
              <Text style={styles.refLabel}>BOOKING REFERENCE</Text>
              <Text style={styles.refValue}>{booking.bookingReference}</Text>
            </View>
            <StatusBadge status={booking.status} />
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.label}>Property</Text>
            <Text style={styles.value}>{propertyName}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.label}>Check-In Date</Text>
            <Text style={styles.value}>{booking.checkInDate}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.label}>Check-Out Date</Text>
            <Text style={styles.value}>{booking.checkOutDate}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.label}>Stay Duration</Text>
            <Text style={styles.value}>
              {booking.nights} Night{booking.nights > 1 ? 's' : ''} ({booking.numberOfRooms} Room
              {booking.numberOfRooms > 1 ? 's' : ''})
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.label}>Primary Guest</Text>
            <Text style={styles.value}>{booking.guestDetails.primaryGuestName}</Text>
          </View>

          {paymentReference ? (
            <View style={styles.detailRow}>
              <Text style={styles.label}>Payment Reference</Text>
              <Text style={styles.valueMono}>{paymentReference}</Text>
            </View>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.totalLabel}>Total Amount Paid</Text>
            <Text style={styles.totalValue}>
              {formatPaiseToInr(booking.priceSnapshot.totalPaise)}
            </Text>
          </View>
        </View>

        {/* Instruction Note */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Check-In Instructions</Text>
          <Text style={styles.infoText}>
            Please present this booking reference and a valid government ID (Aadhaar / Passport) at
            the property front desk during check-in. Standard check-in time is 12:00 PM IST.
          </Text>
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={styles.historyButton}
          onPress={() => navigate('BookingHistory')}
        >
          <Text style={styles.historyButtonText}>View in My Bookings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.homeButton}
          onPress={() => reset('Explore')}
        >
          <Text style={styles.homeButtonText}>Explore More Kerala Stays</Text>
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
  heroCard: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  checkIcon: {
    fontSize: 32,
    fontWeight: '800',
    color: THEME_COLORS.SUCCESS_GREEN,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  detailsCard: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    marginBottom: 16,
  },
  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  refValue: {
    fontSize: 18,
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
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  label: {
    fontSize: 13,
    color: '#64748B',
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME_COLORS.CHARCOAL,
  },
  valueMono: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
    fontFamily: 'monospace',
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 17,
  },
  historyButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  historyButtonText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
  homeButton: {
    backgroundColor: THEME_COLORS.WHITE,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeButtonText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 14,
  },
});
