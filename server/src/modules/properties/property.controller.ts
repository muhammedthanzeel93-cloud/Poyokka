import { Request, Response, NextFunction } from 'express';
import { propertyService, PropertyService } from './property.service';

export class PropertyController {
  constructor(private service: PropertyService = propertyService) {}

  public setService(service: PropertyService): void {
    this.service = service;
  }

  // --- Business Property Management Handlers ---

  public createProperty = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.createProperty(req.user!.id, req.body);
      res.status(201).json({
        success: true,
        data,
        message: 'Property created successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getMyProperties = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.getMyProperties(req.user!.id, req.query as any);
      res.status(200).json({
        success: true,
        data: data.items,
        pagination: data.pagination,
        message: 'Properties retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getPropertyById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.getPropertyById(req.user!.id, propertyId);
      res.status(200).json({
        success: true,
        data,
        message: 'Property details retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public updateProperty = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.updateProperty(req.user!.id, propertyId, req.body);
      res.status(200).json({
        success: true,
        data,
        message: 'Property updated successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public deleteProperty = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      await this.service.deleteProperty(req.user!.id, propertyId);
      res.status(200).json({
        success: true,
        data: { deleted: true },
        message: 'Property deleted or archived successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public submitForReview = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.submitForReview(req.user!.id, propertyId, req.body);
      res.status(200).json({
        success: true,
        data,
        message: 'Property submitted for review successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  // --- Public Property Discovery Handlers ---

  public getPublicProperties = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.getPublicProperties(req.query as any);
      res.status(200).json({
        success: true,
        data: data.items,
        pagination: data.pagination,
        message: 'Public properties retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getNearbyProperties = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.getNearbyProperties(req.query as any);
      res.status(200).json({
        success: true,
        data: data.items,
        pagination: data.pagination,
        message: 'Nearby properties retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getPublicPropertyBySlug = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { slug } = req.params as { slug: string };
      const data = await this.service.getPublicPropertyBySlug(slug);
      res.status(200).json({
        success: true,
        data,
        message: 'Property details retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  // --- Admin Property Moderation Handlers ---

  public getAdminProperties = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.getAdminProperties(req.query as any);
      res.status(200).json({
        success: true,
        data: data.items,
        pagination: data.pagination,
        message: 'Admin properties retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public getAdminPropertyById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.getAdminPropertyById(propertyId);
      res.status(200).json({
        success: true,
        data,
        message: 'Property details retrieved successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public reviewProperty = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { propertyId } = req.params as { propertyId: string };
      const data = await this.service.reviewProperty(req.user!.id, propertyId, req.body);
      res.status(200).json({
        success: true,
        data,
        message: 'Property reviewed successfully',
      });
    } catch (err) {
      next(err);
    }
  };
}

export const propertyController = new PropertyController();
