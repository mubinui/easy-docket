import { Injectable, computed, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { CryptoService, WrappedMasterKey, fromBase64, toBase64 } from '../crypto/crypto.service';
import { SecureStore } from './secure-store';

/**
 * Owns the lifecycle of the master key: creation, unlock, lock, passphrase
 * change and destruction.
 *
 * The invariant this service exists to hold is simple and absolute: **the raw
 * master key is never written anywhere except a hardware-backed keystore.**
 * What goes into `Preferences` (which is `localStorage` on the web and
 * `SharedPreferences` on Android) is only ever the *wrapped* key — ciphertext
 * that is worthless without the user's passphrase.
 *
 * The unlocked key itself is held as a `CryptoKey` handle. On the web that is
 * an opaque reference into the browser's crypto implementation rather than a
 * JavaScript byte array, so the raw bytes are not sitting in the heap waiting
 * to be scraped.
 */
const KEY_VAULT_ID = 'docket.vaultId';
const KEY_DEVICE_ID = 'docket.deviceId';
const KEY_WRAPPED = 'docket.wrappedMasterKey';
/** Name under which the raw key is held in the native keystore. */
const SECURE_MASTER_KEY = 'docket.masterKey';

export type VaultState = 'uninitialised' | 'locked' | 'unlocked';

export class VaultLockedError extends Error {
  constructor() {
    super('The vault is locked');
    this.name = 'VaultLockedError';
  }
}

@Injectable({ providedIn: 'root' })
export class VaultService {
  private readonly crypto = inject(CryptoService);
  private readonly secureStore = inject(SecureStore);

  private masterKey: CryptoKey | null = null;
  private readonly state = signal<VaultState>('uninitialised');
  private readonly vaultIdSignal = signal<string | null>(null);
  private readonly deviceIdSignal = signal<string | null>(null);

  readonly status = this.state.asReadonly();
  readonly vaultId = this.vaultIdSignal.asReadonly();
  readonly deviceId = this.deviceIdSignal.asReadonly();
  readonly isUnlocked = computed(() => this.state() === 'unlocked');

  /**
   * True when the platform can hold the key across restarts. The settings screen
   * uses this to tell PWA users why they are asked for a passphrase each session.
   */
  get keyIsDurable(): boolean {
    return this.secureStore.durable;
  }

  /** Load persisted identity and, where the platform allows, restore the key. */
  async initialise(): Promise<VaultState> {
    const [vaultId, deviceId, wrapped] = await Promise.all([
      read(KEY_VAULT_ID),
      read(KEY_DEVICE_ID),
      read(KEY_WRAPPED),
    ]);

    this.vaultIdSignal.set(vaultId);
    // A device id identifies this installation within the vault. It is not tied
    // to any hardware identifier, and a reinstall legitimately gets a new one.
    this.deviceIdSignal.set(deviceId ?? (await this.mintDeviceId()));

    if (!vaultId || !wrapped) {
      this.state.set('uninitialised');
      return this.state();
    }

    const stashed = await this.secureStore.get(SECURE_MASTER_KEY);
    if (stashed) {
      this.masterKey = await this.crypto.importMasterKey(fromBase64(stashed));
      this.state.set('unlocked');
    } else {
      this.state.set('locked');
    }
    return this.state();
  }

  /**
   * Create a brand new vault. The passphrase is used immediately to wrap the
   * generated key and is never retained.
   */
  async create(passphrase: string): Promise<void> {
    assertPassphrase(passphrase);
    const masterKey = await this.crypto.generateMasterKey();
    const wrapped = await this.crypto.wrapMasterKey(masterKey, passphrase);
    const vaultId = crypto.randomUUID();

    await Promise.all([
      write(KEY_VAULT_ID, vaultId),
      write(KEY_WRAPPED, JSON.stringify(wrapped)),
    ]);

    this.vaultIdSignal.set(vaultId);
    await this.adopt(masterKey);
  }

  /**
   * Join an existing vault from another device. The vault id has to match the
   * one the remote data was written under, or the envelopes will not authenticate.
   */
  async restore(vaultId: string, wrapped: WrappedMasterKey, passphrase: string): Promise<void> {
    const masterKey = await this.crypto.unwrapMasterKey(wrapped, passphrase);
    await Promise.all([
      write(KEY_VAULT_ID, vaultId),
      write(KEY_WRAPPED, JSON.stringify(wrapped)),
    ]);
    this.vaultIdSignal.set(vaultId);
    await this.adopt(masterKey);
  }

  async unlock(passphrase: string): Promise<void> {
    const raw = await read(KEY_WRAPPED);
    if (!raw) throw new Error('No vault on this device');
    const masterKey = await this.crypto.unwrapMasterKey(
      JSON.parse(raw) as WrappedMasterKey,
      passphrase,
    );
    await this.adopt(masterKey);
  }

  /**
   * Drop the key from memory and, on native, from the keystore too. Called on
   * explicit lock and by the idle auto-lock timer.
   */
  async lock(): Promise<void> {
    this.masterKey = null;
    await this.secureStore.remove(SECURE_MASTER_KEY);
    this.state.set(this.vaultIdSignal() ? 'locked' : 'uninitialised');
  }

  /**
   * Re-wrap the existing master key under a new passphrase. The ledger itself is
   * untouched, so this is instant no matter how large the history is.
   */
  async changePassphrase(current: string, next: string): Promise<void> {
    assertPassphrase(next);
    const raw = await read(KEY_WRAPPED);
    if (!raw) throw new Error('No vault on this device');
    const masterKey = await this.crypto.unwrapMasterKey(
      JSON.parse(raw) as WrappedMasterKey,
      current,
    );
    await write(KEY_WRAPPED, JSON.stringify(await this.crypto.wrapMasterKey(masterKey, next)));
  }

  /** The wrapped key, for display as a recovery QR code or backup file. */
  async exportWrappedKey(): Promise<{ vaultId: string; wrapped: WrappedMasterKey } | null> {
    const [vaultId, raw] = await Promise.all([read(KEY_VAULT_ID), read(KEY_WRAPPED)]);
    if (!vaultId || !raw) return null;
    return { vaultId, wrapped: JSON.parse(raw) as WrappedMasterKey };
  }

  /** The live key, for the sync and settings layers. Throws rather than returning null. */
  requireKey(): CryptoKey {
    if (!this.masterKey) throw new VaultLockedError();
    return this.masterKey;
  }

  requireVaultId(): string {
    const id = this.vaultIdSignal();
    if (!id) throw new Error('No vault on this device');
    return id;
  }

  requireDeviceId(): string {
    const id = this.deviceIdSignal();
    if (!id) throw new Error('Device identity not initialised');
    return id;
  }

  /** Erase everything. Used by "reset app" and after too many failed unlocks. */
  async destroy(): Promise<void> {
    await this.lock();
    await Promise.all([
      Preferences.remove({ key: KEY_VAULT_ID }),
      Preferences.remove({ key: KEY_WRAPPED }),
    ]);
    this.vaultIdSignal.set(null);
    this.state.set('uninitialised');
  }

  private async adopt(masterKey: CryptoKey): Promise<void> {
    this.masterKey = masterKey;
    if (this.secureStore.durable) {
      // Only reached on a platform with a hardware-backed keystore.
      await this.secureStore.set(
        SECURE_MASTER_KEY,
        toBase64(await this.crypto.exportMasterKey(masterKey)),
      );
    }
    this.state.set('unlocked');
  }

  private async mintDeviceId(): Promise<string> {
    const id = toBase64(this.crypto.randomBytes(6)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    await write(KEY_DEVICE_ID, id);
    return id;
  }
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.normalize('NFKC').length < 8) {
    throw new Error('Passphrase must be at least 8 characters');
  }
}

async function read(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value ?? null;
}

async function write(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}
