/**
 * Mobile UI Formatting, Date Handling & Status Logic Unit Tests
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { BOOKING_STATUSES, PAYMENT_STATUSES } from '@kerala-tourism/constants';
import { bookingService } from '../services/booking.service';
import { formatPaiseToInr, formatSecondsToTimer } from '../utils/formatters';

describe('Mobile UI Helpers & Formatting Suite', () => {
  test('1. Integer Paise to INR Currency Formatting', () => {
    // Exact rupee values (no decimal paise)
    assert.match(formatPaiseToInr(10000), /100/);
    assert.match(formatPaiseToInr(150000), /1,500/);
    assert.match(formatPaiseToInr(1008000), /10,080/);

    // Rupee values with paise fractions
    const formattedFraction = formatPaiseToInr(150050);
    assert.match(formattedFraction, /1,500\.5/);
  });

  test('2. Hold Expiry Countdown String Formatting (MM:SS)', () => {
    assert.equal(formatSecondsToTimer(900), '15:00', '15 minutes');
    assert.equal(formatSecondsToTimer(65), '01:05', '1 minute 5 seconds');
    assert.equal(formatSecondsToTimer(9), '00:09', '9 seconds');
    assert.equal(formatSecondsToTimer(0), '00:00', '0 seconds');
  });

  test('3. Idempotency Key Format & Uniqueness', () => {
    const key1 = bookingService.generateIdempotencyKey();
    const key2 = bookingService.generateIdempotencyKey();

    assert.match(key1, /^mob-hold-/);
    assert.match(key2, /^mob-hold-/);
    assert.notEqual(key1, key2, 'Generated keys must be distinct');
  });

  test('4. Booking & Payment Status Integrity Checks', () => {
    // Assert all canonical booking statuses are defined
    assert.equal(BOOKING_STATUSES.AWAITING_PAYMENT, 'AWAITING_PAYMENT');
    assert.equal(BOOKING_STATUSES.CONFIRMED, 'CONFIRMED');
    assert.equal(BOOKING_STATUSES.EXPIRED, 'EXPIRED');
    assert.equal(BOOKING_STATUSES.CANCELLED, 'CANCELLED');

    // Assert all canonical payment statuses are defined
    assert.equal(PAYMENT_STATUSES.CREATED, 'CREATED');
    assert.equal(PAYMENT_STATUSES.AUTHORIZED, 'AUTHORIZED');
    assert.equal(PAYMENT_STATUSES.CAPTURED, 'CAPTURED');
    assert.equal(PAYMENT_STATUSES.FAILED, 'FAILED');
  });
});
