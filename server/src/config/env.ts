import dotenv from 'dotenv';
import path from 'path';
import { envSchema, EnvConfig } from '@kerala-tourism/validation';

// Load .env from workspace root first, then local fallback
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const parseEnv = (overrideEnv?: Record<string, string | undefined>): EnvConfig => {
  const source = overrideEnv || process.env;
  const result = envSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    PORT: source.PORT,
    HOST: source.HOST,
    MONGO_URL: source.MONGO_URL,
    MONGODB_URI: source.MONGODB_URI,
    CLIENT_URL: source.CLIENT_URL,
    CORS_ORIGINS: source.CORS_ORIGINS,
    CORS_ORIGIN: source.CORS_ORIGIN,
    TRUST_PROXY: source.TRUST_PROXY,
    JWT_ACCESS_SECRET: source.JWT_ACCESS_SECRET,
    JWT_ACCESS_EXPIRES_IN: source.JWT_ACCESS_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN_DAYS: source.JWT_REFRESH_EXPIRES_IN_DAYS,
    JWT_ISSUER: source.JWT_ISSUER,
    JWT_AUDIENCE: source.JWT_AUDIENCE,
    RAZORPAY_KEY_ID: source.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: source.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: source.RAZORPAY_WEBHOOK_SECRET,
    FIREBASE_PROJECT_ID: source.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: source.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: source.FIREBASE_PRIVATE_KEY,
    FIREBASE_SIMULATED: source.FIREBASE_SIMULATED,
  });

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => ` - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`[EnvConfig Fatal Error] Invalid environment configuration:\n${errorDetails}`);
  }

  return result.data;
};

export const env = parseEnv();
