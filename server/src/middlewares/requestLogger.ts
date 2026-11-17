import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { env } from '../config/env';

// Define custom morgan token for request correlation ID
morgan.token('request-id', (req: Request) => req.id || (req.headers['x-request-id'] as string) || '-');

const morganLogger = morgan(
  env.NODE_ENV === 'production'
    ? '[:request-id] :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'
    : '[:request-id] :method :url :status :response-time ms - :res[content-length]',
);

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  if (env.NODE_ENV === 'test') {
    return next();
  }
  return morganLogger(req, res, next);
};
