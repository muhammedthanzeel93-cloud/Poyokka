import { Request, Response, NextFunction } from 'express';
import { BookingStatus } from '@kerala-tourism/shared-types';
import { BookingsService, bookingsService } from './bookings.service';

export class BookingsController {
  constructor(private readonly service: BookingsService = bookingsService) {}

  public get serviceInstance(): BookingsService {
    return this.service;
  }

  public createHold = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const rawIdempKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
      const idempotencyKey = typeof rawIdempKey === 'string' ? rawIdempKey : undefined;

      const result = await this.service.createHold(touristAccountId, req.body, idempotencyKey);

      res.status(201).json({
        success: true,
        message: 'Temporary inventory hold created successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getHoldById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { holdId } = req.params;

      const result = await this.service.getHoldById(holdId, touristAccountId);

      res.status(200).json({
        success: true,
        message: 'Hold details retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public releaseHold = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { holdId } = req.params;

      const result = await this.service.releaseHold(holdId, touristAccountId);

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  public getBookingById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { bookingId } = req.params;

      const result = await this.service.getBookingById(bookingId, touristAccountId);

      res.status(200).json({
        success: true,
        message: 'Booking details retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public listBookings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const touristAccountId = req.user!.id;
      const { status, page, limit } = req.query;

      const result = await this.service.listTouristBookings(touristAccountId, {
        status: typeof status === 'string' ? (status as BookingStatus) : undefined,
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      });

      res.status(200).json({
        success: true,
        message: 'Bookings retrieved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  // Backward compatibility
  public getStatus = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.getStatus();
      res.status(200).json({
        success: true,
        message: 'Bookings module initialized and ready',
        data,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const bookingsController = new BookingsController();
