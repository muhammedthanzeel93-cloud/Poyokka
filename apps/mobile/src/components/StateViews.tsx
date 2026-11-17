/**
 * Accessible UI State Views: Loading, Error, and Empty States
 */

import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';

// ============================================================================
// 1. LOADING VIEW
// ============================================================================
interface LoadingViewProps {
  message?: string;
}

export const LoadingView: React.FC<LoadingViewProps> = ({ message = 'Loading...' }) => (
  <View style={styles.centerContainer}>
    <ActivityIndicator size="large" color={THEME_COLORS.FOREST_GREEN} />
    <Text style={styles.loadingText}>{message}</Text>
  </View>
);

// ============================================================================
// 2. ERROR VIEW
// ============================================================================
interface ErrorViewProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryText?: string;
}

export const ErrorView: React.FC<ErrorViewProps> = ({
  title = 'Something went wrong',
  message,
  onRetry,
  retryText = 'Try Again',
}) => (
  <View style={styles.centerContainer}>
    <View style={styles.errorIconCircle}>
      <Text style={styles.errorIconText}>!</Text>
    </View>
    <Text style={styles.errorTitle}>{title}</Text>
    <Text style={styles.errorMessage}>{message}</Text>
    {onRetry ? (
      <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryButtonText}>{retryText}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

// ============================================================================
// 3. EMPTY VIEW
// ============================================================================
interface EmptyViewProps {
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyView: React.FC<EmptyViewProps> = ({
  title,
  description,
  actionText,
  onAction,
}) => (
  <View style={styles.centerContainer}>
    <View style={styles.emptyIconCircle}>
      <Text style={styles.emptyIconText}>📭</Text>
    </View>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyDescription}>{description}</Text>
    {actionText && onAction ? (
      <TouchableOpacity style={styles.actionButton} onPress={onAction}>
        <Text style={styles.actionButtonText}>{actionText}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  errorIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  errorIconText: {
    fontSize: 24,
    fontWeight: '800',
    color: THEME_COLORS.ERROR_RED,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 6,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 14,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyIconText: {
    fontSize: 28,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
    maxWidth: 260,
  },
  actionButton: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  actionButtonText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 14,
  },
});
