import { Request, Response, NextFunction } from 'express';
import { AgencyService, agencyService } from './agency.service';
import {
  RegisterAgencyInput,
  UpdateAgencyInput,
  UploadAgencyDocumentInput,
  AdminAgenciesQueryInput,
  ReviewAgencyInput,
} from './agency.validation';
import { UnauthorizedError } from '../../shared/errors/AppError';
import { AdminLevel, AuthenticatedPrincipal } from '@kerala-tourism/shared-types';

export class AgencyController {
  constructor(private service: AgencyService = agencyService) {}

  public setService(service: AgencyService): void {
    this.service = service;
  }

  // --- Business Agency Endpoints ---

  public registerAgency = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const input = req.body as RegisterAgencyInput;
      const agency = await this.service.registerAgency(
        req.user.id,
        input,
        req.ip,
        req.headers['user-agent'],
      );

      res.status(201).json({
        success: true,
        data: agency,
      });
    } catch (err) {
      next(err);
    }
  };

  public getOwnAgency = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const agency = await this.service.getOwnAgency(req.user.id);
      res.status(200).json({
        success: true,
        data: agency,
      });
    } catch (err) {
      next(err);
    }
  };

  public updateOwnAgency = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const input = req.body as UpdateAgencyInput;
      const agency = await this.service.updateOwnAgency(
        req.user.id,
        input,
        req.ip,
        req.headers['user-agent'],
      );

      res.status(200).json({
        success: true,
        data: agency,
      });
    } catch (err) {
      next(err);
    }
  };

  public uploadDocument = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const input = req.body as UploadAgencyDocumentInput;
      const document = await this.service.uploadDocument(
        req.user.id,
        input,
        req.ip,
        req.headers['user-agent'],
      );

      res.status(201).json({
        success: true,
        data: document,
      });
    } catch (err) {
      next(err);
    }
  };

  public deleteDocument = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const { documentId } = req.params as { documentId: string };
      const result = await this.service.deleteDocument(
        req.user.id,
        documentId,
        req.ip,
        req.headers['user-agent'],
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  // --- Admin Agency Endpoints ---

  public listAgencies = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const filters = req.query as unknown as AdminAgenciesQueryInput;
      const result = await this.service.listAgenciesForAdmin(filters);

      res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  };

  public getAgencyDetails = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { agencyId } = req.params as { agencyId: string };
      const agency = await this.service.getAgencyDetailsForAdmin(agencyId);

      res.status(200).json({
        success: true,
        data: agency,
      });
    } catch (err) {
      next(err);
    }
  };

  public reviewAgency = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required', 'AUTHENTICATION_REQUIRED');
      }

      const { agencyId } = req.params as { agencyId: string };
      const input = req.body as ReviewAgencyInput;

      const reviewerAdminLevel: AdminLevel =
        req.adminProfile?.adminLevel ||
        ((req.user as AuthenticatedPrincipal & { adminLevel?: AdminLevel }).adminLevel as AdminLevel) ||
        'MODERATOR';

      const result = await this.service.reviewAgency(
        agencyId,
        req.user.id,
        reviewerAdminLevel,
        input,
        req.ip,
        req.headers['user-agent'],
      );

      res.status(200).json({
        success: true,
        data: result.agency,
        auditLog: result.auditLog,
        message: `Agency status successfully transitioned to ${input.status}`,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const agencyController = new AgencyController();
