import { Router } from 'express';
import { destinationsController } from './destinations.controller';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireActiveAccount } from '../../middlewares/authorization.middleware';
import { publicSearchRateLimiter } from '../../middlewares/rateLimiter';

const router = Router();

// Public destination discovery endpoints
router.get('/', publicSearchRateLimiter, destinationsController.listPublished);
router.get('/nearby', publicSearchRateLimiter, destinationsController.getNearby);
router.get('/search', publicSearchRateLimiter, destinationsController.searchPublished);
router.get('/categories', destinationsController.listCategories);
router.get('/:slug', destinationsController.getBySlug);

// Destination Media Endpoints
router.get('/:id/media', destinationsController.listMedia);
router.post(
  '/:id/media',
  authenticate,
  requireActiveAccount,
  destinationsController.attachMedia,
);
router.patch(
  '/:id/media/:mediaId',
  authenticate,
  requireActiveAccount,
  destinationsController.updateMedia,
);
router.delete(
  '/:id/media/:mediaId',
  authenticate,
  requireActiveAccount,
  destinationsController.deleteMedia,
);

export default router;
