import { Router } from 'express';
import { ACCOUNT_TYPES } from '@kerala-tourism/constants';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireAccountType } from '../../middlewares/authorization.middleware';
import { deviceRegistrationRateLimiter } from '../../middlewares/rateLimiter';
import { notificationController } from './notification.controller';

// Device Routes (/api/v1/tourist/devices)
const deviceRouter = Router();

deviceRouter.use(authenticate, requireAccountType(ACCOUNT_TYPES.TOURIST));

deviceRouter.post('/', deviceRegistrationRateLimiter, notificationController.registerDevice);
deviceRouter.get('/', notificationController.listDevices);
deviceRouter.delete('/:deviceId', notificationController.unregisterDevice);

export const touristDeviceRoutes = deviceRouter;

// Notification Routes (/api/v1/tourist/notifications)
const notificationRouter = Router();

notificationRouter.use(authenticate, requireAccountType(ACCOUNT_TYPES.TOURIST));

notificationRouter.get('/', notificationController.listNotifications);
notificationRouter.get('/unread-count', notificationController.getUnreadCount);
notificationRouter.get('/preferences', notificationController.getPreferences);
notificationRouter.patch('/preferences', notificationController.updatePreferences);
notificationRouter.patch('/:notificationId/read', notificationController.markAsRead);
notificationRouter.patch('/read-all', notificationController.markAllAsRead);
notificationRouter.delete('/:notificationId', notificationController.deleteNotification);

export const touristNotificationRoutes = notificationRouter;
