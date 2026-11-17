/**
 * Primary Guest Details Form Component
 */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';

export interface GuestFormData {
  primaryGuestName: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

export interface GuestFormErrors {
  primaryGuestName?: string;
  email?: string;
  phone?: string;
}

interface GuestFormProps {
  data: GuestFormData;
  errors: GuestFormErrors;
  onChange: (field: keyof GuestFormData, value: string) => void;
}

export const GuestForm: React.FC<GuestFormProps> = ({ data, errors, onChange }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Guest Information</Text>

      {/* Primary Guest Name */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Primary Guest Name <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, errors.primaryGuestName ? styles.inputError : null]}
          placeholder="e.g. Rahul Varma"
          placeholderTextColor="#94A3B8"
          value={data.primaryGuestName}
          onChangeText={(text) => onChange('primaryGuestName', text)}
          autoCapitalize="words"
        />
        {errors.primaryGuestName ? (
          <Text style={styles.errorText}>{errors.primaryGuestName}</Text>
        ) : null}
      </View>

      {/* Email */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Email Address <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, errors.email ? styles.inputError : null]}
          placeholder="e.g. rahul@example.com"
          placeholderTextColor="#94A3B8"
          value={data.email}
          onChangeText={(text) => onChange('email', text)}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
      </View>

      {/* Phone Number */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Mobile Phone Number <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, errors.phone ? styles.inputError : null]}
          placeholder="e.g. 9847012345"
          placeholderTextColor="#94A3B8"
          value={data.phone}
          onChangeText={(text) => onChange('phone', text)}
          keyboardType="phone-pad"
        />
        {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
      </View>

      {/* Special Requests */}
      <View style={styles.field}>
        <Text style={styles.label}>Special Requests (Optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. Early check-in requested, ground floor preferred"
          placeholderTextColor="#94A3B8"
          value={data.specialRequests || ''}
          onChangeText={(text) => onChange('specialRequests', text)}
          multiline
          numberOfLines={3}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  required: {
    color: THEME_COLORS.ERROR_RED,
  },
  input: {
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME_COLORS.CHARCOAL,
    backgroundColor: '#FAFAF9',
  },
  inputError: {
    borderColor: THEME_COLORS.ERROR_RED,
  },
  textArea: {
    height: 72,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: 12,
    color: THEME_COLORS.ERROR_RED,
    marginTop: 4,
  },
});
