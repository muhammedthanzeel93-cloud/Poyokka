/**
 * Status Badge Component for Booking & Payment States
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BOOKING_STATUSES, PAYMENT_STATUSES } from '@kerala-tourism/constants';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let backgroundColor = '#F1F5F9';
  let textColor = '#475569';
  const label = status.replace(/_/g, ' ');

  // Booking statuses
  if (status === BOOKING_STATUSES.CONFIRMED || status === PAYMENT_STATUSES.CAPTURED) {
    backgroundColor = '#DCFCE7';
    textColor = '#15803D';
  } else if (
    status === BOOKING_STATUSES.AWAITING_PAYMENT ||
    status === PAYMENT_STATUSES.PENDING ||
    status === PAYMENT_STATUSES.AUTHORIZED
  ) {
    backgroundColor = '#FEF3C7';
    textColor = '#B45309';
  } else if (
    status === BOOKING_STATUSES.CANCELLED ||
    status === BOOKING_STATUSES.EXPIRED ||
    status === BOOKING_STATUSES.REJECTED ||
    status === PAYMENT_STATUSES.FAILED
  ) {
    backgroundColor = '#FEE2E2';
    textColor = '#B91C1C';
  } else if (status === BOOKING_STATUSES.CHECKED_IN) {
    backgroundColor = '#E0F2FE';
    textColor = '#0369A1';
  } else if (status === BOOKING_STATUSES.COMPLETED) {
    backgroundColor = '#F3E8FF';
    textColor = '#7E22CE';
  }

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.badgeText, { color: textColor }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
