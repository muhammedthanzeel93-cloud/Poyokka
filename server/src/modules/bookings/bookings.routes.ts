import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  requireAccountType,
  requireActiveAccount,
} from '../../middlewares/authorization.middleware';
import {
  validateBody,
  validateParams,
} from '../../middlewares/validateRequest';
import { bookingHoldRateLimiter } from '../../middlewares/rateLimiter';
import {
  createBookingHoldSchema,
  holdIdParamSchema,
  bookingIdParamSchema,
} from './bookings.validation';
import { bookingsController } from './bookings.controller';
import { ACCOUNT_TYPES } from '@kerala-tourism/constants';

/**
 * Tourist Booking Routes (/api/v1/tourist/bookings)
 */
export const touristBookingRoutes = Router();

const touristGuards = [
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.TOURIST),
];

touristBookingRoutes.use(touristGuards);

// Temporary Inventory Hold Creation
touristBookingRoutes.post(
  '/holds',
  bookingHoldRateLimiter,
  validateBody(createBookingHoldSchema),
  bookingsController.createHold,
);

// Inspect Specific Inventory Hold
touristBookingRoutes.get(
  '/holds/:holdId',
  validateParams(holdIdParamSchema),
  bookingsController.getHoldById,
);

// Voluntary Tourist Hold Release
touristBookingRoutes.delete(
  '/holds/:holdId',
  validateParams(holdIdParamSchema),
  bookingsController.releaseHold,
);

// List Tourist Bookings
touristBookingRoutes.get(
  '/',
  bookingsController.listBookings,
);

// Retrieve Specific Booking
touristBookingRoutes.get(
  '/:bookingId',
  validateParams(bookingIdParamSchema),
  bookingsController.getBookingById,
);

/**
 * Legacy router placeholder (/api/v1/bookings)
 */
const legacyRouter = Router();
legacyRouter.get('/', bookingsController.getStatus);

export default legacyRouter;
