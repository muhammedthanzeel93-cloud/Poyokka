import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors/AppError';
import { env } from '../config/env';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyPrefix?: string;
  keyGenerator?: (req: Request) => string;
}

const ipStore = new Map<string, RateLimitRecord>();

/**
 * Clean up expired IP entries every 5 minutes to prevent memory leaks
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipStore.entries()) {
    if (record.resetTime <= now) {
      ipStore.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Prevent cleanup timer from blocking process exit
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

/**
 * In-Memory Sliding Window Rate Limiter Middleware
 */
export const createRateLimiter = (options: RateLimiterOptions = {}) => {
  const windowMs = options.windowMs ?? (15 * 60 * 1000); // 15 minutes default
  const max = options.max ?? (env.NODE_ENV === 'test' ? 1000 : 100); // 100 requests default
  const message = options.message ?? 'Too many requests from this IP, please try again later';

  return (req: Request, res: Response, next: NextFunction): void => {
    // In test environment, allow bypassing if requested via header
    if (env.NODE_ENV === 'test' && req.headers['x-bypass-rate-limit'] === 'true') {
      return next();
    }

    const rawKey = options.keyGenerator
      ? options.keyGenerator(req)
      : req.ip || req.socket.remoteAddress || '127.0.0.1';
    const ip = options.keyPrefix ? `${options.keyPrefix}:${rawKey}` : rawKey;
    const now = Date.now();

    let record = ipStore.get(ip);
    if (!record || record.resetTime <= now) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      ipStore.set(ip, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil(record.resetTime / 1000);

    // Set standard rate limit headers
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > max) {
      res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
      return next(new AppError(message, 429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: Math.ceil((record.resetTime - now) / 1000) }));
    }

    next();
  };
};

export const rateLimiter = createRateLimiter();

/**
 * Dedicated registration rate limiter:
 * Restricts rapid user and merchant registrations to prevent abuse and credential stuffing.
 * 10 requests per 15 minutes (5 in test environment to test threshold).
 */
export const registrationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 5 : 10,
  message: 'Too many registration attempts from this IP, please try again later',
});

/**
 * Dedicated login rate limiter:
 * Limits rapid authentication attempts to prevent brute force and credential stuffing attacks.
 * 5 requests per 15 minutes per IP.
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts from this IP, please try again later',
});

/**
 * Dedicated refresh rate limiter:
 * Restricts rapid token refresh attempts.
 * 20 requests per 15 minutes per IP.
 */
export const refreshRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many token refresh requests from this IP, please try again later',
});

/**
 * Dedicated post creation rate limiter:
 * Prevents rapid spam posting and abuse on tourist post endpoints.
 * 20 requests per 15 minutes per IP.
 */
export const postCreationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many post creation attempts from this IP, please try again later',
});

/**
 * Dedicated social engagement rate limiter:
 * Prevents rapid spam liking, commenting, or reposting.
 * 60 requests per 15 minutes per IP.
 */
export const engagementRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Too many social engagement attempts from this IP, please try again later',
});

/**
 * Dedicated follow/unfollow rate limiter:
 * Prevents rapid spam follow/unfollow toggling and scraping abuse.
 * 60 requests per 15 minutes per IP.
 */
export const followRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Too many follow requests from this IP, please try again later',
});

/**
 * Dedicated admin user lifecycle mutation rate limiter:
 * Throttles sensitive account suspension and reactivation bursts per acting admin/IP.
 */
export const adminMutationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 20 : 30,
  keyPrefix: 'admin-mutation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many administrative account modification attempts, please try again later',
});

/**
 * Dedicated admin moderation action rate limiter:
 * Throttles rapid moderation queue actions per acting admin/IP.
 */
export const moderationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 20 : 60,
  keyPrefix: 'admin-moderation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many moderation actions triggered, please try again later',
});

/**
 * Dedicated tourist content report rate limiter:
 * Prevents report flooding and abusive spam reporting.
 */
export const reportRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 15 : 20,
  keyPrefix: 'tourist-report',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many content reports submitted, please try again later',
});

/**
 * Dedicated agency mutation rate limiter:
 * Throttles registration and profile updates per business account/IP.
 */
export const agencyMutationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 20 : 40,
  keyPrefix: 'agency-mutation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many agency profile updates, please try again later',
});

/**
 * Dedicated agency document rate limiter:
 * Throttles document upload attempts per business account/IP.
 */
export const agencyDocumentRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 15 : 20,
  keyPrefix: 'agency-document',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many document uploads, please try again later',
});

/**
 * Dedicated package mutation rate limiter:
 * Throttles package creation, updates, and reviews per account/IP.
 */
export const packageMutationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 20 : 40,
  keyPrefix: 'package-mutation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many package updates, please try again later',
});

/**
 * Dedicated property mutation rate limiter:
 * Throttles property creation, updates, and reviews per account/IP.
 */
export const propertyMutationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 20 : 40,
  keyPrefix: 'property-mutation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many property updates, please try again later',
});

/**
 * Dedicated room mutation rate limiter:
 * Throttles room type creation, updates, and deletions per account/IP.
 */
export const roomMutationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 20 : 40,
  keyPrefix: 'room-mutation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many room updates, please try again later',
});

/**
 * Dedicated inventory mutation rate limiter:
 * Throttles inventory bulk configuration, adjustments, and date blocking.
 */
export const inventoryMutationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 30 : 60,
  keyPrefix: 'inventory-mutation',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many inventory adjustments, please try again later',
});

/**
 * Dedicated booking hold rate limiter:
 * Throttles temporary inventory hold creation per tourist account/IP.
 */
export const bookingHoldRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 30 : 60,
  keyPrefix: 'booking-hold',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many booking hold attempts, please try again later',
});

/**
 * Dedicated payment initiation rate limiter:
 * Restricts rapid payment order creations to prevent abuse and order hoarding.
 */
export const paymentInitiationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 30 : 60,
  keyPrefix: 'payment-init',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many payment initiation attempts, please try again later',
});

/**
 * Dedicated payment verification rate limiter:
 * Prevents signature brute-forcing or replay attempts.
 */
export const paymentVerificationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 30 : 60,
  keyPrefix: 'payment-verify',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many payment verification attempts, please try again later',
});

/**
 * Dedicated payment webhook rate limiter:
 * Protects webhook ingestion endpoint against volumetric attacks.
 */
export const paymentWebhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'test' ? 120 : 300,
  keyPrefix: 'payment-webhook',
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many webhook requests, please retry later',
});

/**
 * Dedicated device push token registration rate limiter:
 * Throttles device registration bursts per tourist account/IP.
 */
export const deviceRegistrationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 30 : 60,
  keyPrefix: 'device-registration',
  keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many device registration attempts, please try again later',
});

/**
 * Dedicated public catalog and nearby discovery search rate limiter:
 * Throttles rapid volumetric web scraping queries.
 */
export const publicSearchRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 150 : 300,
  keyPrefix: 'public-search',
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || '127.0.0.1',
  message: 'Too many search queries from this IP, please try again later',
});

export const resetRateLimiter = (): void => {
  ipStore.clear();
};
