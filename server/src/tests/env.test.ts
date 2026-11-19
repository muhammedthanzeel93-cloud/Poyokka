import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../config/env';

test('Environment Validation - Valid Production Configurations', () => {
  const valid = parseEnv({
    PORT: '8080',
    NODE_ENV: 'production',
    MONGO_URL: 'mongodb+srv://dbuser:StrongPass123@cluster0.kerala.mongodb.net/kerala_production',
    CLIENT_URL: 'https://keralatourism.gov.in',
    CORS_ORIGINS: 'https://keralatourism.gov.in,https://admin.keralatourism.gov.in',
    JWT_ACCESS_SECRET: 'super-secure-production-jwt-access-secret-entropy-999',
    RAZORPAY_KEY_ID: 'rzp_live_realproductionkey123',
    RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_20_chars_entropy',
    RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_20_chars_entropy',
  });

  assert.strictEqual(valid.PORT, 8080, 'Port should be coerced to number 8080');
  assert.strictEqual(valid.NODE_ENV, 'production', 'Node env should match production');
  assert.strictEqual(valid.CLIENT_URL, 'https://keralatourism.gov.in');
  assert.ok(valid.CORS_ORIGINS.includes('https://keralatourism.gov.in'));
});

test('Environment Validation - Fail Fast on Insecure Localhost MongoDB in Production', () => {
  assert.throws(
    () => {
      parseEnv({
        PORT: '8080',
        NODE_ENV: 'production',
        MONGO_URL: 'mongodb://127.0.0.1:27017/kerala_production',
        CLIENT_URL: 'https://keralatourism.gov.in',
        CORS_ORIGINS: 'https://keralatourism.gov.in',
        JWT_ACCESS_SECRET: 'super-secure-production-jwt-access-secret-entropy-999',
        RAZORPAY_KEY_ID: 'rzp_live_realproductionkey123',
        RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_20_chars_entropy',
        RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_20_chars_entropy',
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes('[EnvConfig Fatal Error]'));
      assert.ok(err.message.includes('MONGO_URL'));
      return true;
    },
  );
});

test('Environment Validation - Fail Fast on Insecure HTTP CLIENT_URL in Production', () => {
  assert.throws(
    () => {
      parseEnv({
        PORT: '8080',
        NODE_ENV: 'production',
        MONGO_URL: 'mongodb+srv://cluster0.kerala.mongodb.net/kerala_production',
        CLIENT_URL: 'http://insecure-domain.gov.in',
        CORS_ORIGINS: 'https://keralatourism.gov.in',
        JWT_ACCESS_SECRET: 'super-secure-production-jwt-access-secret-entropy-999',
        RAZORPAY_KEY_ID: 'rzp_live_realproductionkey123',
        RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_20_chars_entropy',
        RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_20_chars_entropy',
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes('[EnvConfig Fatal Error]'));
      assert.ok(err.message.includes('CLIENT_URL'));
      return true;
    },
  );
});

test('Environment Validation - Fail Fast on Placeholder Razorpay in Production', () => {
  assert.throws(
    () => {
      parseEnv({
        PORT: '8080',
        NODE_ENV: 'production',
        MONGO_URL: 'mongodb+srv://cluster0.kerala.mongodb.net/kerala_production',
        CLIENT_URL: 'https://keralatourism.gov.in',
        CORS_ORIGINS: 'https://keralatourism.gov.in',
        JWT_ACCESS_SECRET: 'super-secure-production-jwt-access-secret-entropy-999',
        RAZORPAY_KEY_ID: 'rzp_test_placeholder_key_id',
        RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_20_chars_entropy',
        RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_20_chars_entropy',
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes('[EnvConfig Fatal Error]'));
      assert.ok(err.message.includes('RAZORPAY_KEY_ID'));
      return true;
    },
  );
});

test('Environment Validation - Fail Fast on Insecure HTTP CORS_ORIGINS in Production', () => {
  assert.throws(
    () => {
      parseEnv({
        PORT: '8080',
        NODE_ENV: 'production',
        MONGO_URL: 'mongodb+srv://cluster0.kerala.mongodb.net/kerala_production',
        CLIENT_URL: 'https://keralatourism.gov.in',
        CORS_ORIGINS: 'http://localhost:3000,https://admin.keralatourism.gov.in',
        JWT_ACCESS_SECRET: 'super-secure-production-jwt-access-secret-entropy-999',
        RAZORPAY_KEY_ID: 'rzp_live_realproductionkey123',
        RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_20_chars_entropy',
        RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_20_chars_entropy',
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes('[EnvConfig Fatal Error]'));
      assert.ok(err.message.includes('CORS_ORIGINS'));
      return true;
    },
  );
});

test('Environment Validation - Backward-Compatible Aliases', () => {
  const withAliases = parseEnv({
    PORT: '5000',
    NODE_ENV: 'development',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/kerala_alias',
    CORS_ORIGIN: 'http://localhost:3000',
  });

  assert.strictEqual(withAliases.MONGO_URL, 'mongodb://127.0.0.1:27017/kerala_alias');
  assert.strictEqual(withAliases.CORS_ORIGINS, 'http://localhost:3000');
});

test('Environment Validation - Fail Fast on Invalid PORT', () => {
  assert.throws(
    () => {
      parseEnv({
        PORT: 'invalid-port-string',
        NODE_ENV: 'development',
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes('[EnvConfig Fatal Error]'));
      assert.ok(err.message.includes('PORT'));
      return true;
    },
  );
});

test('Environment Validation - Fail Fast on Invalid NODE_ENV', () => {
  assert.throws(
    () => {
      parseEnv({
        PORT: '5000',
        NODE_ENV: 'unsupported_environment',
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes('[EnvConfig Fatal Error]'));
      assert.ok(err.message.includes('NODE_ENV'));
      return true;
    },
  );
});
