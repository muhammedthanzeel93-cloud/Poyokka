import { Router } from 'express';
import { ACCOUNT_TYPES } from '@kerala-tourism/constants';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  requireAccountType,
  requireActiveAccount,
  requireVerifiedBusiness,
} from '../../middlewares/authorization.middleware';
import {
  inventoryMutationRateLimiter,
  roomMutationRateLimiter,
} from '../../middlewares/rateLimiter';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middlewares/validateRequest';
import { roomController } from './room.controller';
import {
  blockDatesSchema,
  createRoomTypeSchema,
  inventoryIdParamSchema,
  inventoryQuerySchema,
  propertyRoomParamsSchema,
  publicAvailabilityQuerySchema,
  roomTypeIdParamSchema,
  roomTypeQuerySchema,
  setInventorySchema,
  unblockDatesSchema,
  updateInventorySchema,
  updateRoomTypeSchema,
} from './room.validation';

// ============================================================================
// 1. BUSINESS PROPERTY ROOM ROUTES (/api/v1/business/properties/:propertyId/rooms)
// ============================================================================
const businessPropertyRoomRouter = Router({ mergeParams: true });

businessPropertyRoomRouter.post(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  roomMutationRateLimiter,
  validateParams(propertyRoomParamsSchema),
  validateBody(createRoomTypeSchema),
  roomController.createRoomType,
);

businessPropertyRoomRouter.get(
  '/',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateParams(propertyRoomParamsSchema),
  validateQuery(roomTypeQuerySchema),
  roomController.getMyPropertyRooms,
);

export const businessPropertyRoomRoutes = businessPropertyRoomRouter;

// ============================================================================
// 2. BUSINESS ROOM & INVENTORY ROUTES (/api/v1/business/rooms)
// ============================================================================
const businessRoomRouter = Router();

businessRoomRouter.get(
  '/:roomTypeId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateParams(roomTypeIdParamSchema),
  roomController.getRoomTypeById,
);

businessRoomRouter.patch(
  '/:roomTypeId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  roomMutationRateLimiter,
  validateParams(roomTypeIdParamSchema),
  validateBody(updateRoomTypeSchema),
  roomController.updateRoomType,
);

businessRoomRouter.delete(
  '/:roomTypeId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  roomMutationRateLimiter,
  validateParams(roomTypeIdParamSchema),
  roomController.archiveRoomType,
);

businessRoomRouter.get(
  '/:roomTypeId/inventory',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  validateParams(roomTypeIdParamSchema),
  validateQuery(inventoryQuerySchema),
  roomController.getRoomInventory,
);

businessRoomRouter.put(
  '/:roomTypeId/inventory',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  inventoryMutationRateLimiter,
  validateParams(roomTypeIdParamSchema),
  validateBody(setInventorySchema),
  roomController.setRoomInventoryRange,
);

businessRoomRouter.patch(
  '/:roomTypeId/inventory/:inventoryId',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  inventoryMutationRateLimiter,
  validateParams(inventoryIdParamSchema),
  validateBody(updateInventorySchema),
  roomController.updateRoomInventoryItem,
);

businessRoomRouter.post(
  '/:roomTypeId/block-dates',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  inventoryMutationRateLimiter,
  validateParams(roomTypeIdParamSchema),
  validateBody(blockDatesSchema),
  roomController.blockDates,
);

businessRoomRouter.post(
  '/:roomTypeId/unblock-dates',
  authenticate,
  requireActiveAccount,
  requireAccountType(ACCOUNT_TYPES.BUSINESS),
  requireVerifiedBusiness,
  inventoryMutationRateLimiter,
  validateParams(roomTypeIdParamSchema),
  validateBody(unblockDatesSchema),
  roomController.unblockDates,
);

export const businessRoomRoutes = businessRoomRouter;

// ============================================================================
// 3. PUBLIC PROPERTY ROOM ROUTES (/api/v1/properties/:propertyId)
// ============================================================================
const publicPropertyRoomRouter = Router({ mergeParams: true });

publicPropertyRoomRouter.get(
  '/:propertyId/rooms',
  validateParams(propertyRoomParamsSchema),
  roomController.getPublicPropertyRooms,
);

publicPropertyRoomRouter.get(
  '/:propertyId/availability',
  validateParams(propertyRoomParamsSchema),
  validateQuery(publicAvailabilityQuerySchema),
  roomController.checkPropertyAvailability,
);

export const publicPropertyRoomRoutes = publicPropertyRoomRouter;

// ============================================================================
// 4. PUBLIC ROOM ROUTES (/api/v1/rooms)
// ============================================================================
const publicRoomRouter = Router();

publicRoomRouter.get(
  '/:roomTypeId',
  validateParams(roomTypeIdParamSchema),
  roomController.getPublicRoomById,
);

export const publicRoomRoutes = publicRoomRouter;
