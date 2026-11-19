import mongoose from 'mongoose';

export interface ValidatedTestDatabase {
  uri: string;
  dbName: string;
  host: string;
  protocol: string;
}

export class TestDatabaseSafetyError extends Error {
  constructor(message: string) {
    super(`[TestDatabaseGuard] Safety Violation: ${message}`);
    this.name = 'TestDatabaseSafetyError';
  }
}

const FORBIDDEN_EXACT_NAMES = new Set([
  'admin',
  'local',
  'config',
  'kerala_tourism',
  'kerala_tourism_production',
  'kerala_tourism_prod',
  'production',
  'prod',
  'staging',
  'development',
  'dev',
  'test',
]);

const FORBIDDEN_SUBSTRINGS = ['prod', 'production', 'live'];

/**
 * Validates that a MongoDB URI points strictly to an isolated test database.
 * Rejects production, staging, development, reserved, or malformed URIs.
 */
export function validateTestDatabaseUri(rawUri: unknown): ValidatedTestDatabase {
  if (typeof rawUri !== 'string' || !rawUri.trim()) {
    throw new TestDatabaseSafetyError(
      'TEST_MONGO_URL is required and must be an explicitly configured non-empty string. Fallbacks to production databases or default configurations are strictly prohibited.',
    );
  }

  const trimmedUri = rawUri.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmedUri);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid URL';
    throw new TestDatabaseSafetyError(`Malformed MongoDB connection URI: "${trimmedUri}". ${msg}`);
  }

  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new TestDatabaseSafetyError(
      `Unsupported protocol "${parsed.protocol}". Performance tests strictly require "mongodb:" or "mongodb+srv:".`,
    );
  }

  if (!parsed.hostname && !parsed.host) {
    throw new TestDatabaseSafetyError(
      `MongoDB connection URI must specify a valid host: "${trimmedUri}".`,
    );
  }

  const rawPath = parsed.pathname.replace(/^\/+/, '');
  const dbName = rawPath.split('/')[0]?.split('?')[0]?.trim();

  if (!dbName) {
    throw new TestDatabaseSafetyError(
      `MongoDB connection URI must specify an explicit database name: "${trimmedUri}".`,
    );
  }

  const lowerName = dbName.toLowerCase();

  // Enforce naming convention: must end with _test
  if (!lowerName.endsWith('_test')) {
    throw new TestDatabaseSafetyError(
      `Database name "${dbName}" must end with "_test" to ensure test isolation.`,
    );
  }

  // Reject exact reserved or application names
  if (FORBIDDEN_EXACT_NAMES.has(lowerName)) {
    throw new TestDatabaseSafetyError(
      `Database name "${dbName}" is a reserved or application database name and cannot be used for tests.`,
    );
  }

  // Reject any production or live keywords
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (lowerName.includes(forbidden)) {
      throw new TestDatabaseSafetyError(
        `Database name "${dbName}" contains forbidden production keyword "${forbidden}".`,
      );
    }
  }

  return {
    uri: trimmedUri,
    dbName,
    host: parsed.host,
    protocol: parsed.protocol,
  };
}

/**
 * Resolves and validates TEST_MONGO_URL from environment.
 * Never falls back to MONGO_URL, MONGODB_URI, or default databases.
 */
export function resolveTestMongoUri(
  envOverride?: Record<string, string | undefined>,
): ValidatedTestDatabase {
  const targetEnv = envOverride || process.env;
  const testMongoUrl = targetEnv.TEST_MONGO_URL;

  if (!testMongoUrl || !testMongoUrl.trim()) {
    throw new TestDatabaseSafetyError(
      'TEST_MONGO_URL is required but not configured. Performance and database tests require an explicit TEST_MONGO_URL environment variable. Falling back to MONGO_URL, MONGODB_URI, or default databases is prohibited.',
    );
  }

  return validateTestDatabaseUri(testMongoUrl);
}

/**
 * Performs guarded destructive cleanup (dropDatabase) on a validated test database connection.
 * Guarantees that dropDatabase is never called on an invalid, unverified, or general application database.
 */
export async function safeDropTestDatabase(
  connection: mongoose.Connection,
  expected: ValidatedTestDatabase,
): Promise<void> {
  if (connection.readyState !== 1) {
    throw new TestDatabaseSafetyError(
      `Cannot drop database: connection is not active (readyState=${connection.readyState}).`,
    );
  }

  const activeDbName = connection.name;
  if (!activeDbName) {
    throw new TestDatabaseSafetyError(
      'Cannot drop database: active connection database name is undefined.',
    );
  }

  if (activeDbName !== expected.dbName) {
    throw new TestDatabaseSafetyError(
      `Active connection database name "${activeDbName}" does not match expected validated test database name "${expected.dbName}". Destructive cleanup aborted.`,
    );
  }

  if (!activeDbName.toLowerCase().endsWith('_test')) {
    throw new TestDatabaseSafetyError(
      `Active connection database name "${activeDbName}" does not end with "_test". Destructive cleanup aborted.`,
    );
  }

  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (activeDbName.toLowerCase().includes(forbidden)) {
      throw new TestDatabaseSafetyError(
        `Active connection database name "${activeDbName}" contains forbidden production keyword "${forbidden}". Destructive cleanup aborted.`,
      );
    }
  }

  await connection.dropDatabase();
}
