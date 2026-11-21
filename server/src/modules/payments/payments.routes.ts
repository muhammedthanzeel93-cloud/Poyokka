import { Router } from 'express';
import { ACCOUNT_TYPES, ADMIN_PERMISSIONS } from '@kerala-tourism/constants';
import {
  bookingIdParamSchema,
  verifyPaymentSignatureSchema,
  paymentIdParamSchema,
  refundPaymentSchema,
  refundIdParamSchema,
  paymentQueryFilterSchema,
} from '@kerala-tourism/validation';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  requireAccountType,
  requireActiveAccount,
  requireAnyPermission,
} from '../../middlewares/authorization.middleware';
import { validateBody, validateParams, validateQuery } from '../../middlewares/validateRequest';
import {
  paymentInitiationRateLimiter,
  paymentVerificationRateLimiter,
  adminMutationRateLimiter,
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
// ADMIN PAYMENT & RECONCILIATION ROUTES (Mounted under /api/v1/admin/payments)
// -----------------------------------------------------------------------------
export const adminPaymentRoutes = Router();

// POST /api/v1/admin/payments/:paymentId/refund
adminPaymentRoutes.post(
  '/:paymentId/refund',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requireAnyPermission([ADMIN_PERMISSIONS.MANAGE_BOOKINGS, ADMIN_PERMISSIONS.HANDLE_DISPUTES]),
  adminMutationRateLimiter,
  validateParams(paymentIdParamSchema),
  validateBody(refundPaymentSchema),
  paymentsController.refundPayment,
);

// GET /api/v1/admin/payments/refunds/:refundId
adminPaymentRoutes.get(
  '/refunds/:refundId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requireAnyPermission([
    ADMIN_PERMISSIONS.MANAGE_BOOKINGS,
    ADMIN_PERMISSIONS.HANDLE_DISPUTES,
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
  ]),
  validateParams(refundIdParamSchema),
  paymentsController.getRefundById,
);

// GET /api/v1/admin/payments/:paymentId/refunds
adminPaymentRoutes.get(
  '/:paymentId/refunds',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requireAnyPermission([
    ADMIN_PERMISSIONS.MANAGE_BOOKINGS,
    ADMIN_PERMISSIONS.HANDLE_DISPUTES,
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
  ]),
  validateParams(paymentIdParamSchema),
  paymentsController.listRefundsForPayment,
);

// GET /api/v1/admin/payments/:paymentId
adminPaymentRoutes.get(
  '/:paymentId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requireAnyPermission([
    ADMIN_PERMISSIONS.MANAGE_BOOKINGS,
    ADMIN_PERMISSIONS.HANDLE_DISPUTES,
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
  ]),
  validateParams(paymentIdParamSchema),
  paymentsController.getAdminPaymentById,
);

// GET /api/v1/admin/payments
adminPaymentRoutes.get(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requireAnyPermission([
    ADMIN_PERMISSIONS.MANAGE_BOOKINGS,
    ADMIN_PERMISSIONS.HANDLE_DISPUTES,
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
  ]),
  validateQuery(paymentQueryFilterSchema),
  paymentsController.listAdminPayments,
);

// -----------------------------------------------------------------------------
// LEGACY BACKWARD COMPATIBLE ROUTER (Mounted on /api/v1/payments)
// -----------------------------------------------------------------------------
const router = Router();
router.get('/', paymentsController.getStatus);

export default router;
