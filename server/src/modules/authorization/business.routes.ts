import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireAccountType } from '../../middlewares/authorization.middleware';
import { validateBody } from '../../middlewares/validateRequest';
import { updateBusinessProfileSchema } from '@kerala-tourism/validation';
import { authorizationController } from './authorization.controller';
import { businessAgencyRoutes } from '../agencies/agency.routes';
import { businessPackageRoutes } from '../packages';
import { businessPropertyRoutes } from '../properties';
import { businessPropertyRoomRoutes, businessRoomRoutes } from '../rooms';
import { ACCOUNT_TYPES } from '@kerala-tourism/constants';

const router = Router();

// Business Profile: Self-Read
router.get(
  '/profile',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  authorizationController.getBusinessProfile,
);

// Business Profile: Self-Update
router.patch(
  '/profile',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateBody(updateBusinessProfileSchema),
  authorizationController.updateBusinessProfile,
);

// Business Dashboard: All Active Businesses
router.get(
  '/dashboard',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  authorizationController.getBusinessDashboard,
);

// Accommodation Properties Management (Day 21)
router.use('/properties/:propertyId/rooms', businessPropertyRoomRoutes);
router.use('/properties', businessPropertyRoutes);

// Room & Inventory Management (Day 22)
router.use('/rooms', businessRoomRoutes);

// Travel Packages Management (Day 20)
router.use('/packages', businessPackageRoutes);

// Booking Inspection: Business Ownership
router.get(
  '/bookings/:bookingId',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  authorizationController.getBusinessBooking,
);

// Travel Agency Profile Management (Day 19)
router.use('/agency', businessAgencyRoutes);

export default router;
