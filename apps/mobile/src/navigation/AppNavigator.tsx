/**
 * Master App Navigator & Screen Dispatcher
 */

import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { BookingConfirmationScreen } from '../screens/BookingConfirmationScreen';
import { BookingDetailsScreen } from '../screens/BookingDetailsScreen';
import { BookingHistoryScreen } from '../screens/BookingHistoryScreen';
import { BookingReviewScreen } from '../screens/BookingReviewScreen';
import { DateGuestSelectionScreen } from '../screens/DateGuestSelectionScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { PaymentCheckoutScreen } from '../screens/PaymentCheckoutScreen';
import { PropertyDetailsScreen } from '../screens/PropertyDetailsScreen';
import { NotificationCenterScreen } from '../screens/NotificationCenterScreen';
import { NotificationPreferencesScreen } from '../screens/NotificationPreferencesScreen';
import { useNotifications } from '../context/NotificationContext';
import { useAppNavigation } from './NavigationContext';

export const AppNavigator: React.FC = () => {
  const { currentRoute, navigate, reset } = useAppNavigation();
  const { unreadCount } = useNotifications();

  const renderScreen = () => {
    switch (currentRoute.name) {
      case 'PropertyDetails': {
        const p = currentRoute.params as any;
        return (
          <PropertyDetailsScreen
            propertyId={p?.propertyId || 'prop_wayanad_retreat'}
            initialProperty={p?.property}
          />
        );
      }

      case 'DateGuestSelection': {
        const p = currentRoute.params as any;
        return (
          <DateGuestSelectionScreen
            propertyId={p?.propertyId || 'prop_wayanad_retreat'}
            propertyName={p?.propertyName || 'Wayanad Eco Retreat'}
            roomType={p?.roomType}
          />
        );
      }

      case 'BookingReview': {
        const p = currentRoute.params as any;
        return (
          <BookingReviewScreen
            bookingHold={p?.bookingHold}
            propertyId={p?.propertyId}
            propertyName={p?.propertyName}
            roomType={p?.roomType}
          />
        );
      }

      case 'PaymentCheckout': {
        const p = currentRoute.params as any;
        return (
          <PaymentCheckoutScreen
            bookingId={p?.bookingId}
            bookingReference={p?.bookingReference}
            holdId={p?.holdId}
            propertyName={p?.propertyName}
            totalPaise={p?.totalPaise}
            totalInr={p?.totalInr}
          />
        );
      }

      case 'BookingConfirmation': {
        const p = currentRoute.params as any;
        return (
          <BookingConfirmationScreen
            booking={p?.booking}
            propertyName={p?.propertyName}
            paymentReference={p?.paymentReference}
          />
        );
      }

      case 'BookingHistory':
        return <BookingHistoryScreen />;

      case 'BookingDetails': {
        const p = currentRoute.params as any;
        return <BookingDetailsScreen bookingId={p?.bookingId} />;
      }

      case 'NotificationCenter':
        return <NotificationCenterScreen />;

      case 'NotificationPreferences':
        return <NotificationPreferencesScreen />;

      case 'Login': {
        const p = currentRoute.params as any;
        return (
          <LoginScreen
            returnScreen={p?.returnScreen}
            returnParams={p?.returnParams}
          />
        );
      }

      case 'Explore':
      default:
        return (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Top Brand Banner */}
            <View style={styles.header}>
              <View style={styles.brandRow}>
                <View style={styles.logoBadge}>
                  <Text style={styles.logoBadgeText}>KT</Text>
                </View>
                <View>
                  <Text style={styles.brandTitle}>Kerala Tourism</Text>
                  <Text style={styles.brandSubtitle}>God's Own Country</Text>
                </View>
              </View>

              <View style={styles.headerRightActions}>
                <TouchableOpacity
                  style={styles.bellButton}
                  onPress={() => navigate('NotificationCenter')}
                >
                  <Text style={styles.bellIcon}>🔔</Text>
                  {unreadCount > 0 && (
                    <View style={styles.badgeBubble}>
                      <Text style={styles.badgeText}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.historyPill}
                  onPress={() => navigate('BookingHistory')}
                >
                  <Text style={styles.historyPillText}>My Bookings</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* GPS Pulse Card */}
            <View style={styles.gpsBanner}>
              <View style={styles.pulseDot} />
              <Text style={styles.gpsText}>GPS Active: Wayanad Rainforest Buffer (1.2 km away)</Text>
            </View>

            {/* Featured Resort Card */}
            <View style={styles.featuredCard}>
              <Text style={styles.featuredBadge}>FEATURED VERIFIED RESORT</Text>
              <Text style={styles.featuredTitle}>Vythiri Rainforest Retreat & Spa</Text>
              <Text style={styles.featuredAddress}>📍 Lakkidi, Wayanad • 4.8 ★ (142 reviews)</Text>
              <Text style={styles.featuredDesc}>
                Eco-luxury forest villas, natural stream-fed pool, Ayurvedic wellness center, and
                organic spice plantation tours.
              </Text>

              <TouchableOpacity
                style={styles.bookNowBtn}
                onPress={() =>
                  navigate('PropertyDetails', {
                    propertyId: 'prop_673740001122334455667788',
                  })
                }
              >
                <Text style={styles.bookNowText}>Browse Rooms & Check Availability →</Text>
              </TouchableOpacity>
            </View>

            {/* Additional Stays Section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Featured Eco-Accommodations</Text>
            </View>

            {[
              {
                id: 'prop_kumarakom_backwater',
                name: 'Kumarakom Backwater Heritage Villa',
                location: 'Vembanad Lake, Kottayam',
                price: '₹4,500 / night',
                type: 'HERITAGE HOMESTAY',
              },
              {
                id: 'prop_munnar_tea_mist',
                name: 'Munnar Tea Estate Clouds Pod',
                location: 'Pallivasal, Idukki',
                price: '₹2,800 / night',
                type: 'ECO LODGE',
              },
            ].map((item) => (
              <View key={item.id} style={styles.stayCard}>
                <View style={styles.stayHeader}>
                  <Text style={styles.stayType}>{item.type}</Text>
                  <Text style={styles.stayPrice}>{item.price}</Text>
                </View>
                <Text style={styles.stayName}>{item.name}</Text>
                <Text style={styles.stayLoc}>📍 {item.location}</Text>
                <TouchableOpacity
                  style={styles.stayBtn}
                  onPress={() =>
                    navigate('PropertyDetails', {
                      propertyId: item.id,
                    })
                  }
                >
                  <Text style={styles.stayBtnText}>View Rooms</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>{renderScreen()}</View>

      {/* Persistent Bottom Navigation Dock */}
      <View style={styles.bottomDock}>
        <TouchableOpacity
          style={styles.dockItem}
          onPress={() => reset('Explore')}
        >
          <Text style={styles.dockIcon}>🌴</Text>
          <Text
            style={[
              styles.dockLabel,
              currentRoute.name === 'Explore' ? styles.dockActive : null,
            ]}
          >
            Explore
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dockItem}
          onPress={() =>
            navigate('PropertyDetails', {
              propertyId: 'prop_673740001122334455667788',
            })
          }
        >
          <Text style={styles.dockIcon}>🏨</Text>
          <Text
            style={[
              styles.dockLabel,
              currentRoute.name === 'PropertyDetails' ||
              currentRoute.name === 'DateGuestSelection'
                ? styles.dockActive
                : null,
            ]}
          >
            Stays
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dockItem}
          onPress={() => navigate('BookingHistory')}
        >
          <Text style={styles.dockIcon}>🎟️</Text>
          <Text
            style={[
              styles.dockLabel,
              currentRoute.name === 'BookingHistory' ||
              currentRoute.name === 'BookingDetails'
                ? styles.dockActive
                : null,
            ]}
          >
            My Bookings
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dockItem}
          onPress={() => navigate('NotificationCenter')}
        >
          <View style={styles.dockIconWrapper}>
            <Text style={styles.dockIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.dockBadge}>
                <Text style={styles.dockBadgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.dockLabel,
              currentRoute.name === 'NotificationCenter' ||
              currentRoute.name === 'NotificationPreferences'
                ? styles.dockActive
                : null,
            ]}
          >
            Alerts
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dockItem}
          onPress={() => navigate('Login')}
        >
          <Text style={styles.dockIcon}>👤</Text>
          <Text
            style={[
              styles.dockLabel,
              currentRoute.name === 'Login' ? styles.dockActive : null,
            ]}
          >
            Profile
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME_COLORS.FOREST_GREEN,
  },
  container: {
    flex: 1,
    backgroundColor: '#F8F7F1',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  header: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME_COLORS.WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBadgeText: {
    color: THEME_COLORS.FOREST_GREEN,
    fontWeight: '900',
    fontSize: 15,
  },
  brandTitle: {
    color: THEME_COLORS.WHITE,
    fontWeight: '800',
    fontSize: 16,
  },
  brandSubtitle: {
    color: '#D1FAE5',
    fontSize: 11,
    fontWeight: '500',
  },
  historyPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  historyPillText: {
    color: THEME_COLORS.WHITE,
    fontSize: 12,
    fontWeight: '700',
  },
  gpsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#BBF7D0',
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME_COLORS.SUCCESS_GREEN,
  },
  gpsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
  },
  featuredCard: {
    backgroundColor: THEME_COLORS.WHITE,
    margin: 16,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 2,
  },
  featuredBadge: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  featuredTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 4,
  },
  featuredAddress: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 8,
  },
  featuredDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  bookNowBtn: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookNowText: {
    color: THEME_COLORS.WHITE,
    fontSize: 14,
    fontWeight: '700',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  stayCard: {
    backgroundColor: THEME_COLORS.WHITE,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  stayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  stayType: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME_COLORS.NATURE_GREEN,
  },
  stayPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  stayName: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 2,
  },
  stayLoc: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 10,
  },
  stayBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  stayBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  bottomDock: {
    flexDirection: 'row',
    backgroundColor: THEME_COLORS.WHITE,
    borderTopWidth: 1,
    borderTopColor: THEME_COLORS.MUTED_BORDER,
    paddingVertical: 8,
    paddingBottom: 12,
  },
  dockItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  dockLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  dockActive: {
    color: THEME_COLORS.FOREST_GREEN,
    fontWeight: '800',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bellButton: {
    padding: 6,
    position: 'relative',
  },
  bellIcon: {
    fontSize: 18,
  },
  badgeBubble: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#DC2626',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: THEME_COLORS.WHITE,
    fontSize: 9,
    fontWeight: '800',
  },
  dockIconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#DC2626',
    borderRadius: 8,
    minWidth: 15,
    height: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  dockBadgeText: {
    color: THEME_COLORS.WHITE,
    fontSize: 8,
    fontWeight: '900',
  },
});
