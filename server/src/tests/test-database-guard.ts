import mongoose from 'mongoose';

export interface ValidatedTestDatabase {
  uri: string;
  redactedUri: string;
  dbName: string;
  hosts: string[];
  protocol: string;
}

export class TestDatabaseSafetyError extends Error {
  constructor(message: string) {
    super(`[TestDatabaseGuard] Safety Violation: ${message}`);
    this.name = 'TestDatabaseSafetyError';
  }
}

export const APPROVED_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export const FORBIDDEN_HOST_KEYWORDS = ['prod', 'production', 'live'];

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
 * Redacts username and password credentials from a MongoDB URI while preserving
 * protocol, hosts, database name, and safe query parameters for diagnostic output.
 */
export function redactMongoUri(rawUri: string): string {
  if (typeof rawUri !== 'string') return '';
  return rawUri.replace(/^([a-z0-9+.-]+:\/\/)([^@]+)@/i, '$1***:***@');
}

/**
 * Normalizes host strings into pure lowercase hostnames (stripping ports and IPv6 brackets).
 */
export function extractHostname(hostString: string): string {
  const trimmed = hostString.trim();
  if (trimmed.startsWith('[')) {
    const endBracket = trimmed.indexOf(']');
    if (endBracket !== -1) {
      return trimmed.slice(1, endBracket).toLowerCase();
    }
  }
  return trimmed.split(':')[0].toLowerCase();
}

/**
 * Extracts port number from host string if present, or returns default MongoDB port (27017).
 */
export function extractPort(hostString: string, defaultPort = 27017): number {
  const trimmed = hostString.trim();
  if (trimmed.startsWith('[')) {
    const endBracket = trimmed.indexOf(']');
    if (endBracket !== -1) {
      const rest = trimmed.slice(endBracket + 1);
      if (rest.startsWith(':')) {
        const p = parseInt(rest.slice(1), 10);
        if (!isNaN(p)) return p;
      }
      return defaultPort;
    }
  }
  const parts = trimmed.split(':');
  if (parts.length > 1) {
    const p = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(p)) return p;
  }
  return defaultPort;
}

interface ParsedMongoUriParts {
  protocol: string;
  hosts: string[];
  rawHostString: string;
  dbName: string;
}

/**
 * Safely parses MongoDB URI components without exposing credentials,
 * supporting single hosts, replica sets (comma-separated), and mongodb+srv.
 */
function parseMongoUriParts(trimmedUri: string): ParsedMongoUriParts {
  const protoMatch = trimmedUri.match(/^([a-z0-9+.-]+):\/\//i);
  if (!protoMatch) {
    throw new TestDatabaseSafetyError(
      `Malformed MongoDB connection URI: "${redactMongoUri(trimmedUri)}". Missing protocol scheme.`,
    );
  }

  const protocol = protoMatch[1].toLowerCase();
  if (protocol !== 'mongodb' && protocol !== 'mongodb+srv') {
    throw new TestDatabaseSafetyError(
      `Unsupported protocol "${protocol}:". Performance tests strictly require "mongodb:" or "mongodb+srv:".`,
    );
  }

  const afterProto = trimmedUri.slice(protoMatch[0].length);
  const atIdx = afterProto.indexOf('@');
  const hostAndRest = atIdx !== -1 ? afterProto.slice(atIdx + 1) : afterProto;

  const slashIdx = hostAndRest.indexOf('/');
  const qIdx = hostAndRest.indexOf('?');

  let rawHostString = '';
  let pathAndQuery = '';

  if (slashIdx !== -1) {
    rawHostString = hostAndRest.slice(0, slashIdx);
    pathAndQuery = hostAndRest.slice(slashIdx);
  } else if (qIdx !== -1) {
    rawHostString = hostAndRest.slice(0, qIdx);
    pathAndQuery = hostAndRest.slice(qIdx);
  } else {
    rawHostString = hostAndRest;
    pathAndQuery = '';
  }

  if (!rawHostString.trim()) {
    throw new TestDatabaseSafetyError(
      `MongoDB connection URI must specify a valid host: "${redactMongoUri(trimmedUri)}".`,
    );
  }

  const hosts = rawHostString
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  if (hosts.length === 0) {
    throw new TestDatabaseSafetyError(
      `MongoDB connection URI must specify a valid host: "${redactMongoUri(trimmedUri)}".`,
    );
  }

  const rawPath = pathAndQuery.replace(/^\/+/, '');
  const dbName = rawPath.split('/')[0]?.split('?')[0]?.trim();

  if (!dbName) {
    throw new TestDatabaseSafetyError(
      `MongoDB connection URI must specify an explicit database name: "${redactMongoUri(trimmedUri)}".`,
    );
  }

  return { protocol: `${protocol}:`, hosts, rawHostString, dbName };
}

/**
 * Validates hosts against the host-isolation policy.
 * Local loopback instances are approved by default.
 * Remote clusters strictly require explicit approval via TEST_MONGO_ALLOWED_HOSTS.
 * Production-like hostnames are unconditionally rejected.
 */
export function validateHostPolicy(
  hosts: string[],
  rawAllowedHostsEnv?: string,
): void {
  const allowedRemoteHosts = new Set<string>();
  if (rawAllowedHostsEnv && rawAllowedHostsEnv.trim()) {
    const items = rawAllowedHostsEnv
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    for (const item of items) {
      allowedRemoteHosts.add(item);
      allowedRemoteHosts.add(extractHostname(item));
    }
  }

  for (const rawHost of hosts) {
    const hostname = extractHostname(rawHost);
    const hostLower = rawHost.toLowerCase();

    // 1. Unconditionally reject production-like hostnames
    for (const forbidden of FORBIDDEN_HOST_KEYWORDS) {
      if (hostname.includes(forbidden) || hostLower.includes(forbidden)) {
        throw new TestDatabaseSafetyError(
          `Host "${rawHost}" contains forbidden production keyword "${forbidden}". Connecting to production-like infrastructure in tests is strictly prohibited.`,
        );
      }
    }

    // 2. Allow local loopback hosts
    if (APPROVED_LOCAL_HOSTS.has(hostname) || APPROVED_LOCAL_HOSTS.has(hostLower)) {
      continue;
    }

    // 3. For remote hosts, enforce match in TEST_MONGO_ALLOWED_HOSTS (exact match or cluster domain member)
    let isApprovedRemote =
      allowedRemoteHosts.has(hostLower) || allowedRemoteHosts.has(hostname);

    if (!isApprovedRemote) {
      for (const allowed of allowedRemoteHosts) {
        if (hostname.endsWith(`.${allowed}`)) {
          isApprovedRemote = true;
          break;
        }
      }
    }

    if (!isApprovedRemote) {
      if (allowedRemoteHosts.size === 0) {
        throw new TestDatabaseSafetyError(
          `Remote test host "${rawHost}" is not allowed. Local loopback hosts (${[...APPROVED_LOCAL_HOSTS].join(', ')}) are allowed by default. Remote test clusters must be explicitly authorized via the TEST_MONGO_ALLOWED_HOSTS environment variable.`,
        );
      } else {
        throw new TestDatabaseSafetyError(
          `Remote test host "${rawHost}" is not present in TEST_MONGO_ALLOWED_HOSTS allowlist. Authorized hosts: ${[...allowedRemoteHosts].join(', ')}.`,
        );
      }
    }
  }
}

/**
 * Validates that a MongoDB URI points strictly to an isolated test database.
 * Enforces host-isolation policy and database naming convention.
 * Never leaks credentials in thrown safety errors.
 */
export function validateTestDatabaseUri(
  rawUri: unknown,
  allowedHostsEnv?: string,
): ValidatedTestDatabase {
  if (typeof rawUri !== 'string' || !rawUri.trim()) {
    throw new TestDatabaseSafetyError(
      'TEST_MONGO_URL is required and must be an explicitly configured non-empty string. Fallbacks to production databases or default configurations are strictly prohibited.',
    );
  }

  const trimmedUri = rawUri.trim();
  const redactedUri = redactMongoUri(trimmedUri);

  const { protocol, hosts, dbName } = parseMongoUriParts(trimmedUri);

  // Validate Host Isolation Policy
  validateHostPolicy(hosts, allowedHostsEnv);

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

  // Reject any production or live keywords in database name
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (lowerName.includes(forbidden)) {
      throw new TestDatabaseSafetyError(
        `Database name "${dbName}" contains forbidden production keyword "${forbidden}".`,
      );
    }
  }

  return {
    uri: trimmedUri,
    redactedUri,
    dbName,
    hosts,
    protocol,
  };
}

/**
 * Resolves and validates TEST_MONGO_URL from environment with host isolation policy.
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

  const allowedHosts = targetEnv.TEST_MONGO_ALLOWED_HOSTS;
  return validateTestDatabaseUri(testMongoUrl, allowedHosts);
}

interface ClientWithTopology {
  client?: {
    s?: { options?: { hosts?: Array<{ host?: string; port?: number; toString?: () => string }> } };
    topology?: { description?: { servers?: Map<string, unknown> | Record<string, unknown> } };
  };
}

/**
 * Safely extracts all actual connected hosts from a Mongoose Connection and its underlying MongoClient/Topology.
 * Returns normalized host strings.
 */
export function extractActualConnectionHosts(connection: mongoose.Connection): string[] {
  const hostSet = new Set<string>();

  // 1. Inspect driver TopologyDescription servers map (live connected/discovered servers)
  const client = (connection as unknown as ClientWithTopology).client;
  const serversMap = client?.topology?.description?.servers;
  if (serversMap) {
    if (typeof serversMap.keys === 'function') {
      for (const serverAddress of serversMap.keys()) {
        if (typeof serverAddress === 'string' && serverAddress.trim()) {
          hostSet.add(serverAddress.trim().toLowerCase());
        }
      }
    } else if (typeof serversMap === 'object') {
      for (const serverAddress of Object.keys(serversMap)) {
        if (typeof serverAddress === 'string' && serverAddress.trim()) {
          hostSet.add(serverAddress.trim().toLowerCase());
        }
      }
    }
  }

  // 2. Inspect MongoClient options hosts (parsed seedlist)
  const clientHosts = client?.s?.options?.hosts;
  if (Array.isArray(clientHosts)) {
    for (const h of clientHosts) {
      if (h) {
        if (typeof h.toString === 'function' && h.toString() !== '[object Object]') {
          hostSet.add(h.toString().trim().toLowerCase());
        } else if (typeof h.host === 'string' && h.host.trim()) {
          const portPart = typeof h.port === 'number' ? `:${h.port}` : '';
          hostSet.add(`${h.host.trim()}${portPart}`.toLowerCase());
        }
      }
    }
  }

  // 3. Inspect connection.host and connection.port
  if (typeof connection.host === 'string' && connection.host.trim()) {
    const portPart = typeof connection.port === 'number' ? `:${connection.port}` : '';
    hostSet.add(`${connection.host.trim()}${portPart}`.toLowerCase());
  }

  return Array.from(hostSet);
}

/**
 * Verifies that the actual connected MongoDB deployment host(s) strictly match
 * the validated test database configuration.
 * Fails closed if host identity cannot be established or if any actual host is unauthorized.
 */
export function verifyConnectionHostIdentity(
  actualHosts: string[],
  expected: ValidatedTestDatabase,
  allowedHostsEnv?: string,
): void {
  if (!actualHosts || actualHosts.length === 0) {
    throw new TestDatabaseSafetyError(
      'Cannot drop database: unable to establish connection host identity reliably. No host information exposed on connection.',
    );
  }

  const isSrv = expected.protocol === 'mongodb+srv:';
  const expectedSrvDomain = isSrv && expected.hosts[0] ? extractHostname(expected.hosts[0]) : null;

  for (const actualHost of actualHosts) {
    const actualHostname = extractHostname(actualHost);
    const actualPort = extractPort(actualHost);

    // 1. Unconditionally reject production-like keywords
    for (const forbidden of FORBIDDEN_HOST_KEYWORDS) {
      if (actualHostname.includes(forbidden) || actualHost.toLowerCase().includes(forbidden)) {
        throw new TestDatabaseSafetyError(
          `Connected host "${actualHost}" contains forbidden production keyword "${forbidden}". Destructive cleanup aborted.`,
        );
      }
    }

    // 2. Check if actualHost matches the expected configuration
    let matchesExpected = false;

    if (isSrv && expectedSrvDomain) {
      // For SRV, the node must either equal the SRV domain or be a subdomain of the SRV domain
      if (actualHostname === expectedSrvDomain || actualHostname.endsWith(`.${expectedSrvDomain}`)) {
        matchesExpected = true;
      }
    } else {
      // For standard mongodb:// connections, check against expected.hosts
      for (const expHost of expected.hosts) {
        const expHostname = extractHostname(expHost);
        const expPort = extractPort(expHost);

        if (actualHostname === expHostname && actualPort === expPort) {
          matchesExpected = true;
          break;
        }
      }
    }

    if (!matchesExpected) {
      throw new TestDatabaseSafetyError(
        `Connected host "${actualHost}" does not match any validated host in expected test configuration: [${expected.hosts.join(', ')}]. Destructive cleanup aborted.`,
      );
    }

    // 3. Confirm actual host passes host isolation policy
    validateHostPolicy([actualHost], allowedHostsEnv);
  }
}

/**
 * Performs guarded destructive cleanup (dropDatabase) on a validated test database connection.
 * Guarantees that dropDatabase is never called on an invalid, unverified, or mismatched host/database.
 */
export async function safeDropTestDatabase(
  connection: mongoose.Connection,
  expected: ValidatedTestDatabase,
  allowedHostsEnv?: string,
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

  // Verify actual connection host identity against validated configuration
  const actualHosts = extractActualConnectionHosts(connection);
  verifyConnectionHostIdentity(actualHosts, expected, allowedHostsEnv);

  await connection.dropDatabase();
}
