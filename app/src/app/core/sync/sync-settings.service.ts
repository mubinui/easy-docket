import { Injectable, inject, signal } from '@angular/core';
import { CryptoService, fromBase64, toBase64 } from '../crypto/crypto.service';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { VaultService } from '../keys/vault.service';
import { DEFAULT_SYNC_SETTINGS, SyncSettings } from './sync-target';

/**
 * Persists sync configuration — including credentials — encrypted under the
 * master key.
 *
 * A sync target holds a GitHub token or an S3 secret. Storing those in
 * `localStorage` alongside the ledger would mean an attacker with disk access
 * gets nothing useful from the ledger itself but walks away with credentials to
 * the user's repository. So the settings blob is sealed exactly like ledger
 * data, which has the natural consequence that sync cannot run while the vault
 * is locked. That is the correct behaviour: a locked vault has no key to
 * encrypt outgoing data with either.
 */
const SETTINGS_KEY = 'sync.settings';

@Injectable({ providedIn: 'root' })
export class SyncSettingsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly crypto = inject(CryptoService);
  private readonly vault = inject(VaultService);

  private readonly current = signal<SyncSettings>(DEFAULT_SYNC_SETTINGS);
  readonly settings = this.current.asReadonly();

  /** Read settings from disk. Returns defaults when the vault has none yet. */
  async load(): Promise<SyncSettings> {
    const row = await this.db.meta.get(SETTINGS_KEY);
    if (!row) {
      this.current.set(DEFAULT_SYNC_SETTINGS);
      return DEFAULT_SYNC_SETTINGS;
    }

    const { value } = await this.crypto.openJson<SyncSettings>(
      this.vault.requireKey(),
      fromBase64(row.value as string),
    );
    // Merge over the defaults so a settings blob written by an older build
    // gains new fields instead of leaving them undefined.
    const merged = { ...DEFAULT_SYNC_SETTINGS, ...value };
    this.current.set(merged);
    return merged;
  }

  async save(settings: SyncSettings): Promise<void> {
    const sealed = await this.crypto.sealJson(
      this.vault.requireKey(),
      { v: this.vault.requireVaultId(), d: this.vault.requireDeviceId(), h: '', t: 'settings' },
      settings,
    );
    await this.db.meta.put({ key: SETTINGS_KEY, value: toBase64(sealed) });
    this.current.set(settings);
  }

  async clear(): Promise<void> {
    await this.db.meta.delete(SETTINGS_KEY);
    this.current.set(DEFAULT_SYNC_SETTINGS);
  }
}
