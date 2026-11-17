import { Router } from 'express';
import { ACCOUNT_TYPES, ADMIN_PERMISSIONS } from '@kerala-tourism/constants';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  requireAccountType,
  requireActiveAccount,
  requirePermission,
  requireVerifiedBusiness,
} from '../../middlewares/authorization.middleware';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middlewares/validateRequest';
import { packageMutationRateLimiter } from '../../middlewares/rateLimiter';
import { packageController } from './package.controller';
import {
  createPackageSchema,
  packageIdParamSchema,
  packageQuerySchema,
  packageSearchQuerySchema,
  reviewPackageSchema,
  submitPackageReviewSchema,
  updatePackageSchema,
} from './package.validation';

// ============================================================================
// 1. BUSINESS AGENCY PACKAGE ROUTES (/api/v1/business/packages)
// ============================================================================
const businessRouter = Router();

businessRouter.post(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  packageMutationRateLimiter,
  validateBody(createPackageSchema),
  packageController.createPackage,
);

businessRouter.get(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateQuery(packageQuerySchema),
  packageController.getMyPackages,
);

businessRouter.get(
  '/:packageId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateParams(packageIdParamSchema),
  packageController.getPackageById,
);

businessRouter.patch(
  '/:packageId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  packageMutationRateLimiter,
  validateParams(packageIdParamSchema),
  validateBody(updatePackageSchema),
  packageController.updatePackage,
);

businessRouter.post(
  '/:packageId/submit-review',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  packageMutationRateLimiter,
  validateParams(packageIdParamSchema),
  validateBody(submitPackageReviewSchema),
  packageController.submitForReview,
);

businessRouter.delete(
  '/:packageId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  packageMutationRateLimiter,
  validateParams(packageIdParamSchema),
  packageController.deletePackage,
);

// ============================================================================
// 2. PUBLIC PACKAGE DISCOVERY ROUTES (/api/v1/packages)
// ============================================================================
const publicRouter = Router();

publicRouter.get(
  '/',
  validateQuery(packageQuerySchema),
  packageController.listPublicPackages,
);

publicRouter.get(
  '/search',
  validateQuery(packageSearchQuerySchema),
  packageController.searchPublicPackages,
);

publicRouter.get(
  '/:slug',
  packageController.getPublicPackageBySlug,
);

// ============================================================================
// 3. ADMIN PACKAGE MODERATION ROUTES (/api/v1/admin/packages)
// ============================================================================
const adminRouter = Router();

adminRouter.get(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requirePermission(ADMIN_PERMISSIONS.VIEW_PACKAGES),
  validateQuery(packageQuerySchema),
  packageController.adminListPackages,
);

adminRouter.get(
  '/:packageId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requirePermission(ADMIN_PERMISSIONS.VIEW_PACKAGES),
  validateParams(packageIdParamSchema),
  packageController.adminGetPackageById,
);

adminRouter.patch(
  '/:packageId/review',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
  requirePermission(ADMIN_PERMISSIONS.MODERATE_PACKAGES),
  packageMutationRateLimiter,
  validateParams(packageIdParamSchema),
  validateBody(reviewPackageSchema),
  packageController.adminReviewPackage,
);

export {
  businessRouter as businessPackageRoutes,
  publicRouter as publicPackageRoutes,
  adminRouter as adminPackageRoutes,
};
