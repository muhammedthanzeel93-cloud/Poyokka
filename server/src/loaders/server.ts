import http from 'http';
import { Application } from 'express';
import { env } from '../config/env';
import { db } from '../config/database';
import { bookingHoldExpiryService } from '../modules/bookings/booking-expiry.service';

export const startServer = async (app: Application): Promise<http.Server> => {
  // 1. Initial database connection must succeed BEFORE accepting requests
  console.info('[Server] Connecting to database prior to opening HTTP port...');
  await db.connect();

  // 2. Start background room inventory hold expiry worker
  // Periodically scans and expires abandoned holds to prevent Denial of Inventory (DoI)
  const holdExpiryTimer = bookingHoldExpiryService.startPeriodicWorker(
    env.NODE_ENV === 'test' ? 5000 : 60000,
  );
  console.info('[Server] Background room inventory hold expiry worker started.');

  // 3. Create HTTP server and start listening
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => {
      console.info(`[Server] Kerala Tourism API Server listening on http://${env.HOST}:${env.PORT}`);
      console.info(`[Server] Environment: ${env.NODE_ENV}`);
      console.info(`[Server] Health Endpoint: http://${env.HOST}:${env.PORT}/api/v1/health`);
      resolve();
    });
  });

  // 4. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.info(`[Server] Received ${signal}. Initiating graceful shutdown...`);

    // Stop background hold expiry worker
    if (holdExpiryTimer) {
      bookingHoldExpiryService.stopPeriodicWorker(holdExpiryTimer);
      console.info('[Server] Background hold expiry worker stopped.');
    }

    server.close(async () => {
      console.info('[Server] HTTP connections closed.');
      try {
        await db.disconnect();
      } catch (err) {
        console.error('[Server] Error while disconnecting database:', err);
      }
      console.info('[Server] Graceful shutdown complete.');
      process.exit(0);
    });

    // Force exit after 10 seconds if connections fail to close
    setTimeout(() => {
      console.error('[Server] Forcing shutdown after 10s timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 5. Global Process Exception & Rejection Protection (RISK-04)
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process Fatal] Unhandled Promise Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Process Fatal] Uncaught Exception:', err);
    shutdown('UNCAUGHT_EXCEPTION');
  });

  return server;
};
