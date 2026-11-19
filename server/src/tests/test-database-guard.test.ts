import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  validateTestDatabaseUri,
  resolveTestMongoUri,
  safeDropTestDatabase,
  redactMongoUri,
  extractHostname,
  TestDatabaseSafetyError,
} from './test-database-guard';

describe('T01.1 & T01.1.1 — Test Database Isolation & Safety Guard Suite', () => {
  // =========================================================================
  // 1. Environment Variable Fallback Prevention
  // =========================================================================
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

  // =========================================================================
  // 2. Database Name Validation
  // =========================================================================
  test('3. Production database names are rejected', () => {
    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/kerala_tourism'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );

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

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/test'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /must end with "_test"/);
        return true;
      },
    );
  });

  // =========================================================================
  // 3. Protocol & Malformed URI Validation
  // =========================================================================
  test('5. Malformed MongoDB URIs are rejected', () => {
    assert.throws(
      () => validateTestDatabaseUri(null),
      /TEST_MONGO_URL is required/,
    );
    assert.throws(
      () => validateTestDatabaseUri(12345),
      /TEST_MONGO_URL is required/,
    );

    assert.throws(
      () => validateTestDatabaseUri('invalid-mongo-connection-string'),
      /Malformed MongoDB connection URI/,
    );

    assert.throws(
      () => validateTestDatabaseUri('http://127.0.0.1:27017/kerala_perf_test'),
      /Unsupported protocol "http:"/,
    );

    assert.throws(
      () => validateTestDatabaseUri('postgres://127.0.0.1:5432/kerala_perf_test'),
      /Unsupported protocol "postgres:"/,
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017'),
      /MongoDB connection URI must specify an explicit database name/,
    );

    assert.throws(
      () => validateTestDatabaseUri('mongodb://127.0.0.1:27017/'),
      /MongoDB connection URI must specify an explicit database name/,
    );
  });

  // =========================================================================
  // 4. Host Isolation Policy (T01.1.1-A)
  // =========================================================================
  test('6. Approved local MongoDB test hosts are accepted without extra configuration', () => {
    // 127.0.0.1
    const res1 = validateTestDatabaseUri('mongodb://127.0.0.1:27017/perf_test');
    assert.strictEqual(res1.dbName, 'perf_test');
    assert.deepStrictEqual(res1.hosts, ['127.0.0.1:27017']);

    // localhost
    const res2 = validateTestDatabaseUri('mongodb://localhost:27017/perf_test');
    assert.strictEqual(res2.dbName, 'perf_test');
    assert.deepStrictEqual(res2.hosts, ['localhost:27017']);

    // IPv6 loopback [::1]
    const res3 = validateTestDatabaseUri('mongodb://[::1]:27017/perf_test');
    assert.strictEqual(res3.dbName, 'perf_test');
    assert.deepStrictEqual(res3.hosts, ['[::1]:27017']);
  });

  test('7. Remote hosts require explicit authorization via TEST_MONGO_ALLOWED_HOSTS', () => {
    const remoteUri = 'mongodb://test-cluster.internal:27017/kerala_perf_test';

    // Fails when TEST_MONGO_ALLOWED_HOSTS is missing
    assert.throws(
      () => validateTestDatabaseUri(remoteUri, undefined),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /Remote test host "test-cluster\.internal:27017" is not allowed/);
        assert.match(err.message, /TEST_MONGO_ALLOWED_HOSTS/);
        return true;
      },
    );

    // Fails when TEST_MONGO_ALLOWED_HOSTS does not contain this host
    assert.throws(
      () => validateTestDatabaseUri(remoteUri, 'other-cluster.internal,staging-db.local'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /not present in TEST_MONGO_ALLOWED_HOSTS allowlist/);
        return true;
      },
    );

    // Succeeds when TEST_MONGO_ALLOWED_HOSTS explicitly includes the host
    const res = validateTestDatabaseUri(remoteUri, 'test-cluster.internal');
    assert.strictEqual(res.dbName, 'kerala_perf_test');
    assert.deepStrictEqual(res.hosts, ['test-cluster.internal:27017']);
  });

  test('8. Dedicated test-cluster with mongodb+srv is supported via allowlist', () => {
    const srvUri = 'mongodb+srv://cluster.internal.test/kerala_integration_test?retryWrites=true';

    // Fails without allowlist
    assert.throws(
      () => validateTestDatabaseUri(srvUri),
      /Remote test host "cluster\.internal\.test" is not allowed/,
    );

    // Succeeds with explicit allowlist
    const res = validateTestDatabaseUri(srvUri, 'cluster.internal.test');
    assert.strictEqual(res.protocol, 'mongodb+srv:');
    assert.strictEqual(res.dbName, 'kerala_integration_test');
    assert.deepStrictEqual(res.hosts, ['cluster.internal.test']);
  });

  test('9. Production-like hostnames are rejected even if present in allowlist', () => {
    const prodHostUri = 'mongodb://production-mongo.kerala.gov.in:27017/audit_test';

    assert.throws(
      () => validateTestDatabaseUri(prodHostUri, 'production-mongo.kerala.gov.in'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /contains forbidden production keyword/);
        return true;
      },
    );

    const liveHostUri = 'mongodb://live-db.internal:27017/perf_test';
    assert.throws(
      () => validateTestDatabaseUri(liveHostUri, 'live-db.internal'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /contains forbidden production keyword/);
        return true;
      },
    );
  });

  test('10. Multi-host replica set validation validates every host', () => {
    // Both hosts are local -> allowed
    const multiLocal = 'mongodb://127.0.0.1:27017,127.0.0.1:27018/replica_test';
    const res = validateTestDatabaseUri(multiLocal);
    assert.deepStrictEqual(res.hosts, ['127.0.0.1:27017', '127.0.0.1:27018']);

    // One local and one unauthorized remote host -> rejected!
    const mixed = 'mongodb://127.0.0.1:27017,unapproved-node.internal:27017/replica_test';
    assert.throws(
      () => validateTestDatabaseUri(mixed),
      /Remote test host "unapproved-node\.internal:27017" is not allowed/,
    );
  });

  // =========================================================================
  // 5. Credential Redaction in Errors & Logs (T01.1.1-C)
  // =========================================================================
  test('11. redactMongoUri utility sanitizes username and password credentials', () => {
    const raw = 'mongodb://admin_user:super_secret_password_123!@localhost:27017/kerala_test';
    const redacted = redactMongoUri(raw);
    assert.strictEqual(redacted, 'mongodb://***:***@localhost:27017/kerala_test');
    assert.ok(!redacted.includes('super_secret_password_123!'));
    assert.ok(!redacted.includes('admin_user'));

    const srv = 'mongodb+srv://ci_runner:ci_token%40secret@cluster0.mongodb.net/kerala_test';
    const redactedSrv = redactMongoUri(srv);
    assert.strictEqual(redactedSrv, 'mongodb+srv://***:***@cluster0.mongodb.net/kerala_test');

    // URI without auth is unchanged
    const plain = 'mongodb://localhost:27017/kerala_test';
    assert.strictEqual(redactMongoUri(plain), plain);
  });

  test('12. URI credentials are never exposed in error messages', () => {
    const secretPass = 'P@ssw0rd_SUPER_SECRET_987';
    const secretUser = 'super_privileged_user';

    // A. Malformed URI with credentials
    const malformedWithAuth = `mongodb://${secretUser}:${secretPass}@bad-uri:::invalid`;
    assert.throws(
      () => validateTestDatabaseUri(malformedWithAuth),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          !err.message.includes(secretPass),
          'Secret password must not appear in malformed URI error message',
        );
        assert.ok(
          !err.message.includes(secretUser),
          'Username must not appear in malformed URI error message',
        );
        assert.match(err.message, /\*\*\*:\*\*\*@/);
        return true;
      },
    );

    // B. Unapproved remote host with credentials
    const unapprovedWithAuth = `mongodb://${secretUser}:${secretPass}@unauthorized-remote.cloud:27017/app_test`;
    assert.throws(
      () => validateTestDatabaseUri(unapprovedWithAuth),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          !err.message.includes(secretPass),
          'Secret password must not appear in unapproved host error message',
        );
        assert.ok(
          !err.message.includes(secretUser),
          'Username must not appear in unapproved host error message',
        );
        return true;
      },
    );

    // C. Non-test database name with credentials
    const invalidDbWithAuth = `mongodb://${secretUser}:${secretPass}@localhost:27017/production_kerala`;
    assert.throws(
      () => validateTestDatabaseUri(invalidDbWithAuth),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          !err.message.includes(secretPass),
          'Secret password must not appear in database name error message',
        );
        assert.ok(
          !err.message.includes(secretUser),
          'Username must not appear in database name error message',
        );
        return true;
      },
    );
  });

  // =========================================================================
  // 6. Destructive Cleanup Safeguards
  // =========================================================================
  test('13. dropDatabase() is never called for invalid configurations or mismatched connections', async () => {
    let dropCalled = false;

    // Production connection mock
    const fakeProdConnection = {
      readyState: 1,
      name: 'kerala_tourism',
      dropDatabase: async () => {
        dropCalled = true;
      },
    } as unknown as mongoose.Connection;

    const validatedConfig = {
      uri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
      redactedUri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      hosts: ['127.0.0.1:27017'],
      protocol: 'mongodb:',
    };

    await assert.rejects(
      () => safeDropTestDatabase(fakeProdConnection, validatedConfig),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /does not match expected validated test database name/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called on mismatched connection');

    // Inactive connection mock
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

  test('14. Cleanup is performed only against the validated test database', async () => {
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
      redactedUri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      hosts: ['127.0.0.1:27017'],
      protocol: 'mongodb:',
    };

    await safeDropTestDatabase(validConnection, validatedConfig);
    assert.strictEqual(dropCalled, true, 'dropDatabase should be called when all safety invariants pass');
  });

  test('15. Host helper extractHostname correctly parses host strings', () => {
    assert.strictEqual(extractHostname('localhost:27017'), 'localhost');
    assert.strictEqual(extractHostname('127.0.0.1'), '127.0.0.1');
    assert.strictEqual(extractHostname('[::1]:27017'), '::1');
    assert.strictEqual(extractHostname('cluster.mongodb.net'), 'cluster.mongodb.net');
  });
});
