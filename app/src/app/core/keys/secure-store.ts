import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/**
 * A place to put raw key material.
 *
 * Two implementations exist because the platforms differ in what they can
 * honestly promise:
 *
 *  - On Android, `SecureStoragePlugin` stores the secret in an `EncryptedSharedPreferences`
 *    file whose encryption key lives in the hardware-backed Android Keystore.
 *    The key material never leaves the keystore, so the master key survives an
 *    app restart without the user re-entering a passphrase.
 *
 *  - In a browser there is no such vault. `localStorage`, `sessionStorage` and
 *    IndexedDB are all readable by any script running on the origin, so putting
 *    the master key there would break the zero-knowledge promise for anyone who
 *    uses the PWA. The web implementation therefore keeps the key in a module
 *    closure for the lifetime of the tab only, and the user unlocks with their
 *    passphrase each session.
 *
 * `durable` tells the layers above which of those two worlds they are in, so
 * the UI can explain the difference to the user rather than guessing.
 */
export abstract class SecureStore {
  /** True when a secret survives an app restart without a passphrase. */
  abstract readonly durable: boolean;
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string): Promise<void>;
  abstract remove(key: string): Promise<void>;
}

@Injectable()
export class NativeSecureStore extends SecureStore {
  readonly durable = true;

  async get(key: string): Promise<string | null> {
    try {
      const { value } = await SecureStoragePlugin.get({ key });
      return value;
    } catch {
      // The plugin throws rather than returning null for a missing key.
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await SecureStoragePlugin.set({ key, value });
  }

  async remove(key: string): Promise<void> {
    try {
      await SecureStoragePlugin.remove({ key });
    } catch {
      // Already absent: removal is idempotent from the caller's point of view.
    }
  }
}

/**
 * In-memory store for the PWA. Deliberately has no persistence path at all —
 * there is nowhere in a browser to put a master key that a future XSS could not
 * also reach, so we do not pretend otherwise.
 */
@Injectable()
export class MemorySecureStore extends SecureStore {
  readonly durable = false;
  private readonly secrets = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

export function secureStoreFactory(): SecureStore {
  return Capacitor.isNativePlatform() ? new NativeSecureStore() : new MemorySecureStore();
}
