/**
 * Mobile Authentication & Secure Storage Unit Tests
 */

import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import { authService } from '../services/auth.service';
import { secureStorage } from '../services/secure-storage';

describe('Mobile Authentication & Secure Storage Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    secureStorage.resetForTesting();
    authService.setSessionForTesting(null, null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('1. Secure Storage - Set, Get, Delete Operations', async () => {
    await secureStorage.setItemAsync('test_token', 'sample_secret_jwt');
    const retrieved = await secureStorage.getItemAsync('test_token');
    assert.equal(retrieved, 'sample_secret_jwt', 'Token should be retrieved accurately');

    await secureStorage.deleteItemAsync('test_token');
    const afterDelete = await secureStorage.getItemAsync('test_token');
    assert.equal(afterDelete, null, 'Deleted key should return null');
  });

  test('2. Successful Login - Access Token in Memory, Refresh Token in Secure Storage', async () => {
    global.fetch = async (url: any) => {
      if (String(url).includes('/api/v1/auth/login')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              accessToken: 'access_jwt_mem_only',
              refreshToken: 'refresh_jwt_secure_store',
              account: {
                id: 'acc_tourist_1',
                email: 'tourist@example.com',
                accountType: 'TOURIST',
                status: 'ACTIVE',
                profile: { displayName: 'Arjun Nair' },
              },
            },
          }),
        } as any;
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const account = await authService.login('tourist@example.com', 'ValidPass123!');

    assert.equal(account.email, 'tourist@example.com');
    assert.equal(authService.getAccessToken(), 'access_jwt_mem_only', 'Access token must be in memory');
    assert.equal(authService.isAuthenticated(), true);

    const storedRefresh = await secureStorage.getItemAsync('kt_mobile_refresh_token');
    assert.equal(storedRefresh, 'refresh_jwt_secure_store', 'Refresh token must be stored securely');
  });

  test('3. Single-Flight Refresh Mutex - 3 Concurrent Calls Yield Exactly 1 Fetch', async () => {
    await secureStorage.setItemAsync('kt_mobile_refresh_token', 'initial_refresh_token');

    let refreshCallCount = 0;
    global.fetch = async (url: any) => {
      if (String(url).includes('/api/v1/auth/refresh')) {
        refreshCallCount++;
        // Small delay to simulate in-flight network roundtrip
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              accessToken: 'new_rotated_access_jwt',
              refreshToken: 'new_rotated_refresh_jwt',
            },
          }),
        } as any;
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    // Trigger 3 concurrent refreshes simultaneously
    const [token1, token2, token3] = await Promise.all([
      authService.refreshToken(),
      authService.refreshToken(),
      authService.refreshToken(),
    ]);

    assert.equal(refreshCallCount, 1, 'Only 1 network call should occur for concurrent refresh attempts');
    assert.equal(token1, 'new_rotated_access_jwt');
    assert.equal(token2, 'new_rotated_access_jwt');
    assert.equal(token3, 'new_rotated_access_jwt');

    const updatedRefresh = await secureStorage.getItemAsync('kt_mobile_refresh_token');
    assert.equal(updatedRefresh, 'new_rotated_refresh_jwt', 'Rotated refresh token must be saved');
  });

  test('4. Refresh Failure - Invalid Session Clears All Memory & Storage', async () => {
    await secureStorage.setItemAsync('kt_mobile_refresh_token', 'revoked_token');
    authService.setSessionForTesting('old_access', { id: 'acc_1', email: 'test@t.com', accountType: 'TOURIST', status: 'ACTIVE' });

    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: { code: 'TOKEN_REVOKED', message: 'Session has been revoked' },
      }),
    } as any);

    const result = await authService.refreshToken();
    assert.equal(result, null, 'Refresh should return null on failure');
    assert.equal(authService.getAccessToken(), null, 'Access token must be cleared');
    assert.equal(authService.isAuthenticated(), false);

    const stored = await secureStorage.getItemAsync('kt_mobile_refresh_token');
    assert.equal(stored, null, 'Secure storage must be wiped');
  });

  test('5. Logout - Invalidate Backend Session and Clear Local Credentials', async () => {
    await secureStorage.setItemAsync('kt_mobile_refresh_token', 'active_refresh_token');
    authService.setSessionForTesting('active_access', { id: 'acc_1', email: 'test@t.com', accountType: 'TOURIST', status: 'ACTIVE' });

    let logoutNotifiedBackend = false;
    global.fetch = async (url: any) => {
      if (String(url).includes('/api/v1/auth/logout')) {
        logoutNotifiedBackend = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'Logged out successfully' }),
        } as any;
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    await authService.logout();

    assert.equal(logoutNotifiedBackend, true, 'Backend logout endpoint must be invoked');
    assert.equal(authService.getAccessToken(), null, 'Memory access token must be null');
    assert.equal(authService.isAuthenticated(), false);

    const stored = await secureStorage.getItemAsync('kt_mobile_refresh_token');
    assert.equal(stored, null, 'Stored refresh token must be deleted');
  });

  test('6. Production Hardening: Keystore Write Failure Throws in Release Mode', async () => {
    (global as any).__DEV__ = false;

    // Simulate native keystore throwing a cryptographic hardware error
    secureStorage.setNativeModuleForTesting({
      setItemAsync: async () => {
        throw new Error('KEYSTORE_LOCKED_OR_TAMPERED');
      },
      getItemAsync: async () => {
        throw new Error('KEYSTORE_LOCKED_OR_TAMPERED');
      },
      deleteItemAsync: async () => {
        throw new Error('KEYSTORE_LOCKED_OR_TAMPERED');
      },
    });

    await assert.rejects(
      async () => {
        await secureStorage.setItemAsync('token', 'val');
      },
      (err: Error) => {
        assert.ok(err.message.includes('[SecureStorage] Hardware secure storage write failure'));
        return true;
      },
      'Write failure must throw rather than silently masking error in production',
    );

    delete (global as any).__DEV__;
  });

  test('7. Production Hardening: Missing Native Keystore Throws in Release Mode', async () => {
    (global as any).__DEV__ = false;
    secureStorage.setNativeModuleForTesting(null);

    await assert.rejects(
      async () => {
        await secureStorage.setItemAsync('token', 'val');
      },
      (err: Error) => {
        assert.ok(err.message.includes('[SecureStorage] Hardware secure storage is unavailable'));
        return true;
      },
      'Missing hardware keystore must throw in release mode',
    );

    delete (global as any).__DEV__;
  });
});

