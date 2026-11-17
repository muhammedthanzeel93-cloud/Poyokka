import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/**
 * Correlation ID Middleware
 *
 * Extracts incoming X-Request-Id / X-Correlation-Id header (e.g. from Cloudflare / ALB)
 * or generates a new cryptographically secure UUIDv4.
 *
 * Attaches the ID to:
 * - req.id (for internal logger and error handlers)
 * - X-Request-Id response header (for client-side tracing and support correlation)
 */
export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const existingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId =
    typeof existingId === 'string' && existingId.trim()
      ? existingId.trim()
      : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};
