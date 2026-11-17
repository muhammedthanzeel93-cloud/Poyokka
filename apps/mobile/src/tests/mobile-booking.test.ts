/**
 * Mobile Booking Engine & Inventory Hold Suite
 */

import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import { api } from '../services/api';
import { authService } from '../services/auth.service';
import { bookingService } from '../services/booking.service';
import { secureStorage } from '../services/secure-storage';

describe('Mobile Booking & Inventory Hold Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    secureStorage.resetForTesting();
    authService.setSessionForTesting('valid_tourist_jwt', {
      id: 'acc_tourist_1',
      email: 'tourist@example.com',
      accountType: 'TOURIST',
      status: 'ACTIVE',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('1. Date Boundary Validation Rules', () => {
    // Past check-in
    const pastCheck = bookingService.validateDateRange('2020-01-01', '2020-01-05');
    assert.equal(pastCheck.isValid, false);
    assert.match(pastCheck.error || '', /past/i);

    // Check-out before check-in
    const invertedDates = bookingService.validateDateRange('2026-12-10', '2026-12-05');
    assert.equal(invertedDates.isValid, false);
    assert.match(invertedDates.error || '', /after/i);

    // Exceeding 30 nights max
    const tooLong = bookingService.validateDateRange('2026-12-01', '2027-01-15');
    assert.equal(tooLong.isValid, false);
    assert.match(tooLong.error || '', /30 nights/i);

    // Valid 3-night stay
    const valid = bookingService.validateDateRange('2026-12-10', '2026-12-13');
    assert.equal(valid.isValid, true);
    assert.equal(valid.nights, 3);
  });

  test('2. Availability Check - Returns Server-Authoritative Available Units', async () => {
    global.fetch = async (url: any) => {
      assert.match(String(url), /\/api\/v1\/properties\/prop_123\/availability/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            propertyId: 'prop_123',
            propertyName: 'Vythiri Rainforest Retreat',
            checkIn: '2026-12-10',
            checkOut: '2026-12-12',
            nightsCount: 2,
            availableRoomTypes: [
              {
                roomType: {
                  id: 'room_deluxe',
                  name: 'Deluxe Suite',
                  pricePerNightPaise: 450000,
                  pricePerNight: 4500,
                },
                availableUnitsAcrossStay: 4,
                isAvailable: true,
                totalStayPrice: 9000,
              },
            ],
          },
        }),
      } as any;
    };

    const res = await bookingService.checkAvailability('prop_123', {
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      rooms: 1,
    });

    assert.equal(res.propertyId, 'prop_123');
    assert.equal(res.availableRoomTypes.length, 1);
    assert.equal(res.availableRoomTypes[0].isAvailable, true);
    assert.equal(res.availableRoomTypes[0].availableUnitsAcrossStay, 4);
  });

  test('3. Hold Creation - Transmits Idempotency-Key and Returns 15-Minute Countdown', async () => {
    let capturedIdempotencyKey: string | null = null;
    let capturedAuth: string | null = null;

    global.fetch = async (_url: any, init: any) => {
      capturedIdempotencyKey = init.headers['Idempotency-Key'];
      capturedAuth = init.headers.Authorization;

      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          data: {
            booking: {
              id: 'book_123',
              bookingReference: 'KL-B2C4-9988',
              status: 'AWAITING_PAYMENT',
              checkInDate: '2026-12-10',
              checkOutDate: '2026-12-12',
              nights: 2,
              numberOfRooms: 1,
              priceSnapshot: {
                totalPaise: 1008000,
                totalInr: 10080,
              },
            },
            hold: {
              id: 'hold_999',
              status: 'ACTIVE',
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            },
            remainingSeconds: 900,
          },
        }),
      } as any;
    };

    const customKey = 'mob-custom-idempotency-key';
    const result = await bookingService.createHold(
      {
        propertyId: 'prop_123',
        roomTypeId: 'room_deluxe',
        checkInDate: '2026-12-10',
        checkOutDate: '2026-12-12',
        numberOfRooms: 1,
        adults: 2,
        guestDetails: {
          primaryGuestName: 'Anand Kumar',
          email: 'anand@example.com',
          phone: '9847123456',
        },
      },
      customKey,
    );

    assert.equal(capturedIdempotencyKey, customKey, 'Idempotency key must match request');
    assert.equal(capturedAuth, 'Bearer valid_tourist_jwt');
    assert.equal(result.booking.bookingReference, 'KL-B2C4-9988');
    assert.equal(result.remainingSeconds, 900);
  });

  test('4. Voluntary Hold Release - Sends DELETE /holds/:holdId and Frees Inventory', async () => {
    let methodCalled = '';
    global.fetch = async (_url: any, init: any) => {
      methodCalled = init.method;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { released: true, message: 'Hold released successfully' },
        }),
      } as any;
    };

    const released = await bookingService.releaseHold('hold_999');
    assert.equal(released, true);
    assert.equal(methodCalled, 'DELETE');
  });

  test('5. Automatic 401 Interception & Transparent Single-Flight Retry', async () => {
    await secureStorage.setItemAsync('kt_mobile_refresh_token', 'valid_stored_refresh_token');

    let requestAttempts = 0;
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tourist/bookings/book_abc')) {
        requestAttempts++;
        if (requestAttempts === 1) {
          // First attempt fails with 401 Token Expired
          return {
            ok: false,
            status: 401,
            json: async () => ({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'JWT access token expired' },
            }),
          } as any;
        }
        // Second attempt (after transparent refresh) succeeds!
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { id: 'book_abc', bookingReference: 'KL-RETRY-OK', status: 'CONFIRMED' },
          }),
        } as any;
      }

      if (urlStr.includes('/api/v1/auth/refresh')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { accessToken: 'new_refreshed_access_jwt', refreshToken: 'new_refresh_token' },
          }),
        } as any;
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const booking = await api.bookings.getById('book_abc');

    assert.equal(requestAttempts, 2, 'Request should have been retried automatically after refresh');
    assert.equal(booking.data.bookingReference, 'KL-RETRY-OK');
    assert.equal(authService.getAccessToken(), 'new_refreshed_access_jwt');
  });
});
