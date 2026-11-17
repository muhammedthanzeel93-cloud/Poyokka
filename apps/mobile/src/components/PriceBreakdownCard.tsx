/**
 * Server-Authoritative Price Breakdown Card
 *
 * Formats integer paise into INR without client price trust.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { formatPaiseToInr } from '../utils/formatters';

export { formatPaiseToInr };

export interface PriceBreakdownCardProps {
  basePricePaise?: number;
  subtotalPaise: number;
  taxesPaise: number;
  totalPaise: number;
  nights: number;
  numberOfRooms: number;
  currency?: string;
}

export const PriceBreakdownCard: React.FC<PriceBreakdownCardProps> = ({
  basePricePaise,
  subtotalPaise,
  taxesPaise,
  totalPaise,
  nights,
  numberOfRooms,
}) => {
  const effectiveBasePaise =
    basePricePaise || Math.round(subtotalPaise / (nights * numberOfRooms));

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Price Breakdown</Text>

      <View style={styles.lineItem}>
        <Text style={styles.label}>
          Base Rate ({formatPaiseToInr(effectiveBasePaise)} × {nights} night
          {nights > 1 ? 's' : ''} × {numberOfRooms} room{numberOfRooms > 1 ? 's' : ''})
        </Text>
        <Text style={styles.value}>{formatPaiseToInr(subtotalPaise)}</Text>
      </View>

      <View style={styles.lineItem}>
        <Text style={styles.label}>Taxes & Kerala Tourism Cess (12% GST)</Text>
        <Text style={styles.value}>{formatPaiseToInr(taxesPaise)}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total Payable</Text>
        <Text style={styles.totalValue}>{formatPaiseToInr(totalPaise)}</Text>
      </View>

      <Text style={styles.footnote}>
        Includes all government taxes, Kerala tourism development levy, and service charges.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 12,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  label: {
    fontSize: 13,
    color: '#64748B',
    flex: 1,
    marginRight: 8,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME_COLORS.CHARCOAL,
  },
  divider: {
    height: 1,
    backgroundColor: THEME_COLORS.MUTED_BORDER,
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.FOREST_GREEN,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME_COLORS.FOREST_GREEN,
  },
  footnote: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
  },
});
