/**
 * Notification State Context for Mobile Application
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { NotificationDto } from '@kerala-tourism/shared-types';
import { api } from '../services/api';
import {
  mobileNotificationService,
  PermissionStatus,
} from '../services/notification.service';
import { useAuth } from './AuthContext';

export interface NotificationContextType {
  unreadCount: number;
  notifications: NotificationDto[];
  isLoading: boolean;
  error: string | null;
  permissionStatus: PermissionStatus;
  requestPermission: () => Promise<boolean>;
  fetchNotifications: (isRead?: 'true' | 'false' | 'all') => Promise<void>;
  fetchUnreadCount: () => Promise<number>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>(
    mobileNotificationService.getPermissionStatus(),
  );

  const fetchUnreadCount = useCallback(async (): Promise<number> => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return 0;
    }

    try {
      const res = await api.notifications.getUnreadCount();
      const count = res.data?.unreadCount ?? 0;
      setUnreadCount(count);
      return count;
    } catch {
      return 0;
    }
  }, [isAuthenticated]);

  const fetchNotifications = useCallback(
    async (isRead?: 'true' | 'false' | 'all'): Promise<void> => {
      if (!isAuthenticated) {
        setNotifications([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const res = await api.notifications.list({ page: 1, limit: 50, isRead });
        setNotifications(res.data?.items ?? []);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load notifications';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [isAuthenticated],
  );

  const markAsRead = useCallback(
    async (notificationId: string): Promise<void> => {
      try {
        await api.notifications.markAsRead(notificationId);
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (err) {
        console.warn('[NotificationContext] Mark as read failed:', err);
      }
    },
    [],
  );

  const markAllAsRead = useCallback(async (): Promise<void> => {
    try {
      await api.notifications.markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch (err) {
      console.warn('[NotificationContext] Mark all as read failed:', err);
    }
  }, []);

  const deleteNotification = useCallback(
    async (notificationId: string): Promise<void> => {
      try {
        await api.notifications.delete(notificationId);
        setNotifications((prev) => {
          const target = prev.find((n) => n.id === notificationId);
          if (target && !target.isRead) {
            setUnreadCount((c) => Math.max(0, c - 1));
          }
          return prev.filter((n) => n.id !== notificationId);
        });
      } catch (err) {
        console.warn('[NotificationContext] Delete notification failed:', err);
      }
    },
    [],
  );

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const granted = await mobileNotificationService.requestPermission();
    setPermissionStatus(mobileNotificationService.getPermissionStatus());
    if (granted && isAuthenticated) {
      await mobileNotificationService.registerDeviceWithBackend();
    }
    return granted;
  }, [isAuthenticated]);

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([fetchUnreadCount(), fetchNotifications()]);
  }, [fetchUnreadCount, fetchNotifications]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchUnreadCount();
      fetchNotifications();
    } else {
      setUnreadCount(0);
      setNotifications([]);
    }
  }, [isAuthenticated, fetchUnreadCount, fetchNotifications]);

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        notifications,
        isLoading,
        error,
        permissionStatus,
        requestPermission,
        fetchNotifications,
        fetchUnreadCount,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        refreshAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
