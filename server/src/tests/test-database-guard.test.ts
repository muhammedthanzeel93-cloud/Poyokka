import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  validateTestDatabaseUri,
  resolveTestMongoUri,
  safeDropTestDatabase,
  redactMongoUri,
  extractHostname,
  extractPort,
  extractActualConnectionHosts,
  verifyConnectionHostIdentity,
  TestDatabaseSafetyError,
} from './test-database-guard';

describe('T01.1 & T01.1.1 & T01.1.2 — Test Database Isolation & Host Guard Suite', () => {
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
  // 6. Actual Connection Host Verification & Regression Suite (T01.1.2-A & B)
  // =========================================================================
  interface MockConnectionOptions {
    readyState?: number;
    name?: string;
    host?: string;
    port?: number;
    servers?: string[];
    clientHosts?: Array<{ host: string; port?: number; toString?: () => string }>;
    onDrop?: () => void;
  }

  function createMockConnection(opts: MockConnectionOptions): mongoose.Connection {
    let serversMap: Map<string, unknown> | undefined;
    if (opts.servers) {
      serversMap = new Map();
      for (const s of opts.servers) {
        serversMap.set(s, {});
      }
    }

    const client = {
      topology: serversMap ? { description: { servers: serversMap } } : undefined,
      s: opts.clientHosts ? { options: { hosts: opts.clientHosts } } : undefined,
    };

    return {
      readyState: opts.readyState !== undefined ? opts.readyState : 1,
      name: opts.name,
      host: opts.host,
      port: opts.port,
      client: client.topology || client.s ? client : undefined,
      dropDatabase: async () => {
        if (opts.onDrop) opts.onDrop();
      },
    } as unknown as mongoose.Connection;
  }

  const standardValidatedDb = {
    uri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
    redactedUri: 'mongodb://127.0.0.1:27017/kerala_perf_benchmark_test',
    dbName: 'kerala_perf_benchmark_test',
    hosts: ['127.0.0.1:27017'],
    protocol: 'mongodb:',
  };

  test('13. Host Mismatch 1: Database name matches, but connected host differs -> rejected and no dropDatabase', async () => {
    let dropCalled = false;
    const mismatchedHostConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      host: '192.168.1.100',
      port: 27017,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(mismatchedHostConn, standardValidatedDb),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /Connected host "192\.168\.1\.100:27017" does not match any validated host/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called when connected host differs');
  });

  test('14. Host Mismatch 2: Validated URI is authorized, but connection reports unauthorized host -> rejected and no dropDatabase', async () => {
    let dropCalled = false;
    const authorizedRemoteDb = {
      uri: 'mongodb://test-cluster.internal:27017/kerala_perf_benchmark_test',
      redactedUri: 'mongodb://test-cluster.internal:27017/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      hosts: ['test-cluster.internal:27017'],
      protocol: 'mongodb:',
    };

    // Connection unexpectedly connected to a different or rogue server
    const rogueConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      host: 'rogue-server.internal',
      port: 27017,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(rogueConn, authorizedRemoteDb, 'test-cluster.internal'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /Connected host "rogue-server\.internal:27017" does not match any validated host/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called on unauthorized connection');
  });

  test('15. Host Mismatch 3: Replica-set connection contains unexpected member -> rejected and no dropDatabase', async () => {
    let dropCalled = false;
    const replicaSetDb = {
      uri: 'mongodb://node1.test.local:27017,node2.test.local:27017/kerala_perf_benchmark_test',
      redactedUri: 'mongodb://node1.test.local:27017,node2.test.local:27017/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      hosts: ['node1.test.local:27017', 'node2.test.local:27017'],
      protocol: 'mongodb:',
    };

    // Active connection topology discovered an unexpected node3
    const unexpectedReplicaConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      servers: ['node1.test.local:27017', 'node3.unexpected.local:27017'],
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(unexpectedReplicaConn, replicaSetDb, 'node1.test.local,node2.test.local'),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /Connected host "node3\.unexpected\.local:27017" does not match/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called if replica set contains unexpected member');
  });

  test('16. Host Mismatch 4: Actual host identity is missing or cannot be verified -> fail closed, no dropDatabase', async () => {
    let dropCalled = false;
    // Connection missing host, port, and client topology
    const anonymousConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      host: undefined,
      port: undefined,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(anonymousConn, standardValidatedDb),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /unable to establish connection host identity reliably/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called when host identity is unverified');
  });

  test('17. Inactive Connection 5: Connection is disconnected -> rejected, no dropDatabase', async () => {
    let dropCalled = false;
    const disconnectedConn = createMockConnection({
      readyState: 0,
      name: 'kerala_perf_benchmark_test',
      host: '127.0.0.1',
      port: 27017,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(disconnectedConn, standardValidatedDb),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /connection is not active/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called on inactive connection');
  });

  test('18. Database Mismatch 6: Database name does not match -> rejected, no dropDatabase', async () => {
    let dropCalled = false;
    const mismatchedDbConn = createMockConnection({
      readyState: 1,
      name: 'kerala_other_test',
      host: '127.0.0.1',
      port: 27017,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(mismatchedDbConn, standardValidatedDb),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /does not match expected validated test database name/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called when database name mismatches');
  });

  test('19. Success 7: Host and database name both match and all safety checks pass -> dropDatabase executed', async () => {
    let dropCalled = false;
    const matchingConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      host: '127.0.0.1',
      port: 27017,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await safeDropTestDatabase(matchingConn, standardValidatedDb);
    assert.strictEqual(dropCalled, true, 'dropDatabase MUST be called when all safety checks and host matches pass');
  });

  test('20. SRV Cluster verification allows matching subdomain members', async () => {
    let dropCalled = false;
    const srvDb = {
      uri: 'mongodb+srv://cluster.internal.test/kerala_perf_benchmark_test',
      redactedUri: 'mongodb+srv://cluster.internal.test/kerala_perf_benchmark_test',
      dbName: 'kerala_perf_benchmark_test',
      hosts: ['cluster.internal.test'],
      protocol: 'mongodb+srv:',
    };

    const srvConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      servers: ['node1.cluster.internal.test:27017', 'node2.cluster.internal.test:27017'],
      onDrop: () => {
        dropCalled = true;
      },
    });

    await safeDropTestDatabase(srvConn, srvDb, 'cluster.internal.test');
    assert.strictEqual(dropCalled, true, 'dropDatabase should succeed for verified SRV cluster members');
  });

  test('21. Production keyword in connected host is rejected even if DB name passes', async () => {
    let dropCalled = false;
    const prodConnectedConn = createMockConnection({
      readyState: 1,
      name: 'kerala_perf_benchmark_test',
      host: 'production-db.internal',
      port: 27017,
      onDrop: () => {
        dropCalled = true;
      },
    });

    await assert.rejects(
      () => safeDropTestDatabase(prodConnectedConn, standardValidatedDb),
      (err: unknown) => {
        assert.ok(err instanceof TestDatabaseSafetyError);
        assert.match(err.message, /contains forbidden production keyword/);
        return true;
      },
    );
    assert.strictEqual(dropCalled, false, 'dropDatabase must NEVER be called on production-named host');
  });

  // =========================================================================
  // 7. Host Utility Helpers
  // =========================================================================
  test('22. Host helpers extractHostname, extractPort, extractActualConnectionHosts, and verifyConnectionHostIdentity', () => {
    assert.strictEqual(extractHostname('localhost:27017'), 'localhost');
    assert.strictEqual(extractHostname('127.0.0.1'), '127.0.0.1');
    assert.strictEqual(extractHostname('[::1]:27017'), '::1');
    assert.strictEqual(extractHostname('cluster.mongodb.net'), 'cluster.mongodb.net');

    assert.strictEqual(extractPort('localhost:27017'), 27017);
    assert.strictEqual(extractPort('localhost'), 27017);
    assert.strictEqual(extractPort('127.0.0.1:28018'), 28018);
    assert.strictEqual(extractPort('[::1]:27019'), 27019);

    const testConn = createMockConnection({
      host: '127.0.0.1',
      port: 27017,
      servers: ['127.0.0.1:27017'],
      clientHosts: [{ host: '127.0.0.1', port: 27017 }],
    });
    const extracted = extractActualConnectionHosts(testConn);
    assert.deepStrictEqual(extracted, ['127.0.0.1:27017']);

    // verifyConnectionHostIdentity direct verification
    assert.doesNotThrow(() => {
      verifyConnectionHostIdentity(['127.0.0.1:27017'], standardValidatedDb);
    });
    assert.throws(
      () => verifyConnectionHostIdentity([], standardValidatedDb),
      /unable to establish connection host identity reliably/,
    );
  });
});
