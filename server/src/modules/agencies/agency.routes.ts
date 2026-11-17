import { Router } from 'express';
import { ACCOUNT_TYPES, ADMIN_PERMISSIONS } from '@kerala-tourism/constants';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  requireAccountType,
  requireActiveAccount,
  requirePermission,
} from '../../middlewares/authorization.middleware';
import {
  adminMutationRateLimiter,
  agencyMutationRateLimiter,
  agencyDocumentRateLimiter,
} from '../../middlewares/rateLimiter';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middlewares/validateRequest';
import { agencyController } from './agency.controller';
import {
  registerAgencySchema,
  updateAgencySchema,
  uploadAgencyDocumentSchema,
  agencyIdParamSchema,
  agencyDocumentIdParamSchema,
  adminAgenciesQuerySchema,
  reviewAgencySchema,
} from './agency.validation';

// ==============================================================================
// BUSINESS AGENCY ROUTES (/api/v1/business/agency)
// ==============================================================================

export const businessAgencyRoutes = Router();

businessAgencyRoutes.use(
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
);

// Register travel agency profile
businessAgencyRoutes.post(
  '/',
  agencyMutationRateLimiter,
  validateBody(registerAgencySchema),
  agencyController.registerAgency,
);

// Get own travel agency profile
businessAgencyRoutes.get('/', agencyController.getOwnAgency);

// Update own travel agency profile
businessAgencyRoutes.patch(
  '/',
  agencyMutationRateLimiter,
  validateBody(updateAgencySchema),
  agencyController.updateOwnAgency,
);

// Upload agency document
businessAgencyRoutes.post(
  '/documents',
  agencyDocumentRateLimiter,
  validateBody(uploadAgencyDocumentSchema),
  agencyController.uploadDocument,
);

// Delete agency document
businessAgencyRoutes.delete(
  '/documents/:documentId',
  agencyMutationRateLimiter,
  validateParams(agencyDocumentIdParamSchema),
  agencyController.deleteDocument,
);

// ==============================================================================
// ADMIN AGENCY ROUTES (/api/v1/admin/agencies)
// ==============================================================================

export const adminAgencyRoutes = Router();

adminAgencyRoutes.use(
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.ADMIN),
);

// List agencies with pagination, filtering & search
adminAgencyRoutes.get(
  '/',
  requirePermission(ADMIN_PERMISSIONS.VIEW_AGENCIES),
  validateQuery(adminAgenciesQuerySchema),
  agencyController.listAgencies,
);

// Get detailed agency profile (without storage keys)
adminAgencyRoutes.get(
  '/:agencyId',
  requirePermission(ADMIN_PERMISSIONS.VIEW_AGENCIES),
  validateParams(agencyIdParamSchema),
  agencyController.getAgencyDetails,
);

// Review & transition agency verification status
adminAgencyRoutes.patch(
  '/:agencyId/review',
  requirePermission(ADMIN_PERMISSIONS.VERIFY_AGENCIES),
  adminMutationRateLimiter,
  validateParams(agencyIdParamSchema),
  validateBody(reviewAgencySchema),
  agencyController.reviewAgency,
);
