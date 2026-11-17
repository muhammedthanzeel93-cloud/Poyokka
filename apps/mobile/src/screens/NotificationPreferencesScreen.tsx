/**
 * Notification Preferences Screen
 *
 * Provides tourist controls over:
 * - Booking updates
 * - Payment updates
 * - Social activity updates
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { Header } from '../components/Header';
import { useNotifications } from '../context/NotificationContext';
import { api } from '../services/api';

export const NotificationPreferencesScreen: React.FC = () => {
  const { permissionStatus, requestPermission } = useNotifications();

  const [bookingUpdates, setBookingUpdates] = useState(true);
  const [paymentUpdates, setPaymentUpdates] = useState(true);
  const [socialUpdates, setSocialUpdates] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api.notifications
      .getPreferences()
      .then((res) => {
        if (mounted && res.data?.preferences) {
          setBookingUpdates(res.data.preferences.bookingUpdates);
          setPaymentUpdates(res.data.preferences.paymentUpdates);
          setSocialUpdates(res.data.preferences.socialUpdates);
        }
      })
      .catch((err) => {
        console.warn('Failed to load preferences:', err);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      await api.notifications.updatePreferences({
        bookingUpdates,
        paymentUpdates,
        socialUpdates,
      });
      setMessage('Preferences saved successfully!');
    } catch {
      setMessage('Failed to save preferences.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Notification Settings" />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={THEME_COLORS.FOREST_GREEN} />
        </View>
      ) : (
        <View style={styles.content}>
          {/* Permission Status Banner */}
          {permissionStatus !== 'granted' && (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>Push Notifications Disabled</Text>
              <Text style={styles.permissionBody}>
                Enable device notifications to receive real-time booking updates and security alerts.
              </Text>
              <TouchableOpacity
                style={styles.enableButton}
                onPress={requestPermission}
              >
                <Text style={styles.enableButtonText}>Enable Notifications</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionHeader}>NOTIFICATION CHANNELS</Text>

          <View style={styles.card}>
            <View style={styles.preferenceRow}>
              <View style={styles.labelGroup}>
                <Text style={styles.preferenceTitle}>Booking Updates</Text>
                <Text style={styles.preferenceDesc}>
                  Stay confirmations, check-in reminders, and schedule changes.
                </Text>
              </View>
              <Switch
                value={bookingUpdates}
                onValueChange={setBookingUpdates}
                trackColor={{ false: '#E2E8F0', true: THEME_COLORS.FOREST_GREEN }}
              />
            </View>

            <View style={styles.separator} />

            <View style={styles.preferenceRow}>
              <View style={styles.labelGroup}>
                <Text style={styles.preferenceTitle}>Payment & Invoices</Text>
                <Text style={styles.preferenceDesc}>
                  Payment capture receipts, refund notifications, and review alerts.
                </Text>
              </View>
              <Switch
                value={paymentUpdates}
                onValueChange={setPaymentUpdates}
                trackColor={{ false: '#E2E8F0', true: THEME_COLORS.FOREST_GREEN }}
              />
            </View>

            <View style={styles.separator} />

            <View style={styles.preferenceRow}>
              <View style={styles.labelGroup}>
                <Text style={styles.preferenceTitle}>Social Activity</Text>
                <Text style={styles.preferenceDesc}>
                  Alerts when fellow travelers follow your profile, like, or comment.
                </Text>
              </View>
              <Switch
                value={socialUpdates}
                onValueChange={setSocialUpdates}
                trackColor={{ false: '#E2E8F0', true: THEME_COLORS.FOREST_GREEN }}
              />
            </View>
          </View>

          {message && (
            <Text
              style={[
                styles.messageText,
                message.includes('success') ? styles.successText : styles.errorText,
              ]}
            >
              {message}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.saveButton, isSaving ? styles.disabledButton : null]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={THEME_COLORS.WHITE} />
            ) : (
              <Text style={styles.saveButtonText}>Save Preferences</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
  },
  permissionCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  permissionBody: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 16,
    marginBottom: 10,
  },
  enableButton: {
    backgroundColor: '#B45309',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  enableButtonText: {
    color: THEME_COLORS.WHITE,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  labelGroup: {
    flex: 1,
    paddingRight: 16,
  },
  preferenceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 2,
  },
  preferenceDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  separator: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  saveButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: THEME_COLORS.WHITE,
    fontSize: 14,
    fontWeight: '700',
  },
  messageText: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  successText: {
    color: '#16A34A',
  },
  errorText: {
    color: '#DC2626',
  },
});
