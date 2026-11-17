import { HealthResponse } from './health.types';
import { HealthDatabaseStatus } from '../../shared/types';
import { db } from '../../config/database';
import { env } from '../../config/env';

export class HealthService {
  public async getHealth(): Promise<HealthResponse> {
    const dbStatus = db.getSafeStatus();

    const overallStatus: HealthResponse['status'] =
      dbStatus.status === 'connected' ? 'healthy' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      environment: env.NODE_ENV,
      version: '1.0.0',
      database: dbStatus,
      services: {
        api: 'up',
      },
    };
  }

  public getLiveness(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    };
  }

  public getReadiness(): {
    isReady: boolean;
    status: string;
    database: HealthDatabaseStatus;
    timestamp: string;
  } {
    const dbStatus = db.getSafeStatus();
    const isReady = dbStatus.status === 'connected';
    return {
      isReady,
      status: isReady ? 'ready' : 'not_ready',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}

export const healthService = new HealthService();
