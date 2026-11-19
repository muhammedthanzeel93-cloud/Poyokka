/**
 * Secure Device Storage Service for Kerala Tourism Mobile App
 *
 * Implements hardware-backed secure storage for sensitive refresh tokens
 * and account identity using expo-secure-store when available, with a
 * secure memory store fallback for test/headless environments.
 *
 * Strict Security Rules:
 * - Never logs stored values or tokens.
 * - Never uses AsyncStorage or plain text files.
 */

export interface ISecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

class MemorySecureStorage implements ISecureStorage {
  private readonly store = new Map<string, string>();

  async getItemAsync(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Testing helper
  clear(): void {
    this.store.clear();
  }
}

export class SecureStorageService implements ISecureStorage {
  private fallbackStore = new MemorySecureStorage();
  private nativeModule: any = null;
  private isNativeChecked = false;

  private isReleaseEnvironment(): boolean {
    return typeof __DEV__ !== 'undefined' && !__DEV__;
  }

  public setNativeModuleForTesting(mockNative: any): void {
    this.nativeModule = mockNative;
    this.isNativeChecked = true;
  }

  private getNativeStore(): any {
    if (this.isNativeChecked) {
      return this.nativeModule;
    }

    try {
      // Dynamic require to prevent hard crashes when expo-secure-store is not linked
      // e.g. in Node.js test runner or Expo Go without prebuild
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SecureStore = require('expo-secure-store');
      if (SecureStore && typeof SecureStore.getItemAsync === 'function') {
        this.nativeModule = SecureStore;
      }
    } catch {
      this.nativeModule = null;
    }

    this.isNativeChecked = true;
    return this.nativeModule;
  }

  async getItemAsync(key: string): Promise<string | null> {
    const nativeStore = this.getNativeStore();
    if (nativeStore) {
      try {
        return await nativeStore.getItemAsync(key);
      } catch (err: unknown) {
        if (this.isReleaseEnvironment()) {
          throw new Error(`[SecureStorage] Hardware secure storage read failure: ${(err as Error).message}`);
        }
        return this.fallbackStore.getItemAsync(key);
      }
    }

    if (this.isReleaseEnvironment()) {
      throw new Error('[SecureStorage] Hardware secure storage is unavailable in production build');
    }
    return this.fallbackStore.getItemAsync(key);
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    const nativeStore = this.getNativeStore();
    if (nativeStore) {
      try {
        await nativeStore.setItemAsync(key, value);
        return;
      } catch (err: unknown) {
        if (this.isReleaseEnvironment()) {
          throw new Error(`[SecureStorage] Hardware secure storage write failure: ${(err as Error).message}`);
        }
        await this.fallbackStore.setItemAsync(key, value);
        return;
      }
    }

    if (this.isReleaseEnvironment()) {
      throw new Error('[SecureStorage] Hardware secure storage is unavailable in production build');
    }
    await this.fallbackStore.setItemAsync(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    const nativeStore = this.getNativeStore();
    if (nativeStore) {
      try {
        await nativeStore.deleteItemAsync(key);
        return;
      } catch (err: unknown) {
        if (this.isReleaseEnvironment()) {
          throw new Error(`[SecureStorage] Hardware secure storage delete failure: ${(err as Error).message}`);
        }
        await this.fallbackStore.deleteItemAsync(key);
        return;
      }
    }

    if (this.isReleaseEnvironment()) {
      throw new Error('[SecureStorage] Hardware secure storage is unavailable in production build');
    }
    await this.fallbackStore.deleteItemAsync(key);
  }

  /**
   * For automated testing environments: reset internal state
   */
  resetForTesting(): void {
    this.fallbackStore.clear();
    this.nativeModule = null;
    this.isNativeChecked = false;
  }
}

export const secureStorage = new SecureStorageService();
