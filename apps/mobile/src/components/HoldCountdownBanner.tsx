/**
 * Live Inventory Hold Countdown Banner
 *
 * Displays visual countdown of remaining hold seconds.
 * Color dynamically changes according to urgency:
 * - > 5 minutes: Nature Green
 * - 2 to 5 minutes: Warning Amber
 * - < 2 minutes: Error Red
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';

interface HoldCountdownBannerProps {
  remainingSeconds: number;
  isExpired: boolean;
}

export const HoldCountdownBanner: React.FC<HoldCountdownBannerProps> = ({
  remainingSeconds,
  isExpired,
}) => {
  if (isExpired || remainingSeconds <= 0) {
    return (
      <View style={[styles.container, styles.expiredContainer]}>
        <Text style={styles.expiredTitle}>Hold Expired</Text>
        <Text style={styles.expiredSubtitle}>
          Your 15-minute room hold has expired. Please check availability again to book.
        </Text>
      </View>
    );
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  let bannerStyle: StyleProp<ViewStyle> = styles.greenBanner;
  let statusText = 'Room Reserved For You';

  if (remainingSeconds < 120) {
    bannerStyle = styles.redBanner;
    statusText = 'Hold Expiring Soon!';
  } else if (remainingSeconds < 300) {
    bannerStyle = styles.amberBanner;
    statusText = 'Complete Payment Soon';
  }

  return (
    <View style={[styles.container, bannerStyle]}>
      <View style={styles.row}>
        <View style={styles.dot} />
        <Text style={styles.title}>{statusText}</Text>
        <Text style={styles.timer}>{timeFormatted}</Text>
      </View>
      <Text style={styles.subtitle}>
        Inventory is held exclusively for you during this window. Price guaranteed.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 10,
  },
  greenBanner: {
    backgroundColor: '#E8F5E9',
    borderColor: THEME_COLORS.NATURE_GREEN,
    borderWidth: 1,
  },
  amberBanner: {
    backgroundColor: '#FEF3C7',
    borderColor: THEME_COLORS.WARNING_AMBER,
    borderWidth: 1,
  },
  redBanner: {
    backgroundColor: '#FEE2E2',
    borderColor: THEME_COLORS.ERROR_RED,
    borderWidth: 1,
  },
  expiredContainer: {
    backgroundColor: '#FEE2E2',
    borderColor: THEME_COLORS.ERROR_RED,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    flex: 1,
  },
  timer: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 4,
  },
  expiredTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.ERROR_RED,
  },
  expiredSubtitle: {
    fontSize: 12,
    color: THEME_COLORS.ERROR_RED,
    marginTop: 2,
  },
});
