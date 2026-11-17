export {
  createRoomTypeSchema,
  updateRoomTypeSchema,
  roomTypeIdParamSchema,
  propertyRoomParamsSchema,
  inventoryIdParamSchema,
  roomTypeQuerySchema,
  inventoryQuerySchema,
  setInventorySchema,
  updateInventorySchema,
  blockDatesSchema,
  unblockDatesSchema,
  publicAvailabilityQuerySchema,
} from '@kerala-tourism/validation';

export type {
  CreateRoomTypeInput,
  UpdateRoomTypeInput,
  RoomTypeIdParamInput,
  PropertyRoomParamsInput,
  InventoryIdParamInput,
  RoomTypeQueryInput,
  InventoryQueryInput,
  SetInventoryInput,
  UpdateInventoryInput,
  BlockDatesInput,
  UnblockDatesInput,
  PublicAvailabilityQueryInput,
} from '@kerala-tourism/validation';

/**
 * Normalizes title/name into a URL-safe, SEO-friendly slug
 */
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove non-word characters except spaces and hyphens
    .replace(/[\s_-]+/g, '-') // collapse whitespace and underscores into single hyphens
    .replace(/^-+|-+$/g, ''); // trim leading and trailing hyphens
};

/**
 * Escapes regex metacharacters in search queries to defeat ReDoS attacks
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Parses YYYY-MM-DD calendar date string into UTC midnight Date (00:00:00.000Z)
 */
export const parseCalendarDate = (dateStr: string): Date => {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);

  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid calendar date string: ${dateStr}`);
  }
  return date;
};

/**
 * Formats a Date object to YYYY-MM-DD UTC representation
 */
export const formatCalendarDate = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Generates an inclusive sequence of UTC midnight dates between startDate and endDate
 */
export const generateDateRange = (startDate: Date | string, endDate: Date | string): Date[] => {
  const start = typeof startDate === 'string' ? parseCalendarDate(startDate) : new Date(startDate.getTime());
  start.setUTCHours(0, 0, 0, 0);

  const end = typeof endDate === 'string' ? parseCalendarDate(endDate) : new Date(endDate.getTime());
  end.setUTCHours(0, 0, 0, 0);

  if (start.getTime() > end.getTime()) {
    throw new Error('startDate must be before or equal to endDate');
  }

  const dates: Date[] = [];
  const current = new Date(start.getTime());

  while (current.getTime() <= end.getTime()) {
    dates.push(new Date(current.getTime()));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
};
