/**
 * Day 27 — Mobile Application End-to-End Integration Journey Test Suite
 *
 * Verifies complete client-side tourist booking, payment, notification,
 * and deep-linking lifecycle in the Expo/React Native environment:
 * 1. Authenticated Session & SecureStorage Token Persistence
 * 2. Date Boundary Validation & Room Availability Check
 * 3. 15-Minute Temporary Inventory Hold & Remaining Seconds
 * 4. Razorpay Sandbox Checkout Adapter & Backend Verification
 * 5. Authoritative Booking State & Booking History Reflection
 * 6. FCM Push Notification Device Lifecycle & Deep-Link Resolution
 */

import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import { authService } from '../services/auth.service';
import { bookingService } from '../services/booking.service';
import { paymentService } from '../services/payment.service';
import { razorpayAdapter } from '../services/razorpay.adapter';
import { mobileNotificationService } from '../services/notification.service';
import { secureStorage } from '../services/secure-storage';
import {
  BOOKING_STATUSES,
  INVENTORY_HOLD_STATUSES,
  PAYMENT_STATUSES,
} from '@kerala-tourism/constants';

describe('DAY 27 — Mobile Application End-to-End Integration Journey', () => {
  const originalFetch = global.fetch;

  const setMockFetch = (fn: (url: any, init?: any) => Promise<any>) => {
    (global as any).fetch = fn;
  };

  beforeEach(() => {
    secureStorage.resetForTesting();
    razorpayAdapter.setMockHandler(null);
    mobileNotificationService.setPermissionStatusForTesting('undetermined');
    mobileNotificationService.setMockToken(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('Complete Mobile Tourist Journey: Login -> Availability -> Hold -> Checkout -> Verification -> Notifications -> Deep-Link -> Logout', async () => {
    // ------------------------------------------------------------------------
    // Step 1: Authentication & SecureStorage Token Handling
    // ------------------------------------------------------------------------
    const mockTouristAccount = {
      id: 'acc_mobile_tourist_2026',
      email: 'mobile.tourist@kerala.voyage',
      accountType: 'TOURIST',
      status: 'ACTIVE',
    };
    const mockTokens = {
      accessToken: 'jwt_mock_access_token_mobile_tourist_2026',
      refreshToken: 'jwt_mock_refresh_token_mobile_tourist_2026',
    };

    // Simulate login API response
    setMockFetch(async (url: any, _init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/auth/login')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              account: mockTouristAccount,
              accessToken: mockTokens.accessToken,
              refreshToken: mockTokens.refreshToken,
            },
          }),
        };
      }
      if (urlStr.includes('/api/v1/tourist/devices')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              device: {
                id: 'dev_registered_id_101',
                platform: 'ANDROID',
                maskedToken: 'fcm_to..._xyz',
                isActive: true,
              },
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const account = await authService.login('mobile.tourist@kerala.voyage', 'SecurePass@2026');
    assert.equal(account.email, 'mobile.tourist@kerala.voyage');
    assert.equal(authService.isAuthenticated(), true);

    // Verify access token is held strictly in volatile memory (never written to disk/storage)
    assert.equal(authService.getAccessToken(), mockTokens.accessToken);
    const storedAccess = await secureStorage.getItemAsync('kt_access_token');
    assert.equal(storedAccess, null, 'Access token must never be written to persistent storage');

    // Verify refresh token is persisted in hardware-backed secure storage
    const storedRefresh = await secureStorage.getItemAsync('kt_mobile_refresh_token');
    assert.equal(storedRefresh, mockTokens.refreshToken);

    // ------------------------------------------------------------------------
    // Step 2: Date Boundary Validation & Room Availability Check
    // ------------------------------------------------------------------------
    const checkInDate = '2026-12-10';
    const checkOutDate = '2026-12-13'; // 3 nights

    // Client-side date boundary validation
    const dateCheck = bookingService.validateDateRange(checkInDate, checkOutDate);
    assert.equal(dateCheck.isValid, true);
    assert.equal(dateCheck.nights, 3);

    // Verify invalid inverted dates are rejected client-side before network call
    const invertedCheck = bookingService.validateDateRange('2026-12-15', '2026-12-10');
    assert.equal(invertedCheck.isValid, false);
    assert.match(invertedCheck.error || '', /after/i);

    const propertyId = 'prop_kumarakom_retreat_01';
    const roomTypeId = 'room_heritage_villa_01';

    // Mock availability endpoint response
    setMockFetch(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes(`/api/v1/properties/${propertyId}/availability`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              propertyId,
              checkIn: checkInDate,
              checkOut: checkOutDate,
              nights: 3,
              availableRoomTypes: [
                {
                  roomTypeId,
                  name: 'Heritage Backwater Villa',
                  isAvailable: true,
                  availableUnitsAcrossStay: 2,
                  basePricePaise: 1500000, // 15,000 INR
                  totalPricePaise: 4500000, // 3 nights * 15,000 INR
                },
              ],
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const availData = await bookingService.checkAvailability(propertyId, {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      rooms: 1,
    });

    assert.equal(availData.availableRoomTypes.length, 1);
    assert.equal(availData.availableRoomTypes[0].isAvailable, true);
    assert.equal(availData.availableRoomTypes[0].availableUnitsAcrossStay, 2);

    // ------------------------------------------------------------------------
    // Step 3: Temporary Inventory Hold & Live Expiry Timer
    // ------------------------------------------------------------------------
    const mockHoldId = 'hold_mob_e2e_999';
    const mockBookingId = 'bk_mob_e2e_999';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    setMockFetch(async (url: any, init: any) => {
      const urlStr = String(url);
      const headers = init?.headers || {};

      // Ensure Authorization header contains Bearer token
      assert.equal(headers['Authorization'], `Bearer ${mockTokens.accessToken}`);

      if (urlStr.includes('/api/v1/tourist/bookings/holds')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              hold: {
                id: mockHoldId,
                bookingId: mockBookingId,
                roomTypeId,
                propertyId,
                numberOfRooms: 1,
                status: INVENTORY_HOLD_STATUSES.ACTIVE,
                expiresAt,
              },
              booking: {
                id: mockBookingId,
                bookingReference: 'BK-M-2026-999',
                status: BOOKING_STATUSES.AWAITING_PAYMENT,
                priceSnapshot: {
                  basePricePaise: 1500000,
                  subtotalPaise: 4500000,
                  taxesPaise: 0,
                  totalPaise: 4500000,
                  currency: 'INR',
                },
              },
              expiresAt,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const holdResult = await bookingService.createHold({
      propertyId,
      roomTypeId,
      checkInDate,
      checkOutDate,
      numberOfRooms: 1,
      adults: 2,
      guestDetails: {
        primaryGuestName: 'Ananya Sharma',
        email: 'ananya@kerala.voyage',
        phone: '+919846019999',
      },
    });

    assert.equal(holdResult.hold.id, mockHoldId);
    assert.equal(holdResult.hold.status, INVENTORY_HOLD_STATUSES.ACTIVE);
    assert.equal(holdResult.booking.priceSnapshot.totalPaise, 4500000);

    // Verify hold remaining countdown is ~900 seconds (15 minutes)
    const expiresMs = new Date(holdResult.expiresAt).getTime();
    const remainingSeconds = Math.round((expiresMs - Date.now()) / 1000);
    assert.ok(
      remainingSeconds >= 890 && remainingSeconds <= 905,
      `Expected ~900s remaining on hold, got ${remainingSeconds}`,
    );

    // ------------------------------------------------------------------------
    // Step 4: Razorpay Sandbox Checkout Adapter & Verification
    // ------------------------------------------------------------------------
    const mockOrderId = 'order_rzp_mob_e2e_777';
    const mockPaymentId = 'pay_rzp_mob_e2e_888';
    const mockSignature = 'sig_rzp_mob_e2e_mock_hmac_valid_hash_2026';

    setMockFetch(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes(`/api/v1/tourist/bookings/${mockBookingId}/payments`)) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              payment: {
                id: 'pay_rec_01',
                providerOrderId: mockOrderId,
                amountPaise: 4500000,
                status: PAYMENT_STATUSES.PENDING,
              },
              checkoutData: {
                keyId: 'rzp_test_mobile_mock_key',
                orderId: mockOrderId,
                amountPaise: 4500000,
                currency: 'INR',
                businessName: 'Kumarakom Retreat Hospitality',
                description: 'Booking Reservation #BK-M-2026-999',
                prefill: {
                  name: 'Ananya Sharma',
                  email: 'ananya@kerala.voyage',
                  contact: '+919846019999',
                },
              },
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // 1. Initiate payment order with backend
    const initPayResult = await paymentService.initiatePayment(mockBookingId);
    assert.equal(initPayResult.checkoutData.orderId, mockOrderId);
    assert.equal(initPayResult.checkoutData.amountPaise, 4500000);

    // 2. Configure mock Razorpay SDK response
    razorpayAdapter.setMockHandler(async () => ({
      razorpay_payment_id: mockPaymentId,
      razorpay_order_id: mockOrderId,
      razorpay_signature: mockSignature,
    }));

    // 3. Launch native checkout adapter
    const checkoutResult = await paymentService.launchCheckout(initPayResult.checkoutData);
    assert.equal(checkoutResult.razorpay_payment_id, mockPaymentId);
    assert.equal(checkoutResult.razorpay_order_id, mockOrderId);

    // 4. Submit verification payload to backend
    setMockFetch(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tourist/payments/verify')) {
        const body = JSON.parse(init.body);
        assert.equal(body.paymentId, 'pay_rec_01');
        assert.equal(body.razorpay_order_id, mockOrderId);
        assert.equal(body.razorpay_payment_id, mockPaymentId);
        assert.equal(body.razorpay_signature, mockSignature);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            message: 'Payment verified and booking confirmed successfully',
            data: {
              payment: {
                id: 'pay_rec_01',
                status: PAYMENT_STATUSES.CAPTURED,
                providerPaymentId: mockPaymentId,
                amountPaise: 4500000,
              },
              booking: {
                id: mockBookingId,
                bookingReference: 'BK-M-2026-999',
                status: BOOKING_STATUSES.CONFIRMED,
              },
              isConfirmed: true,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const verifyResult = await paymentService.verifyPayment(
      initPayResult.payment.id,
      checkoutResult,
    );

    assert.equal(verifyResult.isConfirmed, true);
    assert.equal(verifyResult.booking.status, BOOKING_STATUSES.CONFIRMED);
    assert.equal(verifyResult.payment.status, PAYMENT_STATUSES.CAPTURED);

    // ------------------------------------------------------------------------
    // Step 5: Booking History Retrieval
    // ------------------------------------------------------------------------
    setMockFetch(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tourist/bookings')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              items: [
                {
                  id: mockBookingId,
                  bookingReference: 'BK-M-2026-999',
                  status: BOOKING_STATUSES.CONFIRMED,
                  checkInDate,
                  checkOutDate,
                  totalPricePaise: 4500000,
                },
              ],
              total: 1,
              page: 1,
              totalPages: 1,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const historyResult = await bookingService.listBookings();
    assert.equal(historyResult.items.length, 1);
    assert.equal(historyResult.items[0].id, mockBookingId);
    assert.equal(historyResult.items[0].status, BOOKING_STATUSES.CONFIRMED);

    // ------------------------------------------------------------------------
    // Step 6: Push Notifications, Deep-Linking & Device Unregistration
    // ------------------------------------------------------------------------
    // 1. Request notification permissions
    const permGranted = await mobileNotificationService.requestPermission();
    assert.equal(permGranted, true);
    assert.equal(mobileNotificationService.getPermissionStatus(), 'granted');

    // 2. Set deterministic mock FCM token and register device with backend
    const mockFcmToken = 'fcm_token_mobile_test_device_2026_xyz';
    mobileNotificationService.setMockToken(mockFcmToken);

    setMockFetch(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tourist/devices')) {
        const body = JSON.parse(init.body);
        assert.equal(body.deviceToken, mockFcmToken);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              device: {
                id: 'dev_registered_id_101',
                platform: 'ANDROID',
                maskedToken: 'fcm_to..._xyz',
                isActive: true,
              },
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const regDeviceId = await mobileNotificationService.registerDeviceWithBackend();
    assert.equal(regDeviceId, 'dev_registered_id_101');
    const storedDeviceId = await secureStorage.getItemAsync('kt_mobile_registered_device_id');
    assert.equal(storedDeviceId, 'dev_registered_id_101');

    // 3. Simulate Push Notification Tap & Deep-Link Resolution
    // Mock backend booking lookup for deep link validation
    setMockFetch(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes(`/api/v1/tourist/bookings/${mockBookingId}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              id: mockBookingId,
              bookingReference: 'BK-M-2026-999',
              status: BOOKING_STATUSES.CONFIRMED,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const deepLinkTarget = await mobileNotificationService.resolveDeepLinkTarget({
      route: 'booking_details',
      bookingId: mockBookingId,
      notificationType: 'BOOKING_CONFIRMED',
    });

    assert.equal(deepLinkTarget.screen, 'BookingDetails');
    assert.equal(deepLinkTarget.params?.bookingId, mockBookingId);

    // 4. Logout: Unregister device token and wipe secure storage
    let unregisterCalled = false;
    setMockFetch(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tourist/devices/dev_registered_id_101') && init?.method === 'DELETE') {
        unregisterCalled = true;
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      if (urlStr.includes('/api/v1/auth/logout')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await mobileNotificationService.unregisterDeviceOnLogout();
    assert.equal(unregisterCalled, true, 'Device must be unregistered from backend on logout');

    await authService.logout();
    const finalStoredRefresh = await secureStorage.getItemAsync('kt_mobile_refresh_token');
    const finalStoredDevice = await secureStorage.getItemAsync('kt_mobile_registered_device_id');
    assert.equal(authService.getAccessToken(), null, 'In-memory access token must be cleared on logout');
    assert.equal(finalStoredRefresh, null, 'Refresh token must be cleared on logout');
    assert.equal(finalStoredDevice, null, 'Registered device ID must be cleared on logout');
  });
});
