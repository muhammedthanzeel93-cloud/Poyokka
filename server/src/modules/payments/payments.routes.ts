import { Router } from 'express';
import { ACCOUNT_TYPES } from '@kerala-tourism/constants';
import {
  bookingIdParamSchema,
  verifyPaymentSignatureSchema,
  paymentIdParamSchema,
} from '@kerala-tourism/validation';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireAccountType } from '../../middlewares/authorization.middleware';
import { validateBody, validateParams } from '../../middlewares/validateRequest';
import {
  paymentInitiationRateLimiter,
  paymentVerificationRateLimiter,
} from '../../middlewares/rateLimiter';
import { paymentsController } from './payments.controller';

// -----------------------------------------------------------------------------
// TOURIST DIRECT PAYMENT ROUTES (Mounted under /api/v1/tourist/payments)
// -----------------------------------------------------------------------------
export const touristPaymentRoutes = Router();

// POST /api/v1/tourist/payments/verify
touristPaymentRoutes.post(
  '/verify',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.TOURIST),
  paymentVerificationRateLimiter,
  validateBody(verifyPaymentSignatureSchema),
  paymentsController.verifyPayment,
);

// GET /api/v1/tourist/payments/:paymentId
touristPaymentRoutes.get(
  '/:paymentId',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.TOURIST),
  validateParams(paymentIdParamSchema),
  paymentsController.getPaymentById,
);

// -----------------------------------------------------------------------------
// TOURIST BOOKING PAYMENT ROUTES (Can be mounted on /api/v1/tourist/bookings)
// -----------------------------------------------------------------------------
export const touristBookingPaymentRoutes = Router();

// POST /api/v1/tourist/bookings/:bookingId/payments
touristBookingPaymentRoutes.post(
  '/:bookingId/payments',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.TOURIST),
  paymentInitiationRateLimiter,
  validateParams(bookingIdParamSchema),
  paymentsController.initiatePayment,
);

// GET /api/v1/tourist/bookings/:bookingId/payment
touristBookingPaymentRoutes.get(
  '/:bookingId/payment',
  authenticate,
  requireAccountType(ACCOUNT_TYPES.TOURIST),
  validateParams(bookingIdParamSchema),
  paymentsController.getPaymentByBookingId,
);

// -----------------------------------------------------------------------------
// LEGACY BACKWARD COMPATIBLE ROUTER (Mounted on /api/v1/payments)
// -----------------------------------------------------------------------------
const router = Router();
router.get('/', paymentsController.getStatus);

export default router;
