/**
 * Notification Center Screen
 *
 * Implements:
 * - Unread count badge and "Mark All Read" action
 * - Filter tabs (All vs. Unread)
 * - Push notification icon styling conforming to My Travelroad theme
 * - Deep-link navigation with authoritative backend resource verification
 * - Delete notification action
 * - Pull-to-refresh and empty/loading states
 */

import React, { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { NotificationDto } from '@kerala-tourism/shared-types';
import { Header } from '../components/Header';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';
import { useNotifications } from '../context/NotificationContext';
import { useAppNavigation } from '../navigation/NavigationContext';
import { mobileNotificationService } from '../services/notification.service';

export const NotificationCenterScreen: React.FC = () => {
  const { navigate } = useAppNavigation();
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refreshAll,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<'ALL' | 'UNREAD'>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'UNREAD') {
      return !n.isRead;
    }
    return true;
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshAll();
    setIsRefreshing(false);
  };

  const handleNotificationPress = async (item: NotificationDto) => {
    if (!item.isRead) {
      await markAsRead(item.id);
    }

    if (item.dataPayload) {
      const target = await mobileNotificationService.resolveDeepLinkTarget(item.dataPayload);
      if (target.screen !== 'NotificationCenter') {
        navigate(target.screen, target.params);
      }
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'BOOKING_CONFIRMED':
        return { icon: '🎟️', bg: '#DCFCE7' };
      case 'BOOKING_CANCELLED':
        return { icon: '❌', bg: '#FEE2E2' };
      case 'BOOKING_REJECTED':
        return { icon: '⚠️', bg: '#FEF3C7' };
      case 'PAYMENT_CAPTURED':
        return { icon: '💳', bg: '#D1FAE5' };
      case 'PAYMENT_FAILED':
        return { icon: '🚨', bg: '#FEE2E2' };
      case 'PAYMENT_RECONCILIATION_REQUIRED':
        return { icon: '⏳', bg: '#FEF3C7' };
      case 'SOCIAL_NEW_FOLLOWER':
        return { icon: '👥', bg: '#DBEAFE' };
      case 'SOCIAL_COMMENT':
        return { icon: '💬', bg: '#EDE9FE' };
      case 'SOCIAL_LIKE':
        return { icon: '❤️', bg: '#FFE4E6' };
      default:
        return { icon: '🔔', bg: '#F1F5F9' };
    }
  };

  const formatTimestamp = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  const renderItem = ({ item }: { item: NotificationDto }) => {
    const { icon, bg } = getNotificationIcon(item.notificationType);

    return (
      <TouchableOpacity
        style={[
          styles.card,
          !item.isRead ? styles.unreadCard : null,
        ]}
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: bg }]}>
          <Text style={styles.iconText}>{icon}</Text>
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, !item.isRead ? styles.unreadTitle : null]}>
              {item.title}
            </Text>
            {!item.isRead && <View style={styles.unreadDot} />}
          </View>

          <Text style={styles.body}>{item.body}</Text>

          <View style={styles.metaRow}>
            <Text style={styles.timestamp}>{formatTimestamp(item.createdAt)}</Text>
            <TouchableOpacity
              onPress={() => deleteNotification(item.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Header
        title="Notifications"
        rightActionText="⚙️"
        onRightAction={() => navigate('NotificationPreferences')}
      />

      {/* Tabs and Actions Row */}
      <View style={styles.actionBar}>
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'ALL' ? styles.activeTab : null]}
            onPress={() => setActiveTab('ALL')}
          >
            <Text style={[styles.tabText, activeTab === 'ALL' ? styles.activeTabText : null]}>
              All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'UNREAD' ? styles.activeTab : null]}
            onPress={() => setActiveTab('UNREAD')}
          >
            <Text style={[styles.tabText, activeTab === 'UNREAD' ? styles.activeTabText : null]}>
              Unread {unreadCount > 0 ? `(${unreadCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllAsRead}>
            <Text style={styles.markAllReadText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Body Views */}
      {isLoading && notifications.length === 0 ? (
        <LoadingView message="Loading notifications..." />
      ) : error ? (
        <ErrorView message={error} onRetry={refreshAll} />
      ) : (
        <FlatList
          data={filteredNotifications}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
          ListEmptyComponent={
            <EmptyView
              title="No Notifications"
              description={
                activeTab === 'UNREAD'
                  ? 'You are all caught up! Zero unread notifications.'
                  : 'You have no notifications right now.'
              }
            />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  prefButton: {
    padding: 6,
  },
  prefButtonText: {
    fontSize: 18,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: THEME_COLORS.WHITE,
    borderBottomWidth: 1,
    borderBottomColor: THEME_COLORS.MUTED_BORDER,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  activeTab: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  activeTabText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
  },
  markAllReadText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME_COLORS.FOREST_GREEN,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  unreadCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 20,
  },
  contentContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME_COLORS.CHARCOAL,
    flex: 1,
  },
  unreadTitle: {
    fontWeight: '800',
    color: '#0F172A',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    marginLeft: 8,
  },
  body: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timestamp: {
    fontSize: 11,
    color: '#94A3B8',
  },
  deleteText: {
    fontSize: 11,
    color: '#DC2626',
    fontWeight: '600',
  },
});
