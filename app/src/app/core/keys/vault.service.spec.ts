import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { beforeEach, describe, expect, it } from 'vitest';
import { CryptoService, WrappedMasterKey } from '../crypto/crypto.service';
import { BiometricService } from './biometric.service';
import { MemorySecureStore, SecureStore } from './secure-store';
import { VaultService } from './vault.service';

/**
 * Exercises the real `VaultService` against the web configuration: Capacitor
 * `Preferences` (localStorage under jsdom) plus the memory-only secure store.
 * That is deliberately the weaker of the two platforms — if the key never
 * reaches disk here, it never reaches disk anywhere.
 */
/** A stand-in for the device check, so its two outcomes can both be exercised. */
class StubBiometrics {
  enabled = false;
  verdict = true;
  prompts = 0;

  async availability() {
    return { available: true as const, kind: 'Fingerprint' };
  }
  async isEnabled(): Promise<boolean> {
    return this.enabled;
  }
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
  }
  async verify(): Promise<boolean> {
    this.prompts++;
    return this.verdict;
  }
}

async function makeVault(
  store: SecureStore = new MemorySecureStore(),
  biometrics: StubBiometrics = new StubBiometrics(),
): Promise<VaultService> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      VaultService,
      CryptoService,
      { provide: SecureStore, useValue: store },
      { provide: BiometricService, useValue: biometrics },
    ],
  });
  const vault = TestBed.inject(VaultService);
  await vault.initialise();
  return vault;
}

/**
 * A store that persists across "restarts", standing in for the Android
 * keystore. `MemorySecureStore` cannot simply be subclassed: its `durable` is
 * the literal `false`, which is the point of it.
 */
class DurableStore extends SecureStore {
  readonly durable = true;
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

const PASSPHRASE = 'correct horse battery staple';

describe('VaultService', () => {
  beforeEach(async () => {
    await Preferences.clear();
  });

  it('starts uninitialised on a fresh device', async () => {
    const vault = await makeVault();
    expect(vault.status()).toBe('uninitialised');
    expect(vault.isUnlocked()).toBe(false);
  });

  it('mints a device identity that survives a restart', async () => {
    const first = await makeVault();
    const deviceId = first.deviceId();

    expect(deviceId).toBeTruthy();
    expect(deviceId).toMatch(/^[a-zA-Z0-9]{1,8}$/);
    expect((await makeVault()).deviceId()).toBe(deviceId);
  });

  it('creates a vault and leaves it unlocked', async () => {
    const vault = await makeVault();
    await vault.create(PASSPHRASE);

    expect(vault.status()).toBe('unlocked');
    expect(vault.vaultId()).toBeTruthy();
    expect(() => vault.requireKey()).not.toThrow();
  });

  it('rejects a passphrase too short to be worth anything', async () => {
    const vault = await makeVault();
    await expect(vault.create('short')).rejects.toThrow(/at least 8/);
  });

  describe('key storage', () => {
    it('never writes raw key material to ordinary storage', async () => {
      const vault = await makeVault();
      await vault.create(PASSPHRASE);

      const raw = await TestBed.inject(CryptoService).exportMasterKey(vault.requireKey());
      const rawBase64 = btoa(String.fromCharCode(...raw));

      // Everything Preferences holds, concatenated.
      const { keys } = await Preferences.keys();
      let stored = '';
      for (const key of keys) {
        stored += (await Preferences.get({ key })).value ?? '';
      }

      expect(stored).not.toContain(rawBase64);
      expect(stored).not.toContain(PASSPHRASE);
      // What *is* stored is the wrapped key, which is useless on its own.
      expect(stored).toContain('PBKDF2-SHA256');
    });

    it('does not persist the key on a platform with no keystore', async () => {
      const store = new MemorySecureStore();
      const vault = await makeVault(store);
      await vault.create(PASSPHRASE);

      expect(vault.keyIsDurable).toBe(false);
      expect(await store.get('docket.masterKey')).toBeNull();

      // A restart therefore finds the vault locked.
      expect((await makeVault(new MemorySecureStore())).status()).toBe('locked');
    });

    it('restores the key from a hardware-backed keystore without a passphrase', async () => {
      const store = new DurableStore();
      const vault = await makeVault(store);
      await vault.create(PASSPHRASE);

      expect(vault.keyIsDurable).toBe(true);
      expect(await store.get('docket.masterKey')).toBeTruthy();

      const restarted = await makeVault(store);
      expect(restarted.status()).toBe('unlocked');
    });
  });

  describe('unlocking', () => {
    it('accepts the right passphrase and restores the same key', async () => {
      const crypto = TestBed.inject(CryptoService);
      const created = await makeVault();
      await created.create(PASSPHRASE);
      const original = await crypto.exportMasterKey(created.requireKey());

      const restarted = await makeVault();
      expect(restarted.status()).toBe('locked');
      await restarted.unlock(PASSPHRASE);

      expect(restarted.status()).toBe('unlocked');
      expect(await TestBed.inject(CryptoService).exportMasterKey(restarted.requireKey())).toEqual(
        original,
      );
    });

    it('refuses the wrong passphrase and stays locked', async () => {
      const created = await makeVault();
      await created.create(PASSPHRASE);

      const restarted = await makeVault();
      await expect(restarted.unlock('wrong passphrase')).rejects.toThrow(/Incorrect passphrase/);
      expect(restarted.status()).toBe('locked');
      expect(() => restarted.requireKey()).toThrow(/locked/);
    });
  });

  describe('the device check', () => {
    it('is not asked for when it has not been turned on', async () => {
      const store = new DurableStore();
      const biometrics = new StubBiometrics();

      await (await makeVault(store, biometrics)).create(PASSPHRASE);
      await makeVault(store, biometrics);

      expect(biometrics.prompts).toBe(0);
    });

    it('stands between a stored key and the ledger', async () => {
      // Without it, a phone found unlocked is a ledger left open.
      const store = new DurableStore();
      const biometrics = new StubBiometrics();
      biometrics.enabled = true;

      await (await makeVault(store, biometrics)).create(PASSPHRASE);
      const restarted = await makeVault(store, biometrics);

      expect(biometrics.prompts).toBe(1);
      expect(restarted.status()).toBe('unlocked');
    });

    it('leaves the vault locked when the check is refused', async () => {
      const store = new DurableStore();
      const biometrics = new StubBiometrics();
      biometrics.enabled = true;

      await (await makeVault(store, biometrics)).create(PASSPHRASE);
      biometrics.verdict = false;
      const restarted = await makeVault(store, biometrics);

      expect(restarted.status()).toBe('locked');
      expect(() => restarted.requireKey()).toThrow(/locked/);
    });

    it('still opens with the passphrase after a refused check', async () => {
      // The check is a convenience gate, not a second key: refusing it must not
      // lock someone out of their own ledger.
      const store = new DurableStore();
      const biometrics = new StubBiometrics();
      biometrics.enabled = true;

      await (await makeVault(store, biometrics)).create(PASSPHRASE);
      biometrics.verdict = false;

      const restarted = await makeVault(store, biometrics);
      await restarted.unlock(PASSPHRASE);

      expect(restarted.status()).toBe('unlocked');
    });
  });

  it('drops the key on lock', async () => {
    const store = new DurableStore();
    const vault = await makeVault(store);
    await vault.create(PASSPHRASE);

    await vault.lock();

    expect(vault.status()).toBe('locked');
    expect(() => vault.requireKey()).toThrow(/locked/);
    // Also evicted from the keystore, so a stolen device cannot resume.
    expect(await store.get('docket.masterKey')).toBeNull();
  });

  describe('changing the passphrase', () => {
    it('re-wraps the same key rather than re-encrypting the ledger', async () => {
      const crypto = TestBed.inject(CryptoService);
      const vault = await makeVault();
      await vault.create(PASSPHRASE);
      const before = await crypto.exportMasterKey(vault.requireKey());

      await vault.changePassphrase(PASSPHRASE, 'an entirely different phrase');

      const restarted = await makeVault();
      await restarted.unlock('an entirely different phrase');
      expect(await TestBed.inject(CryptoService).exportMasterKey(restarted.requireKey())).toEqual(
        before,
      );
    });

    it('refuses when the current passphrase is wrong', async () => {
      const vault = await makeVault();
      await vault.create(PASSPHRASE);

      await expect(vault.changePassphrase('not it', 'a new passphrase')).rejects.toThrow(
        /Incorrect passphrase/,
      );
      // And the original still works.
      const restarted = await makeVault();
      await expect(restarted.unlock(PASSPHRASE)).resolves.toBeUndefined();
    });
  });

  describe('recovery on a second device', () => {
    it('joins an existing vault from its wrapped key', async () => {
      const crypto = TestBed.inject(CryptoService);
      const original = await makeVault();
      await original.create(PASSPHRASE);
      const exported = await original.exportWrappedKey();
      const originalKey = await crypto.exportMasterKey(original.requireKey());

      // A different device: nothing carried over but the recovery bundle.
      await Preferences.clear();
      const second = await makeVault();
      await second.restore(
        exported!.vaultId,
        exported!.wrapped as WrappedMasterKey,
        PASSPHRASE,
      );

      expect(second.status()).toBe('unlocked');
      expect(second.vaultId()).toBe(exported!.vaultId);
      expect(await TestBed.inject(CryptoService).exportMasterKey(second.requireKey())).toEqual(
        originalKey,
      );
    });

    it('will not join with the wrong passphrase', async () => {
      const original = await makeVault();
      await original.create(PASSPHRASE);
      const exported = await original.exportWrappedKey();

      await Preferences.clear();
      const second = await makeVault();
      await expect(
        second.restore(exported!.vaultId, exported!.wrapped, 'wrong'),
      ).rejects.toThrow(/Incorrect passphrase/);
      expect(second.status()).toBe('uninitialised');
    });
  });

  it('erases everything on destroy', async () => {
    const vault = await makeVault();
    await vault.create(PASSPHRASE);

    await vault.destroy();

    expect(vault.status()).toBe('uninitialised');
    expect(vault.vaultId()).toBeNull();
    expect((await makeVault()).status()).toBe('uninitialised');
  });
});
