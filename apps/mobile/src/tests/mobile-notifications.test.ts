/**
 * Mobile Push Notifications, Device Registration & Deep-Link Resolution Suite (Day 26)
 */

import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import { api } from '../services/api';
import { authService } from '../services/auth.service';
import { mobileNotificationService } from '../services/notification.service';
import { secureStorage } from '../services/secure-storage';
import { NOTIFICATION_TYPES } from '@kerala-tourism/constants';

describe('Mobile Push Notifications & Deep-Link Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    secureStorage.resetForTesting();
    mobileNotificationService.setMockToken(null);
    mobileNotificationService.setPermissionStatusForTesting('undetermined');
    authService.setSessionForTesting('valid_mobile_jwt', {
      id: 'acc_tourist_100',
      email: 'tourist100@example.com',
      accountType: 'TOURIST',
      status: 'ACTIVE',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('1. Permission Lifecycle & State Changes', async () => {
    assert.equal(mobileNotificationService.getPermissionStatus(), 'undetermined');

    const granted = await mobileNotificationService.requestPermission();
    assert.equal(granted, true);
    assert.equal(mobileNotificationService.getPermissionStatus(), 'granted');

    mobileNotificationService.setPermissionStatusForTesting('denied');
    assert.equal(mobileNotificationService.getPermissionStatus(), 'denied');
  });

  test('2. Token Generation, Caching & Override', async () => {
    const token1 = await mobileNotificationService.getDeviceToken();
    assert.ok(token1.startsWith('fcm_mobile_mock_'));

    // Second call should return identical cached token from secureStorage
    const token2 = await mobileNotificationService.getDeviceToken();
    assert.equal(token2, token1);

    // Explicit override via mock
    mobileNotificationService.setMockToken('fcm_custom_mock_token_override');
    const token3 = await mobileNotificationService.getDeviceToken();
    assert.equal(token3, 'fcm_custom_mock_token_override');
  });

  test('3. Device Registration & Unregistration API Integration', async () => {
    let registeredPayload: any = null;
    let unregisteredDeviceId: string | null = null;

    global.fetch = async (url: any, init: any) => {
      const urlStr = String(url);

      if (urlStr.endsWith('/api/v1/tourist/devices') && init?.method === 'POST') {
        registeredPayload = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              device: {
                id: 'dev_rec_123',
                maskedToken: 'fcm_mo...abcd',
                platform: registeredPayload.platform,
                deviceId: registeredPayload.deviceId,
                isActive: true,
                registeredAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
              },
            },
          }),
        } as any;
      }

      if (urlStr.includes('/api/v1/tourist/devices/dev_rec_123') && init?.method === 'DELETE') {
        unregisteredDeviceId = 'dev_rec_123';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { success: true, message: 'Device unregistered successfully' },
          }),
        } as any;
      }

      throw new Error(`Unexpected fetch URL in test: ${urlStr}`);
    };

    // 1. Register device
    const deviceId = await mobileNotificationService.registerDeviceWithBackend();
    assert.equal(deviceId, 'dev_rec_123');
    assert.ok(registeredPayload);
    assert.ok(registeredPayload.deviceToken.length > 10);
    assert.equal(registeredPayload.platform, 'ANDROID');

    // Verify device ID stored in secure storage
    const storedId = await secureStorage.getItemAsync('kt_mobile_registered_device_id');
    assert.equal(storedId, 'dev_rec_123');

    // 2. Unregister device
    await mobileNotificationService.unregisterDeviceOnLogout();
    assert.equal(unregisteredDeviceId, 'dev_rec_123');

    // Verify device ID deleted from secure storage
    const remainingId = await secureStorage.getItemAsync('kt_mobile_registered_device_id');
    assert.equal(remainingId, null);
  });

  test('4. Notification Tray & Actions Client (list, unread-count, read, delete)', async () => {
    let markReadId: string | null = null;
    let deleteId: string | null = null;
    let readAllCalled = false;

    global.fetch = async (url: any, init: any) => {
      const urlStr = String(url);

      if (urlStr.includes('/api/v1/tourist/notifications?page=1&limit=10') && (!init || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              items: [
                {
                  id: 'notif_1',
                  recipientAccountId: 'acc_tourist_100',
                  notificationType: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
                  title: 'Booking Confirmed!',
                  body: 'Stay at Wayanad Resort confirmed.',
                  isRead: false,
                  deliveryStatus: 'DELIVERED',
                  createdAt: new Date().toISOString(),
                },
              ],
              pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
            },
          }),
        } as any;
      }

      if (urlStr.endsWith('/api/v1/tourist/notifications/unread-count')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { unreadCount: 1 },
          }),
        } as any;
      }

      if (urlStr.includes('/api/v1/tourist/notifications/notif_1/read') && init?.method === 'PATCH') {
        markReadId = 'notif_1';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { id: 'notif_1', isRead: true },
          }),
        } as any;
      }

      if (urlStr.endsWith('/api/v1/tourist/notifications/read-all') && init?.method === 'PATCH') {
        readAllCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { modifiedCount: 1 },
          }),
        } as any;
      }

      if (urlStr.includes('/api/v1/tourist/notifications/notif_1') && init?.method === 'DELETE') {
        deleteId = 'notif_1';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { deleted: true },
          }),
        } as any;
      }

      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const listRes = await api.notifications.list({ page: 1, limit: 10 });
    assert.equal(listRes.data.items.length, 1);
    assert.equal(listRes.data.items[0].title, 'Booking Confirmed!');

    const countRes = await api.notifications.getUnreadCount();
    assert.equal(countRes.data.unreadCount, 1);

    await api.notifications.markAsRead('notif_1');
    assert.equal(markReadId, 'notif_1');

    await api.notifications.markAllAsRead();
    assert.equal(readAllCalled, true);

    await api.notifications.delete('notif_1');
    assert.equal(deleteId, 'notif_1');
  });

  test('5. Notification Preferences Client (get & update)', async () => {
    let updatedPrefs: any = null;

    global.fetch = async (url: any, init: any) => {
      const urlStr = String(url);

      if (urlStr.endsWith('/api/v1/tourist/notifications/preferences')) {
        if (!init || init.method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                preferences: {
                  bookingUpdates: true,
                  paymentUpdates: true,
                  socialUpdates: true,
                },
              },
            }),
          } as any;
        }

        if (init.method === 'PATCH') {
          updatedPrefs = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                preferences: {
                  bookingUpdates: false,
                  paymentUpdates: true,
                  socialUpdates: false,
                },
              },
            }),
          } as any;
        }
      }

      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const current = await api.notifications.getPreferences();
    assert.equal(current.data.preferences.bookingUpdates, true);

    const updated = await api.notifications.updatePreferences({
      bookingUpdates: false,
      socialUpdates: false,
    });
    assert.equal(updated.data.preferences.bookingUpdates, false);
    assert.equal(updated.data.preferences.socialUpdates, false);
    assert.equal(updatedPrefs.bookingUpdates, false);
    assert.equal(updatedPrefs.socialUpdates, false);
  });

  test('6. Authoritative Deep-Link Resolution (Valid vs Invalid Resources)', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);

      if (urlStr.includes('/api/v1/tourist/bookings/bk_valid_123')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              id: 'bk_valid_123',
              bookingReference: 'BK-12345678',
              status: 'CONFIRMED',
            },
          }),
        } as any;
      }

      if (urlStr.includes('/api/v1/tourist/bookings/bk_invalid_404')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            success: false,
            error: { code: 'RESOURCE_NOT_FOUND', message: 'Booking not found' },
          }),
        } as any;
      }

      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    // 1. Valid booking notification deep-links to BookingDetails
    const target1 = await mobileNotificationService.resolveDeepLinkTarget({
      route: 'booking_details',
      bookingId: 'bk_valid_123',
    });
    assert.equal(target1.screen, 'BookingDetails');
    assert.equal(target1.params?.bookingId, 'bk_valid_123');

    // 2. Deleted or missing booking safely falls back to BookingHistory list
    const target2 = await mobileNotificationService.resolveDeepLinkTarget({
      route: 'booking_details',
      bookingId: 'bk_invalid_404',
    });
    assert.equal(target2.screen, 'BookingHistory');

    // 3. Unknown or unmapped route safely falls back to NotificationCenter
    const target3 = await mobileNotificationService.resolveDeepLinkTarget({
      route: 'unknown_feed',
    });
    assert.equal(target3.screen, 'NotificationCenter');

    // 4. Corrupted or unknown notification falls back to NotificationCenter
    const target4 = await mobileNotificationService.resolveDeepLinkTarget(undefined);
    assert.equal(target4.screen, 'NotificationCenter');
  });
});
