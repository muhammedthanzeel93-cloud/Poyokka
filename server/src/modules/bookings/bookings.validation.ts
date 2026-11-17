import { BOOKING_HOLD_RULES } from '@kerala-tourism/constants';
export {
  createBookingHoldSchema,
  holdIdParamSchema,
  bookingIdParamSchema,
  guestDetailsSchema,
  type CreateBookingHoldInput,
  type HoldIdParamInput,
  type BookingIdParamInput,
  type GuestDetailsInput,
} from '@kerala-tourism/validation';

/**
 * Returns today's date formatted as 'YYYY-MM-DD' in Asia/Kolkata timezone.
 */
export function getTodayInKolkata(referenceDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOOKING_HOLD_RULES.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(referenceDate);
}

/**
 * Parses a 'YYYY-MM-DD' string into a Date object at UTC midnight.
 */
export function parseCalendarDate(dateString: string): Date {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid calendar date string format: ${dateString}`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

/**
 * Formats a Date object as 'YYYY-MM-DD' in UTC.
 */
export function formatCalendarDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Generates an array of 'YYYY-MM-DD' date strings for stay nights.
 * Check-in date is inclusive; check-out date is exclusive.
 */
export function generateStayDates(checkIn: string, checkOut: string): string[] {
  const checkInDate = parseCalendarDate(checkIn);
  const checkOutDate = parseCalendarDate(checkOut);

  if (checkOutDate.getTime() <= checkInDate.getTime()) {
    throw new Error('Check-out date must be strictly after check-in date');
  }

  const stayDates: string[] = [];
  const current = new Date(checkInDate.getTime());

  while (current.getTime() < checkOutDate.getTime()) {
    stayDates.push(formatCalendarDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return stayDates;
}

/**
 * Calculates number of nights between checkIn and checkOut.
 */
export function calculateNights(checkIn: string, checkOut: string): number {
  return generateStayDates(checkIn, checkOut).length;
}
