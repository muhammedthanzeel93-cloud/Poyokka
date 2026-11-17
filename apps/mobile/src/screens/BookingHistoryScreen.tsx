/**
 * Tourist Booking History Screen
 *
 * Displays personal bookings divided into Upcoming and Past categories,
 * with real-time status badges and detail navigation.
 */

import React, { useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BOOKING_STATUSES, THEME_COLORS } from '@kerala-tourism/constants';
import { BookingDto } from '@kerala-tourism/shared-types';
import { Header } from '../components/Header';
import { formatPaiseToInr } from '../components/PriceBreakdownCard';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useAppNavigation } from '../navigation/NavigationContext';
import { bookingService } from '../services/booking.service';

type TabType = 'UPCOMING' | 'PAST';

export const BookingHistoryScreen: React.FC = () => {
  const { navigate, reset } = useAppNavigation();
  const { isAuthenticated } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('UPCOMING');
  const [bookings, setBookings] = useState<BookingDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await bookingService.listBookings();
      setBookings(res.items);
    } catch (err: any) {
      setError(err?.message || 'Failed to load bookings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [isAuthenticated]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchBookings();
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Header title="My Bookings" showBack={false} />
        <EmptyView
          title="Sign in to view your bookings"
          description="Log in with your tourist account to access past and upcoming reservations."
          actionText="Log In"
          onAction={() => navigate('Login', { returnScreen: 'BookingHistory' })}
        />
      </View>
    );
  }

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <Header title="My Bookings" showBack={false} />
        <LoadingView message="Loading your reservations..." />
      </View>
    );
  }

  if (error && bookings.length === 0) {
    return (
      <View style={styles.container}>
        <Header title="My Bookings" showBack={false} />
        <ErrorView message={error} onRetry={fetchBookings} />
      </View>
    );
  }

  // Filter bookings by tab
  const upcomingBookings = bookings.filter(
    (b) =>
      b.status === BOOKING_STATUSES.CONFIRMED ||
      b.status === BOOKING_STATUSES.AWAITING_PAYMENT,
  );

  const pastBookings = bookings.filter(
    (b) =>
      b.status === BOOKING_STATUSES.COMPLETED ||
      b.status === BOOKING_STATUSES.CHECKED_IN ||
      b.status === BOOKING_STATUSES.CANCELLED ||
      b.status === BOOKING_STATUSES.EXPIRED ||
      b.status === BOOKING_STATUSES.REJECTED,
  );

  const displayedList = activeTab === 'UPCOMING' ? upcomingBookings : pastBookings;

  return (
    <View style={styles.container}>
      <Header title="My Bookings" showBack={false} />

      {/* Segmented Tab Controls */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'UPCOMING' ? styles.tabActive : null]}
          onPress={() => setActiveTab('UPCOMING')}
        >
          <Text
            style={[styles.tabText, activeTab === 'UPCOMING' ? styles.tabTextActive : null]}
          >
            Upcoming ({upcomingBookings.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'PAST' ? styles.tabActive : null]}
          onPress={() => setActiveTab('PAST')}
        >
          <Text
            style={[styles.tabText, activeTab === 'PAST' ? styles.tabTextActive : null]}
          >
            Past & Completed ({pastBookings.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={THEME_COLORS.FOREST_GREEN}
          />
        }
      >
        {displayedList.length === 0 ? (
          <EmptyView
            title={activeTab === 'UPCOMING' ? 'No Upcoming Bookings' : 'No Past Bookings'}
            description={
              activeTab === 'UPCOMING'
                ? 'You do not have any active or confirmed reservations.'
                : 'Completed and past stays will appear here.'
            }
            actionText={activeTab === 'UPCOMING' ? 'Find a Stay' : undefined}
            onAction={activeTab === 'UPCOMING' ? () => reset('Explore') : undefined}
          />
        ) : (
          displayedList.map((booking) => (
            <TouchableOpacity
              key={booking.id}
              style={styles.card}
              onPress={() => navigate('BookingDetails', { bookingId: booking.id })}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.refLabel}>REFERENCE</Text>
                  <Text style={styles.refCode}>{booking.bookingReference}</Text>
                </View>
                <StatusBadge status={booking.status} />
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <Text style={styles.dateText}>
                  📅 {booking.checkInDate} → {booking.checkOutDate} ({booking.nights} night
                  {booking.nights > 1 ? 's' : ''})
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.guestText}>
                  👥 {booking.numberOfRooms} Room{booking.numberOfRooms > 1 ? 's' : ''} •{' '}
                  {booking.adults} Adults
                  {booking.children ? `, ${booking.children} Children` : ''}
                </Text>
              </View>

              <View style={styles.cardFooter}>
                <Text style={styles.amountText}>
                  {formatPaiseToInr(booking.priceSnapshot.totalPaise)}
                </Text>
                <Text style={styles.viewDetailsText}>View Details →</Text>
              </View>
            </TouchableOpacity>
          ))
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: THEME_COLORS.WHITE,
    borderBottomWidth: 1,
    borderBottomColor: THEME_COLORS.MUTED_BORDER,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: THEME_COLORS.FOREST_GREEN,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  tabTextActive: {
    color: THEME_COLORS.FOREST_GREEN,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  card: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
  },
  refCode: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: THEME_COLORS.MUTED_BORDER,
    marginVertical: 10,
  },
  infoRow: {
    marginVertical: 3,
  },
  dateText: {
    fontSize: 13,
    color: THEME_COLORS.CHARCOAL,
    fontWeight: '600',
  },
  guestText: {
    fontSize: 12,
    color: '#64748B',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  viewDetailsText: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME_COLORS.FOREST_GREEN,
  },
});
