import { Request, Response, NextFunction } from 'express';
import { PackageService, packageService as defaultPackageService } from './package.service';
import {
  CreatePackageInput,
  PackageQueryInput,
  PackageSearchQueryInput,
  ReviewPackageInput,
  UpdatePackageInput,
} from './package.validation';

export class PackageController {
  constructor(private packageService: PackageService = defaultPackageService) {}

  public setService(service: PackageService): void {
    this.packageService = service;
  }

  // ============================================================================
  // BUSINESS AGENCY HANDLERS
  // ============================================================================

  public createPackage = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.createPackage(
        req.user!.id,
        req.body as CreatePackageInput,
      );
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getMyPackages = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.getMyPackages(
        req.user!.id,
        req.query as unknown as PackageQueryInput,
      );
      res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPackageById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.getPackageById(req.user!.id, req.params.packageId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public updatePackage = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.updatePackage(
        req.user!.id,
        req.params.packageId,
        req.body as UpdatePackageInput,
      );
      res.status(200).json({
        success: true,
        data: result,
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
      const result = await this.packageService.submitPackageForReview(
        req.user!.id,
        req.params.packageId,
      );
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public deletePackage = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.deletePackage(req.user!.id, req.params.packageId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  // ============================================================================
  // PUBLIC DISCOVERY HANDLERS
  // ============================================================================

  public listPublicPackages = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.getPublicPackages(
        req.query as unknown as PackageQueryInput,
      );
      res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  };

  public searchPublicPackages = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.searchPublicPackages(
        req.query as unknown as PackageSearchQueryInput,
      );
      res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPublicPackageBySlug = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.getPublicPackageBySlug(req.params.slug);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  // ============================================================================
  // ADMIN MODERATION HANDLERS
  // ============================================================================

  public adminListPackages = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.adminListPackages(
        req.query as unknown as PackageQueryInput,
      );
      res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  };

  public adminGetPackageById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.adminGetPackageById(req.params.packageId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public adminReviewPackage = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.packageService.adminReviewPackage(
        req.user!.id,
        req.params.packageId,
        req.body as ReviewPackageInput,
      );
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const packageController = new PackageController();
