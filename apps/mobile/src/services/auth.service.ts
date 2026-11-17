/**
 * Mobile Authentication & Session Management Service
 *
 * Implements strict security rules:
 * - Access token is kept strictly in volatile application memory.
 * - Refresh token is stored exclusively in hardware-backed secure storage.
 * - Single-flight refresh mutex deduplicates concurrent refresh requests.
 * - Full refresh-token rotation handling.
 * - Immediate session revocation on backend upon logout.
 * - Zero token leakage in error messages or logs.
 */

import { secureStorage } from './secure-storage';
import { mobileNotificationService } from './notification.service';

const SECURE_KEYS = {
  REFRESH_TOKEN: 'kt_mobile_refresh_token',
  ACCOUNT_DATA: 'kt_mobile_account_data',
} as const;

export interface TouristAccount {
  id: string;
  email: string;
  accountType: string;
  status: string;
  profile?: {
    firstName?: string;
    lastName?: string;
    displayName?: string;
    phone?: string;
  } | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  account: TouristAccount;
}

export type AuthStateListener = (isAuthenticated: boolean, account: TouristAccount | null) => void;

export class AuthService {
  private accessToken: string | null = null;
  private currentAccount: TouristAccount | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private listeners: Set<AuthStateListener> = new Set();
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:5000').replace(/\/$/, '');
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  public addListener(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const isAuth = this.isAuthenticated();
    this.listeners.forEach((listener) => {
      try {
        listener(isAuth, this.currentAccount);
      } catch {
        // Suppress listener callback errors
      }
    });
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public getCurrentAccount(): TouristAccount | null {
    return this.currentAccount;
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken && !!this.currentAccount;
  }

  /**
   * Initializes the session on app startup by inspecting secure storage.
   * If a stored refresh token exists, attempts a silent token refresh.
   */
  public async initialize(): Promise<boolean> {
    try {
      const storedAccountJson = await secureStorage.getItemAsync(SECURE_KEYS.ACCOUNT_DATA);
      const storedRefreshToken = await secureStorage.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);

      if (!storedRefreshToken || !storedAccountJson) {
        await this.clearLocalSession();
        return false;
      }

      this.currentAccount = JSON.parse(storedAccountJson);

      // Perform single-flight refresh to get a fresh volatile access token
      const newAccessToken = await this.refreshToken();
      if (!newAccessToken) {
        await this.clearLocalSession();
        return false;
      }

      return true;
    } catch {
      await this.clearLocalSession();
      return false;
    }
  }

  /**
   * Authenticates a tourist with email and password against POST /api/v1/auth/login
   */
  public async login(email: string, password: string): Promise<TouristAccount> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.success) {
      const errorMsg = json?.error?.message || `Login failed (HTTP ${response.status})`;
      throw new Error(errorMsg);
    }

    const { accessToken, refreshToken, account } = json.data;

    // Retain access token strictly in volatile memory
    this.accessToken = accessToken;
    this.currentAccount = account;

    // Store refresh token and account info in hardware-backed secure storage
    if (refreshToken) {
      await secureStorage.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, refreshToken);
    }
    if (account) {
      await secureStorage.setItemAsync(SECURE_KEYS.ACCOUNT_DATA, JSON.stringify(account));
    }

    // Register push device token on successful login
    mobileNotificationService.registerDeviceWithBackend().catch(() => {});

    this.notifyListeners();
    return account;
  }

  /**
   * Single-flight token refresh mutex.
   * If multiple concurrent requests trigger a 401 simultaneously,
   * they all await the exact same in-flight refresh network call.
   */
  public async refreshToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performTokenRefresh(): Promise<string | null> {
    try {
      const storedRefreshToken = await secureStorage.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);
      if (!storedRefreshToken) {
        await this.clearLocalSession();
        return null;
      }

      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.success) {
        // Refresh token is expired, invalid, or revoked
        await this.clearLocalSession();
        return null;
      }

      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = json.data;

      // Update volatile access token
      this.accessToken = newAccessToken;

      // Handle refresh token rotation: update stored refresh token
      if (newRefreshToken) {
        await secureStorage.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, newRefreshToken);
      }

      this.notifyListeners();
      return newAccessToken;
    } catch {
      await this.clearLocalSession();
      return null;
    }
  }

  /**
   * Logs out the user by revoking the refresh token session on the backend
   * and purging all volatile and secure storage credentials locally.
   */
  public async logout(): Promise<void> {
    try {
      // Unregister push device token on logout
      await mobileNotificationService.unregisterDeviceOnLogout().catch(() => {});

      const storedRefreshToken = await secureStorage.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);
      if (storedRefreshToken) {
        // Invalidate backend session in MongoDB
        await fetch(`${this.baseUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ refreshToken: storedRefreshToken }),
        }).catch(() => {
          // Suppress network errors during logout
        });
      }
    } finally {
      await this.clearLocalSession();
    }
  }

  /**
   * Purges all volatile memory and secure storage credentials
   */
  public async clearLocalSession(): Promise<void> {
    this.accessToken = null;
    this.currentAccount = null;
    await secureStorage.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN);
    await secureStorage.deleteItemAsync(SECURE_KEYS.ACCOUNT_DATA);
    this.notifyListeners();
  }

  /**
   * Testing hook: manually set session credentials
   */
  public setSessionForTesting(accessToken: string | null, account: TouristAccount | null): void {
    this.accessToken = accessToken;
    this.currentAccount = account;
    this.notifyListeners();
  }
}

export const authService = new AuthService();
