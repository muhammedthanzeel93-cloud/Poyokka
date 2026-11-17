/**
 * Mobile Booking & Inventory Hold Service
 *
 * Coordinates availability checks, temporary inventory holds,
 * voluntary hold releases, and booking history retrieval.
 */

import {
  BookingDto,
  CreateBookingHoldResponseDto,
  InventoryHoldDto,
  PropertyAvailabilityResponseDto,
} from '@kerala-tourism/shared-types';
import { api } from './api';

export interface CreateHoldParams {
  propertyId: string;
  roomTypeId: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  numberOfRooms: number;
  adults: number;
  children?: number;
  guestDetails: {
    primaryGuestName: string;
    email: string;
    phone: string;
    specialRequests?: string | null;
  };
}

export class BookingService {
  /**
   * Generates a unique client-side idempotency key for booking hold creation
   */
  public generateIdempotencyKey(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `mob-hold-${timestamp}-${random}`;
  }

  /**
   * Validates date boundaries according to Kerala Tourism booking rules
   */
  public validateDateRange(
    checkInDate: string,
    checkOutDate: string,
  ): { isValid: boolean; nights: number; error?: string } {
    const checkInRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!checkInRegex.test(checkInDate) || !checkInRegex.test(checkOutDate)) {
      return { isValid: false, nights: 0, error: 'Dates must be in YYYY-MM-DD format' };
    }

    const checkIn = new Date(`${checkInDate}T00:00:00Z`);
    const checkOut = new Date(`${checkOutDate}T00:00:00Z`);

    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      return { isValid: false, nights: 0, error: 'Invalid calendar dates' };
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (checkIn.getTime() < today.getTime()) {
      return { isValid: false, nights: 0, error: 'Check-in date cannot be in the past' };
    }

    if (checkOut.getTime() <= checkIn.getTime()) {
      return { isValid: false, nights: 0, error: 'Check-out date must be after check-in date' };
    }

    const diffDays = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 30) {
      return { isValid: false, nights: diffDays, error: 'Maximum stay duration is 30 nights' };
    }

    return { isValid: true, nights: diffDays };
  }

  /**
   * Checks real-time room availability for stay dates
   */
  public async checkAvailability(
    propertyId: string,
    params: {
      checkIn: string;
      checkOut: string;
      adults?: number;
      children?: number;
      rooms?: number;
    },
  ): Promise<PropertyAvailabilityResponseDto> {
    const res = await api.properties.checkAvailability(propertyId, params);
    return res.data;
  }

  /**
   * Creates a 15-minute temporary inventory hold with idempotent retry support
   */
  public async createHold(
    params: CreateHoldParams,
    idempotencyKey?: string,
  ): Promise<CreateBookingHoldResponseDto> {
    const key = idempotencyKey || this.generateIdempotencyKey();
    const res = await api.bookings.createHold(params, key);
    return res.data;
  }

  /**
   * Inspects active hold status and live remaining seconds
   */
  public async getHold(
    holdId: string,
  ): Promise<{ hold: InventoryHoldDto; remainingSeconds: number; isExpired: boolean }> {
    const res = await api.bookings.getHold(holdId);
    return res.data;
  }

  /**
   * Voluntarily releases hold before payment and restores inventory
   */
  public async releaseHold(holdId: string): Promise<boolean> {
    const res = await api.bookings.releaseHold(holdId);
    return res.data.released;
  }

  /**
   * Lists bookings for the authenticated tourist
   */
  public async listBookings(params?: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: BookingDto[]; total: number; page: number; totalPages: number }> {
    const res = await api.bookings.list(params);
    return res.data;
  }

  /**
   * Retrieves single booking details
   */
  public async getBooking(bookingId: string): Promise<BookingDto> {
    const res = await api.bookings.getById(bookingId);
    return res.data;
  }
}

export const bookingService = new BookingService();
