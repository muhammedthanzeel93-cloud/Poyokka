import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  validateTestDatabaseUri,
  resolveTestMongoUri,
  safeDropTestDatabase,
  TestDatabaseSafetyError,
} from './test-database-guard';

describe('T01.1 — Test Database Isolation & Safety Guard Suite', () => {
  test('1. Missing TEST_MONGO_URL fails safely', () => {
    assert.throws(
      () => resolveTestMongoUri({ TEST_MONGO_URL: undefined }),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /TEST_MONGO_URL is required but not configured/);
        return true;
      },
    );

    assert.throws(
      () => resolveTestMongoUri({ TEST_MONGO_URL: '' }),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /TEST_MONGO_URL is required but not configured/);
        return true;
      },
    );

    assert.throws(
      () => resolveTestMongoUri({ TEST_MONGO_URL: '   ' }),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /TEST_MONGO_URL is required but not configured/);
        return true;
      },
    );
  });

  test('2. Production MONGO_URL cannot be used as a fallback', () => {
    // When TEST_MONGO_URL is missing, presence of MONGO_URL or MONGODB_URI must never be used
    const prodEnv = {
      TEST_MONGO_URL: undefined,
      MONGO_URL: 'mongodb://prod_user:secret@cluster0.kerala.tourism:27017/kerala_tourism',
      MONGODB_URI: 'mongodb://prod_user:secret@cluster0.kerala.tourism:27017/kerala_tourism',
    };

    assert.throws(
      () => resolveTestMongoUri(prodEnv),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(
          err.message,
          /Falling back to MONGO_URL, MONGODB_URI, or default databases is prohibited/,
        );
        return true;
      },
    );
  });

  test('3. Production database names are rejected', () => {
    // Exact production application name
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/kerala_tourism'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );

    // Database names with production keywords even if ending in _test
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/production_app_test'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /contains forbidden production keyword/);
        return true;
      },
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/kerala_prod_test'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /contains forbidden production keyword/);
        return true;
      },
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/live_data_test'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /contains forbidden production keyword/);
        return true;
      },
    );
  });

  test('4. Non-test database names are rejected', () => {
    // Staging and dev databases lacking _test suffix
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/kerala_staging'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/kerala_dev'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );

    // MongoDB system databases
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/admin'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/local'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );

    // Bare "test" without dedicated prefix
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/test'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );
  });

  test('5. Malformed MongoDB URIs are rejected', () => {
    // Non-string input
    assert.throws(
      () => validateTestDatabaseUri(null),
      /TEST_MONGO_URL is required/,
    );
    assert.throws(
      () => validateTestDatabaseUri(12345),
      /TEST_MONGO_URL is required/,
    );

    // Plain text / malformed URI
    assert.throws(
      () => validateTestDatabaseUri('invalid-mongo-connection-string'),
      /Malformed MongoDB connection URI/,
    );

    // Unsupported protocol (http / postgres)
    assert.throws(
      () => validateTestDatabaseUri('http://127.0.0.1:27017/kerala_perf_test'),
      /Unsupported protocol "http:"/,
    );

    assert.throws(
      () => validateTestDatabaseUri('postgres://127.0.0.1:5432/kerala_perf_test'),
      /Unsupported protocol "postgres:"/,
    );

    // Missing database name
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017'),
      /MongoDB connection URI must specify an explicit database name/,
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/'),
      /MongoDB connection URI must specify an explicit database name/,
    );
  });

  test('6. Valid dedicated test database configuration is accepted', () => {
    const directUri = 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test';
    const result1 = validateTestDatabaseUri(directUri);
    assert.strictEqual(result1.uri, directUri);
    assert.strictEqual(result1.dbName, 'kerala_perf_benchmark_test');
    assert.strictEqual(result1.host, '127.0.0.1:27017');
    assert.strictEqual(result1.protocol, 'mongodb:');

    // SRV protocol with query params
    const srvUri = 'mongodb+srv://test_user:test_pass@cluster.test.local/kerala_integration_test?replicaSet=rs0&authSource=admin';
    const result2 = validateTestDatabaseUri(srvUri);
    assert.strictEqual(result2.dbName, 'kerala_integration_test');
    assert.strictEqual(result2.protocol, 'mongodb+srv:');
  });

  test('7. dropDatabase() is never called for invalid configurations', async () => {
    let dropCalled = false;

    // Mock connection pointed to production database
    const fakeProdConnection = {
      readyState: 1,
      name: 'kerala_tourism',
      dropDatabase: async () => {
        dropCalled = true;
      },
    } as unknown as mongoose.Connection;

    const validatedConfig = {
      uri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      host: '127.0.0.1:27017',
      protocol: 'mongodb:',
    };

    // Should abort because active connection name does not match validated test dbName
    await assert.rejects(
      () => safeDropTestDatabase(fakeProdConnection, validatedConfig),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /does not match expected validated test database name/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called on mismatched connection');

    // Mock disconnected connection (readyState !== 1)
    const disconnectedConn = {
      readyState: 0,
      name: 'kerala_perf_benchmark_test',
      dropDatabase: async () => {
        dropCalled = true;
      },
    } as unknown as mongoose.Connection;

    await assert.rejects(
      () => safeDropTestDatabase(disconnectedConn, validatedConfig),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /connection is not active/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called on inactive connection');
  });

  test('8. Cleanup is performed only against the validated test database', async () => {
    let dropCalled = false;

    const validConnection = {
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      dropDatabase: async () => {
        dropCalled = true;
      },
    } as unknown as mongoose.Connection;

    const validatedConfig = {
      uri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      host: '127.0.0.1:27017',
      protocol: 'mongodb:',
    };

    await safeDropTestDatabase(validConnection, validatedConfig);
    assert.strictEqual(dropCalled, true, 'dropDatabase should be called when all safety invariants pass');
  });
});
