import { Injectable, inject, signal } from '@angular/core';
import { CryptoService } from '../crypto/crypto.service';
import { EnvelopeHeader } from '../crypto/envelope';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { VaultService } from '../keys/vault.service';
import { Operation, OperationBatch } from '../models/oplog';
import { LedgerService } from '../repositories/ledger.service';
import { AdapterFactory, NoSyncTargetError } from './adapter-factory';
import { SyncAdapter, SyncTransportError } from './sync-adapter';
import { SyncSettingsService } from './sync-settings.service';
import { opsObjectName, opsPrefix } from './sync-target';

/**
 * The sync engine.
 *
 * One cycle is: pull everything we have not seen, merge it, then push
 * everything we have not sent. Pull comes first so that a local operation
 * authored immediately afterwards is causally ordered after remote history.
 *
 * The engine assumes almost nothing of the destination — no locking, no
 * transactions, no ordering guarantees — because the three supported
 * destinations offer none. What makes that safe is that objects are immutable
 * and named after the HLC of their contents: two devices can never write
 * conflicting bytes to the same name, and applying an object twice is a no-op.
 */
const MAX_OPS_PER_BATCH = 500;
const LAST_SYNC_KEY = 'sync.lastSyncAt';

export type SyncState = 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  lastError: string | null;
  /** True when the last failure looked transient, so a retry is worth offering. */
  retryable: boolean;
  pending: number;
  pulled: number;
  pushed: number;
}

const INITIAL_STATUS: SyncStatus = {
  state: 'idle',
  lastSyncAt: null,
  lastError: null,
  retryable: false,
  pending: 0,
  pulled: 0,
  pushed: 0,
};

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly crypto = inject(CryptoService);
  private readonly vault = inject(VaultService);
  private readonly ledger = inject(LedgerService);
  private readonly settings = inject(SyncSettingsService);
  private readonly adapters = inject(AdapterFactory);

  private readonly statusSignal = signal<SyncStatus>(INITIAL_STATUS);
  readonly status = this.statusSignal.asReadonly();

  /** A cycle already in flight. Sync is idempotent, but overlapping runs waste bandwidth. */
  private inFlight: Promise<SyncStatus> | null = null;

  async initialise(): Promise<void> {
    const row = await this.db.meta.get(LAST_SYNC_KEY);
    this.patch({
      lastSyncAt: (row?.value as number) ?? null,
      pending: await this.countPending(),
    });
  }

  /**
   * Run one sync cycle. Safe to call from a timer, a button and a reconnect
   * event at the same time: callers share whichever run is already going.
   */
  sync(adapterOverride?: SyncAdapter): Promise<SyncStatus> {
    return (this.inFlight ??= this.runCycle(adapterOverride).finally(() => {
      this.inFlight = null;
    }));
  }

  private async runCycle(adapterOverride?: SyncAdapter): Promise<SyncStatus> {
    if (!this.vault.isUnlocked()) {
      // Not an error worth showing in red: the user simply has not unlocked yet.
      this.patch({ state: 'idle', lastError: null });
      return this.statusSignal();
    }

    this.patch({ state: 'syncing', lastError: null, pulled: 0, pushed: 0 });

    try {
      const adapter =
        adapterOverride ?? (await this.adapters.create(this.settings.settings().target));
      const key = this.vault.requireKey();
      const vaultId = this.vault.requireVaultId();

      const pulled = await this.pull(adapter, key, vaultId);
      const pushed = await this.push(adapter, key, vaultId);
      await adapter.flush?.();

      const now = Date.now();
      await this.db.meta.put({ key: LAST_SYNC_KEY, value: now });
      this.patch({
        state: 'idle',
        lastSyncAt: now,
        lastError: null,
        retryable: false,
        pulled,
        pushed,
        pending: await this.countPending(),
      });
    } catch (error) {
      if (error instanceof NoSyncTargetError) {
        this.patch({ state: 'idle', lastError: null });
        return this.statusSignal();
      }
      this.patch({
        state: 'error',
        lastError: (error as Error).message,
        retryable: error instanceof SyncTransportError ? error.retryable : false,
        pending: await this.countPending(),
      });
    }

    return this.statusSignal();
  }

  /** Download, decrypt and merge every object this device has not applied yet. */
  private async pull(adapter: SyncAdapter, key: CryptoKey, vaultId: string): Promise<number> {
    const prefix = opsPrefix(vaultId);
    const remote = await adapter.list(prefix);

    const seen = new Set(await this.db.remoteObjects.toCollection().primaryKeys());
    const fresh = remote.filter((object) => !seen.has(object.name));
    if (fresh.length === 0) return 0;

    const ops: Operation[] = [];
    const applied: string[] = [];
    const heads: string[] = [];

    for (const object of fresh) {
      const bytes = await adapter.get(object.name);
      const { header, value } = await this.crypto.openJson<OperationBatch>(key, bytes);

      // The envelope authenticated this header, so a mismatch means the object
      // genuinely belongs to another vault sharing the same bucket.
      if (header.v !== vaultId) continue;
      // Our own batches come back from the remote; there is nothing to learn.
      if (header.d === this.vault.requireDeviceId()) {
        applied.push(object.name);
        continue;
      }

      ops.push(...value.ops);
      heads.push(header.h);
      applied.push(object.name);
    }

    // Advance the clock before merging so any local edit made after this sync
    // sorts above everything we just learned about.
    this.ledger.observeStamps(heads);
    const count = await this.ledger.merge(ops);

    await this.db.remoteObjects.bulkPut(
      applied.map((name) => ({ name, appliedAt: Date.now() })),
    );
    return count;
  }

  /** Seal and upload local operations the remote has not seen. */
  private async push(adapter: SyncAdapter, key: CryptoKey, vaultId: string): Promise<number> {
    const pending = await this.ledger.pendingOperations();
    if (pending.length === 0) return 0;

    const device = this.vault.requireDeviceId();
    let pushed = 0;

    for (let i = 0; i < pending.length; i += MAX_OPS_PER_BATCH) {
      const slice = pending.slice(i, i + MAX_OPS_PER_BATCH);
      // `synced` is local bookkeeping; it must not travel to other devices.
      const ops: Operation[] = slice.map(({ synced, ...op }) => op);
      const head = slice[slice.length - 1].hlc;

      const header: EnvelopeHeader = { v: vaultId, d: device, h: head, t: 'ops' };
      const batch: OperationBatch = { vaultId, device, head, ops };
      const sealed = await this.crypto.sealJson(key, header, batch);

      const name = opsObjectName(vaultId, head);
      await adapter.put(name, sealed);

      // Record our own object as applied, so the next pull does not download
      // and decrypt what we just uploaded.
      await this.db.remoteObjects.put({ name, appliedAt: Date.now() });
      await this.ledger.markSynced(slice.map((op) => op.hlc));
      pushed += ops.length;
    }

    return pushed;
  }

  private async countPending(): Promise<number> {
    return this.db.oplog.where('synced').equals(0).count();
  }

  private patch(partial: Partial<SyncStatus>): void {
    this.statusSignal.update((current) => ({ ...current, ...partial }));
  }
}
