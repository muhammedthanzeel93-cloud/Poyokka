import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../loaders/app';
import { dispatchRequest } from './testUtils';

test('Health Check API - GET /api/v1/health', async () => {
  const app = createApp();

  const res = await dispatchRequest<{
    success: boolean;
    data: {
      status: string;
      timestamp: string;
      environment: string;
      database: {
        status: string;
        readyState: number;
        name?: string;
        host?: string;
      };
      services: {
        api: string;
      };
    };
  }>(app, {
    method: 'GET',
    url: '/api/v1/health',
  });

  assert.strictEqual(res.status, 200, 'Health endpoint should return HTTP 200');
  assert.strictEqual(res.body.success, true, 'Response success should be true');
  assert.ok(
    ['healthy', 'degraded'].includes(res.body.data.status),
    `Expected status to be healthy or degraded, got: ${res.body.data.status}`,
  );
  assert.ok(res.body.data.timestamp, 'Timestamp must be present');
  assert.ok(!isNaN(Date.parse(res.body.data.timestamp)), 'Timestamp must be valid ISO date string');
  assert.ok(res.body.data.environment, 'Environment must be present');
  assert.ok(res.body.data.database, 'Database status object must be present');
  assert.ok(
    ['connected', 'connecting', 'disconnected'].includes(res.body.data.database.status),
    'Database status must be one of connected, connecting, disconnected',
  );
  assert.strictEqual(res.body.data.services.api, 'up', 'API service status should be up');

  // Security check: ensure no credentials appear anywhere in response text
  const responseText = res.rawBody;
  assert.ok(!responseText.includes('password'), 'Health response must never contain password');
  assert.ok(!responseText.includes('@'), 'Health response must not contain connection URI with auth credentials');

  // Verify X-Request-Id header is emitted
  assert.ok(res.headers['x-request-id'], 'Responses must include X-Request-Id correlation header');
});

test('Health Liveness Probe - GET /api/v1/health/liveness', async () => {
  const app = createApp();

  const res = await dispatchRequest<{
    success: boolean;
    data: {
      status: string;
      timestamp: string;
      uptime: number;
    };
  }>(app, {
    method: 'GET',
    url: '/api/v1/health/liveness',
  });

  assert.strictEqual(res.status, 200, 'Liveness probe must return HTTP 200');
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.status, 'ok', 'Liveness probe must report status ok');
  assert.ok(res.body.data.timestamp, 'Timestamp must be present');
  assert.ok(res.headers['x-request-id'], 'Liveness probe must return X-Request-Id header');
});

test('Health Readiness Probe - GET /api/v1/health/readiness', async () => {
  const app = createApp();

  const res = await dispatchRequest<{
    success: boolean;
    data: {
      isReady: boolean;
      status: string;
      database: {
        status: string;
      };
      timestamp: string;
    };
  }>(app, {
    method: 'GET',
    url: '/api/v1/health/readiness',
  });

  // Depending on database state during disconnected unit test execution
  assert.ok([200, 503].includes(res.status), 'Readiness probe must return 200 (ready) or 503 (not ready)');
  assert.ok(['ready', 'not_ready'].includes(res.body.data.status));
  assert.ok(res.headers['x-request-id'], 'Readiness probe must return X-Request-Id header');
});

test('Correlation ID Header Echo & Preservation', async () => {
  const app = createApp();
  const clientCorrelationId = 'client-custom-trace-uuid-12345';

  const res = await dispatchRequest(app, {
    method: 'GET',
    url: '/api/v1/health/liveness',
    headers: {
      'x-request-id': clientCorrelationId,
    },
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(
    res.headers['x-request-id'],
    clientCorrelationId,
    'Server must echo and preserve incoming X-Request-Id header for distributed tracing',
  );
});
