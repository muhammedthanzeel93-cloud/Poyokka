import { Request, Response, NextFunction } from 'express';
import {
  deviceIdParamSchema,
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  registerDeviceSchema,
  updateNotificationPreferencesSchema,
} from '@kerala-tourism/validation';
import { UnauthorizedError } from '../../shared/errors/AppError';
import {
  NotificationService,
  notificationService,
} from './notification.service';

export class NotificationController {
  constructor(
    private readonly service: NotificationService = notificationService,
  ) {}

  // ==========================================================================
  // DEVICE ENDPOINTS
  // ==========================================================================

  public registerDevice = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = registerDeviceSchema.parse(req.body);
      const result = await this.service.registerDevice(req.user.id, input);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public listDevices = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const result = await this.service.listDevices(req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public unregisterDevice = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const { deviceId } = deviceIdParamSchema.parse(req.params);
      await this.service.unregisterDevice(req.user.id, deviceId);

      res.status(200).json({
        success: true,
        data: { message: 'Device unregistered successfully' },
      });
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // NOTIFICATION ENDPOINTS
  // ==========================================================================

  public listNotifications = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const query = listNotificationsQuerySchema.parse(req.query);
      const result = await this.service.listNotifications(req.user.id, query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getUnreadCount = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const result = await this.service.getUnreadCount(req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public markAsRead = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const { notificationId } = notificationIdParamSchema.parse(req.params);
      const notification = await this.service.markAsRead(req.user.id, notificationId);

      res.status(200).json({
        success: true,
        data: { notification },
      });
    } catch (err) {
      next(err);
    }
  };

  public markAllAsRead = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const result = await this.service.markAllAsRead(req.user.id);

      res.status(200).json({
        success: true,
        data: {
          modifiedCount: result.modifiedCount,
          message: 'All notifications marked as read',
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public deleteNotification = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const { notificationId } = notificationIdParamSchema.parse(req.params);
      await this.service.deleteNotification(req.user.id, notificationId);

      res.status(200).json({
        success: true,
        data: { message: 'Notification deleted successfully' },
      });
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // PREFERENCE ENDPOINTS
  // ==========================================================================

  public getPreferences = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const preferences = await this.service.getPreferences(req.user.id);

      res.status(200).json({
        success: true,
        data: { preferences },
      });
    } catch (err) {
      next(err);
    }
  };

  public updatePreferences = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = updateNotificationPreferencesSchema.parse(req.body);
      const preferences = await this.service.updatePreferences(req.user.id, input);

      res.status(200).json({
        success: true,
        data: { preferences },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const notificationController = new NotificationController();
