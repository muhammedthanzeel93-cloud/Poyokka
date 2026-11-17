/**
 * Stay Dates & Guest Selection Screen with Live Availability Validation
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import {
  PropertyAvailabilityResponseDto,
  PublicRoomTypeDto,
  RoomAvailabilityCheckResultDto,
} from '@kerala-tourism/shared-types';
import { Header } from '../components/Header';
import { formatPaiseToInr } from '../components/PriceBreakdownCard';
import { useAuth } from '../context/AuthContext';
import { useBooking } from '../context/BookingContext';
import { useAppNavigation } from '../navigation/NavigationContext';
import { bookingService } from '../services/booking.service';

interface DateGuestSelectionScreenProps {
  propertyId: string;
  propertyName: string;
  roomType: PublicRoomTypeDto;
}

export const DateGuestSelectionScreen: React.FC<DateGuestSelectionScreenProps> = ({
  propertyId,
  propertyName,
  roomType,
}) => {
  const { navigate } = useAppNavigation();
  const { isAuthenticated } = useAuth();
  const { createHold } = useBooking();

  // Helper to get default dates: check-in tomorrow, check-out day after tomorrow
  const getDefaultDates = () => {
    const today = new Date();
    const checkIn = new Date(today);
    checkIn.setDate(today.getDate() + 1);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkIn.getDate() + 2); // 2 nights

    const format = (d: Date) => d.toISOString().split('T')[0];
    return {
      checkIn: format(checkIn),
      checkOut: format(checkOut),
    };
  };

  const defaults = getDefaultDates();
  const [checkInDate, setCheckInDate] = useState<string>(defaults.checkIn);
  const [checkOutDate, setCheckOutDate] = useState<string>(defaults.checkOut);
  const [rooms, setRooms] = useState<number>(1);
  const [adults, setAdults] = useState<number>(2);
  const [children, setChildren] = useState<number>(0);

  const [checking, setChecking] = useState<boolean>(false);
  const [availabilityResult, setAvailabilityResult] = useState<RoomAvailabilityCheckResultDto | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Validate dates
  const dateValidation = bookingService.validateDateRange(checkInDate, checkOutDate);

  const handleCheckAvailability = async () => {
    if (!dateValidation.isValid) {
      setError(dateValidation.error || 'Please enter valid stay dates');
      return;
    }

    setChecking(true);
    setError(null);
    setAvailabilityResult(null);

    try {
      const data: PropertyAvailabilityResponseDto = await bookingService.checkAvailability(
        propertyId,
        {
          checkIn: checkInDate,
          checkOut: checkOutDate,
          rooms,
          adults,
          children,
        },
      );

      // Find our room type in availability results
      const match = data.availableRoomTypes.find((r) => r.roomType.id === roomType.id);
      if (match) {
        setAvailabilityResult(match);
        if (!match.isAvailable) {
          setError(
            `Selected room is sold out for these dates (only ${match.availableUnitsAcrossStay} units left)`,
          );
        }
      } else {
        setError('Room type availability could not be verified for these dates');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to check availability');
    } finally {
      setChecking(false);
    }
  };

  const handleProceedToReview = async () => {
    if (!isAuthenticated) {
      // Prompt tourist to log in first
      navigate('Login', {
        returnScreen: 'DateGuestSelection',
        returnParams: { propertyId, propertyName, roomType },
      });
      return;
    }

    if (!dateValidation.isValid) {
      setError(dateValidation.error || 'Invalid stay dates');
      return;
    }

    setChecking(true);
    setError(null);

    try {
      // Create server-authoritative hold
      const bookingHold = await createHold({
        propertyId,
        roomTypeId: roomType.id,
        checkInDate,
        checkOutDate,
        numberOfRooms: rooms,
        adults,
        children,
        guestDetails: {
          primaryGuestName: 'Tourist Guest',
          email: 'tourist@example.com',
          phone: '9847012345',
        },
      });

      navigate('BookingReview', {
        bookingHold,
        propertyId,
        propertyName,
        roomType,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not reserve room inventory');
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Stay & Guest Selection" subtitle={propertyName} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Room Header Card */}
        <View style={styles.roomHeaderCard}>
          <Text style={styles.roomName}>{roomType.name}</Text>
          <Text style={styles.roomCategory}>{roomType.roomCategory.replace(/_/g, ' ')}</Text>
          <Text style={styles.roomPrice}>
            {formatPaiseToInr(roomType.pricePerNightPaise || roomType.pricePerNight * 100)}{' '}
            <Text style={styles.priceSub}>/ night</Text>
          </Text>
        </View>

        {/* Date Selection Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Stay Calendar Dates (YYYY-MM-DD)</Text>

          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <Text style={styles.fieldLabel}>Check-In Date</Text>
              <TextInput
                style={styles.dateInput}
                value={checkInDate}
                onChangeText={(val) => {
                  setCheckInDate(val);
                  setAvailabilityResult(null);
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.dateCol}>
              <Text style={styles.fieldLabel}>Check-Out Date</Text>
              <TextInput
                style={styles.dateInput}
                value={checkOutDate}
                onChangeText={(val) => {
                  setCheckOutDate(val);
                  setAvailabilityResult(null);
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          {dateValidation.isValid ? (
            <Text style={styles.nightsNotice}>
              ✓ {dateValidation.nights} night{dateValidation.nights > 1 ? 's' : ''} stay selected
            </Text>
          ) : (
            <Text style={styles.errorNotice}>⚠️ {dateValidation.error}</Text>
          )}
        </View>

        {/* Guest and Room Counters */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rooms & Guests</Text>

          {/* Rooms */}
          <View style={styles.counterRow}>
            <View>
              <Text style={styles.counterTitle}>Number of Rooms</Text>
              <Text style={styles.counterSub}>Max 10 rooms per booking</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setRooms((prev) => Math.max(1, prev - 1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepVal}>{rooms}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setRooms((prev) => Math.min(10, prev + 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Adults */}
          <View style={styles.counterRow}>
            <View>
              <Text style={styles.counterTitle}>Adults (Ages 12+)</Text>
              <Text style={styles.counterSub}>Max room occupancy applies</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setAdults((prev) => Math.max(1, prev - 1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepVal}>{adults}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setAdults((prev) => Math.min(20, prev + 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Children */}
          <View style={styles.counterRow}>
            <View>
              <Text style={styles.counterTitle}>Children (Ages 0–11)</Text>
              <Text style={styles.counterSub}>Free stay up to 5 yrs</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setChildren((prev) => Math.max(0, prev - 1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepVal}>{children}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setChildren((prev) => Math.min(10, prev + 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Availability Feedback Card */}
        {availabilityResult ? (
          <View
            style={[
              styles.availabilityCard,
              availabilityResult.isAvailable ? styles.availSuccess : styles.availFailure,
            ]}
          >
            <Text style={styles.availTitle}>
              {availabilityResult.isAvailable
                ? `✓ Available! (${availabilityResult.availableUnitsAcrossStay} units remaining)`
                : '✕ Sold Out for Selected Dates'}
            </Text>
            {availabilityResult.isAvailable ? (
              <Text style={styles.availPrice}>
                Estimated Total: {formatPaiseToInr(availabilityResult.totalStayPrice * 100)} (incl.
                taxes)
              </Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

        {/* Check Availability Action */}
        <TouchableOpacity
          style={styles.checkButton}
          onPress={handleCheckAvailability}
          disabled={checking || !dateValidation.isValid}
        >
          {checking ? (
            <ActivityIndicator color={THEME_COLORS.FOREST_GREEN} />
          ) : (
            <Text style={styles.checkButtonText}>Check Live Room Availability</Text>
          )}
        </TouchableOpacity>

        {/* Proceed to Hold & Review Button */}
        <TouchableOpacity
          style={[
            styles.proceedButton,
            !dateValidation.isValid || checking ? styles.buttonDisabled : null,
          ]}
          onPress={handleProceedToReview}
          disabled={!dateValidation.isValid || checking}
        >
          <Text style={styles.proceedButtonText}>
            {isAuthenticated ? 'Reserve & Create 15-Min Hold' : 'Login to Reserve Room'}
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
  roomHeaderCard: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  roomName: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
  },
  roomCategory: {
    fontSize: 13,
    color: THEME_COLORS.NATURE_GREEN,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 6,
  },
  roomPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  priceSub: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: 'normal',
  },
  card: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateCol: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME_COLORS.CHARCOAL,
    backgroundColor: '#FAFAF9',
  },
  nightsNotice: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: THEME_COLORS.SUCCESS_GREEN,
  },
  errorNotice: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: THEME_COLORS.ERROR_RED,
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  counterTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME_COLORS.CHARCOAL,
  },
  counterSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 2,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: THEME_COLORS.WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  stepVal: {
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  availabilityCard: {
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  availSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: THEME_COLORS.SUCCESS_GREEN,
  },
  availFailure: {
    backgroundColor: '#FEE2E2',
    borderColor: THEME_COLORS.ERROR_RED,
  },
  availTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
  },
  availPrice: {
    fontSize: 13,
    color: THEME_COLORS.FOREST_GREEN,
    fontWeight: '600',
    marginTop: 4,
  },
  errorText: {
    fontSize: 13,
    color: THEME_COLORS.ERROR_RED,
    marginBottom: 12,
    fontWeight: '600',
  },
  checkButton: {
    backgroundColor: '#E8F5E9',
    borderColor: THEME_COLORS.FOREST_GREEN,
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  checkButtonText: {
    color: THEME_COLORS.FOREST_GREEN,
    fontWeight: '700',
    fontSize: 15,
  },
  proceedButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  proceedButtonText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 16,
  },
});
