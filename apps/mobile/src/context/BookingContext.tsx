/**
 * Booking Flow & Active Inventory Hold React Context
 *
 * Manages active hold state, live 15-minute countdown timer,
 * and idempotency key persistence across retries.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BookingDto,
  CreateBookingHoldResponseDto,
  InventoryHoldDto,
} from '@kerala-tourism/shared-types';
import { bookingService, CreateHoldParams } from '../services/booking.service';

export interface BookingContextValue {
  activeHold: InventoryHoldDto | null;
  activeBooking: BookingDto | null;
  remainingSeconds: number;
  isHoldExpired: boolean;
  activeIdempotencyKey: string | null;
  createHold(params: CreateHoldParams): Promise<CreateBookingHoldResponseDto>;
  releaseHold(): Promise<boolean>;
  refreshHold(): Promise<void>;
  clearBookingState(): void;
}

const BookingContext = createContext<BookingContextValue | null>(null);

export const BookingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeHold, setActiveHold] = useState<InventoryHoldDto | null>(null);
  const [activeBooking, setActiveBooking] = useState<BookingDto | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [isHoldExpired, setIsHoldExpired] = useState<boolean>(false);
  const [activeIdempotencyKey, setActiveIdempotencyKey] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Live countdown timer effect aligned to authoritative wall-clock time
  useEffect(() => {
    if (activeHold && !isHoldExpired) {
      const updateTimer = () => {
        const expiresAtMs = new Date(activeHold.expiresAt).getTime();
        const diffSeconds = Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000));
        setRemainingSeconds(diffSeconds);
        if (diffSeconds <= 0) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setIsHoldExpired(true);
        }
      };

      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeHold, isHoldExpired]);

  const clearBookingState = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setActiveHold(null);
    setActiveBooking(null);
    setRemainingSeconds(0);
    setIsHoldExpired(false);
    setActiveIdempotencyKey(null);
  }, []);

  const createHold = useCallback(
    async (params: CreateHoldParams): Promise<CreateBookingHoldResponseDto> => {
      // Reuse active idempotency key if one already exists for this booking attempt, otherwise generate new
      const key = activeIdempotencyKey || bookingService.generateIdempotencyKey();
      setActiveIdempotencyKey(key);

      const result = await bookingService.createHold(params, key);

      setActiveHold(result.hold);
      setActiveBooking(result.booking);
      setRemainingSeconds(result.remainingSeconds);
      setIsHoldExpired(false);

      return result;
    },
    [activeIdempotencyKey],
  );

  const releaseHold = useCallback(async (): Promise<boolean> => {
    if (!activeHold) return false;
    try {
      const released = await bookingService.releaseHold(activeHold.id);
      return released;
    } finally {
      clearBookingState();
    }
  }, [activeHold, clearBookingState]);

  const refreshHold = useCallback(async (): Promise<void> => {
    if (!activeHold) return;
    try {
      const result = await bookingService.getHold(activeHold.id);
      setActiveHold(result.hold);
      setRemainingSeconds(result.remainingSeconds);
      if (result.isExpired || result.remainingSeconds <= 0) {
        setIsHoldExpired(true);
      }
    } catch {
      // If fetching fails with 404/expired
      setIsHoldExpired(true);
    }
  }, [activeHold]);

  const value = useMemo(
    () => ({
      activeHold,
      activeBooking,
      remainingSeconds,
      isHoldExpired,
      activeIdempotencyKey,
      createHold,
      releaseHold,
      refreshHold,
      clearBookingState,
    }),
    [
      activeHold,
      activeBooking,
      remainingSeconds,
      isHoldExpired,
      activeIdempotencyKey,
      createHold,
      releaseHold,
      refreshHold,
      clearBookingState,
    ],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};

export const useBooking = (): BookingContextValue => {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBooking must be used within a BookingProvider');
  }
  return context;
};
