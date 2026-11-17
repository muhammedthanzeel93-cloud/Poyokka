import { NextFunction, Request, Response } from 'express';
import { RoomService, roomService } from './room.service';

export class RoomController {
  constructor(private service: RoomService = roomService) {}

  public setService(service: RoomService): void {
    this.service = service;
  }

  // ============================================================================
  // BUSINESS: ROOM TYPE MANAGEMENT
  // ============================================================================

  public createRoomType = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.createRoomType(req.user!.id, propertyId, req.body, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(201).json({
        success: true,
        data,
        message: 'Room type created successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getMyPropertyRooms = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.getPropertyRoomTypes(
        req.user!.id,
        propertyId,
        req.query as any,
      );
      res.status(200).json({
        success: true,
        data: data.items,
        total: data.total,
        message: 'Property room types retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getRoomTypeById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const data = await this.service.getRoomTypeById(req.user!.id, roomTypeId);
      res.status(200).json({
        success: true,
        data,
        message: 'Room type details retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public updateRoomType = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const data = await this.service.updateRoomType(req.user!.id, roomTypeId, req.body, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(200).json({
        success: true,
        data,
        message: 'Room type updated successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public archiveRoomType = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const result = await this.service.archiveRoomType(req.user!.id, roomTypeId, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  // ============================================================================
  // BUSINESS: INVENTORY MANAGEMENT
  // ============================================================================

  public getRoomInventory = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const data = await this.service.getRoomInventory(
        req.user!.id,
        roomTypeId,
        req.query as any,
      );
      res.status(200).json({
        success: true,
        data: data.items,
        total: data.total,
        startDate: data.startDate,
        endDate: data.endDate,
        message: 'Room inventory retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public setRoomInventoryRange = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const result = await this.service.setRoomInventoryRange(
        req.user!.id,
        roomTypeId,
        req.body,
        {
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      );
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  public updateRoomInventoryItem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId, inventoryId } = req.params as {
        roomTypeId: string;
        inventoryId: string;
      };
      const data = await this.service.updateRoomInventoryItem(
        req.user!.id,
        roomTypeId,
        inventoryId,
        req.body,
        {
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      );
      res.status(200).json({
        success: true,
        data,
        message: 'Room inventory item updated successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public blockDates = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const result = await this.service.blockDates(req.user!.id, roomTypeId, req.body, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  public unblockDates = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const result = await this.service.unblockDates(req.user!.id, roomTypeId, req.body, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  // ============================================================================
  // PUBLIC: DISCOVERY & AVAILABILITY
  // ============================================================================

  public getPublicPropertyRooms = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.getPublicPropertyRooms(propertyId);
      res.status(200).json({
        success: true,
        data: data.items,
        total: data.total,
        message: 'Public property room types retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getPublicRoomById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { roomTypeId } = req.params as { roomTypeId: string };
      const data = await this.service.getPublicRoomById(roomTypeId);
      res.status(200).json({
        success: true,
        data,
        message: 'Public room type details retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public checkPropertyAvailability = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.checkPropertyAvailability(
        propertyId,
        req.query as any,
      );
      res.status(200).json({
        success: true,
        data,
        message: 'Property room availability retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };
}

export const roomController = new RoomController();
