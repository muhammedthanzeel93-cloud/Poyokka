import { Router } from 'express';
import { ACCOUNT_TYPES, ADMIN_PERMISSIONS } from '@kerala-tourism/constants';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  requireAccountType,
  requireActiveAccount,
  requirePermission,
  requireVerifiedBusiness,
} from '../../middlewares/authorization.middleware';
import { propertyMutationRateLimiter, publicSearchRateLimiter } from '../../middlewares/rateLimiter';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middlewares/validateRequest';
import { propertyController } from './property.controller';
import {
  createPropertySchema,
  nearbyPropertyQuerySchema,
  propertyIdParamSchema,
  propertyQuerySchema,
  propertySlugParamSchema,
  publicPropertyQuerySchema,
  reviewPropertySchema,
  submitPropertyReviewSchema,
  updatePropertySchema,
} from './property.validation';

// ============================================================================
// 1. BUSINESS PROPERTY MANAGEMENT ROUTES (/api/v1/business/properties)
// ============================================================================
const businessRouter = Router();

businessRouter.post(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  propertyMutationRateLimiter,
  validateBody(createPropertySchema),
  propertyController.createProperty,
);

businessRouter.get(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateQuery(propertyQuerySchema),
  propertyController.getMyProperties,
);

businessRouter.get(
  '/:propertyId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateParams(propertyIdParamSchema),
  propertyController.getPropertyById,
);

businessRouter.patch(
  '/:propertyId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  propertyMutationRateLimiter,
  validateParams(propertyIdParamSchema),
  validateBody(updatePropertySchema),
  propertyController.updateProperty,
);

businessRouter.delete(
  '/:propertyId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  propertyMutationRateLimiter,
  validateParams(propertyIdParamSchema),
  propertyController.deleteProperty,
);

businessRouter.post(
  '/:propertyId/submit-review',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  propertyMutationRateLimiter,
  validateParams(propertyIdParamSchema),
  validateBody(submitPropertyReviewSchema),
  propertyController.submitForReview,
);

export const businessPropertyRoutes = businessRouter;

// ============================================================================
// 2. PUBLIC PROPERTY DISCOVERY ROUTES (/api/v1/properties)
// ============================================================================
const publicRouter = Router();

publicRouter.get(
  '/',
  publicSearchRateLimiter,
  validateQuery(publicPropertyQuerySchema),
  propertyController.getPublicProperties,
);

publicRouter.get(
  '/nearby',
  publicSearchRateLimiter,
  validateQuery(nearbyPropertyQuerySchema),
  propertyController.getNearbyProperties,
);

publicRouter.get(
  '/:slug',
  validateParams(propertySlugParamSchema),
  propertyController.getPublicPropertyBySlug,
);

export const publicPropertyRoutes = publicRouter;

// ============================================================================
// 3. ADMIN PROPERTY MODERATION ROUTES (/api/v1/admin/properties)
// ============================================================================
const adminRouter = Router();

adminRouter.get(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requirePermission(ADMIN_PERMISSIONS.VIEW_PROPERTIES),
  validateQuery(propertyQuerySchema),
  propertyController.getAdminProperties,
);

adminRouter.get(
  '/:propertyId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requirePermission(ADMIN_PERMISSIONS.VIEW_PROPERTIES),
  validateParams(propertyIdParamSchema),
  propertyController.getAdminPropertyById,
);

adminRouter.patch(
  '/:propertyId/review',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requirePermission(ADMIN_PERMISSIONS.MODERATE_PROPERTIES),
  propertyMutationRateLimiter,
  validateParams(propertyIdParamSchema),
  validateBody(reviewPropertySchema),
  propertyController.reviewProperty,
);

export const adminPropertyRoutes = adminRouter;
