import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../shared/types';
import { HealthResponse } from './health.types';
import { HealthService, healthService } from './health.service';

export class HealthController {
  constructor(private readonly service: HealthService = healthService) {}

  public getHealth = async (
    _req: Request,
    res: Response<ApiResponse<HealthResponse>>,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const healthData = await this.service.getHealth();
      res.status(200).json({
        success: true,
        data: healthData,
      });
    } catch (err) {
      next(err);
    }
  };

  public getLiveness = (_req: Request, res: Response): void => {
    const livenessData = this.service.getLiveness();
    res.status(200).json({
      success: true,
      data: livenessData,
    });
  };

  public getReadiness = (_req: Request, res: Response): void => {
    const readinessData = this.service.getReadiness();
    const statusCode = readinessData.isReady ? 200 : 503;
    res.status(statusCode).json({
      success: readinessData.isReady,
      data: readinessData,
    });
  };
}

export const healthController = new HealthController();
