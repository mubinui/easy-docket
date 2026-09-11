import { Injectable, inject, signal } from '@angular/core';
import { CryptoService } from '../crypto/crypto.service';
import { EnvelopeHeader } from '../crypto/envelope';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { VaultService } from '../keys/vault.service';
import { ENTITY_NAMES, AnyEntity } from '../models/domain';
import { LedgerSnapshot, Operation, OperationBatch } from '../models/oplog';
import { LedgerService } from '../repositories/ledger.service';
import { AdapterFactory, NoSyncTargetError } from './adapter-factory';
import { SyncAdapter, SyncTransportError } from './sync-adapter';
import { SyncSettingsService } from './sync-settings.service';
import {
  opsObjectName,
  opsPrefix,
  snapshotObjectName,
  snapshotPrefix,
  stampFromObjectName,
} from './sync-target';

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
const LAST_SNAPSHOT_KEY = 'sync.lastSnapshot';

/**
 * How many operations may accumulate past the newest snapshot before another is
 * written.
 *
 * Snapshots are what stop a device joining a five-year-old vault from replaying
 * every batch ever written, so they need to be frequent enough to matter and
 * rare enough not to dominate what is uploaded. A few hundred operations is a
 * handful of months of ordinary use.
 */
export const SNAPSHOT_AFTER_OPERATIONS = 200;

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
      await this.maybeSnapshot(adapter, key, vaultId);
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
    const seen = new Set(await this.db.remoteObjects.toCollection().primaryKeys());

    // A snapshot first, when one would save work. Everything it covers can then
    // be skipped rather than downloaded and merged operation by operation.
    const watermark = await this.applySnapshot(adapter, key, vaultId, seen);

    const remote = await adapter.list(opsPrefix(vaultId));
    const fresh: typeof remote = [];
    const covered: string[] = [];

    for (const object of remote) {
      if (seen.has(object.name)) continue;

      // The object is named after the newest operation inside it, so a name at
      // or below the watermark holds nothing the snapshot has not already said.
      const stamp = stampFromObjectName(object.name);
      const isCovered = watermark !== null && stamp !== null && stamp <= watermark;

      if (isCovered) covered.push(object.name);
      else fresh.push(object);
    }

    // Recorded as applied, not merely skipped. Otherwise the next sync — which
    // has no snapshot to apply, because this device now has the history — would
    // see them as unknown and download every one.
    if (covered.length > 0) {
      await this.db.remoteObjects.bulkPut(
        covered.map((name) => ({ name, appliedAt: Date.now() })),
      );
    }

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

  /**
   * Apply the newest snapshot, if there is one worth applying.
   *
   * Only when this device has applied nothing yet: a device already following
   * the vault has the history, and re-applying a snapshot would be work for
   * nothing. Returns the watermark it applied, or null.
   */
  private async applySnapshot(
    adapter: SyncAdapter,
    key: CryptoKey,
    vaultId: string,
    seen: Set<string>,
  ): Promise<string | null> {
    if (seen.size > 0) return null;

    const snapshots = await adapter.list(snapshotPrefix(vaultId));
    if (snapshots.length === 0) return null;

    // Names sort by clock stamp, so the last is the newest.
    const newest = snapshots[snapshots.length - 1];
    const bytes = await adapter.get(newest.name);
    const { header, value } = await this.crypto.openJson<LedgerSnapshot>(key, bytes);
    if (header.v !== vaultId) return null;

    // Rebuilt as operations carrying each entity's own stamp, so merge applies
    // exactly the rules it would for live edits — including leaving alone
    // anything this device deleted after the snapshot was taken.
    const ops: Operation[] = [];
    for (const name of ENTITY_NAMES) {
      for (const row of (value.entities[name] ?? []) as AnyEntity[]) {
        if (!row || typeof row.id !== 'string' || typeof row.updatedAt !== 'string') continue;
        ops.push({
          hlc: row.updatedAt,
          entity: name,
          entityId: row.id,
          op: 'put',
          value: row,
          device: value.device,
        });
      }
    }

    this.ledger.observeStamps([value.watermark]);
    await this.ledger.merge(ops);

    await this.db.remoteObjects.put({ name: newest.name, appliedAt: Date.now() });
    seen.add(newest.name);

    // Record it as the snapshot this device knows about, so joining a vault
    // does not immediately write a second snapshot of the history it just
    // received — every new device would otherwise add one.
    await this.db.meta.put({ key: LAST_SNAPSHOT_KEY, value: value.watermark });

    return value.watermark;
  }

  /**
   * Write a snapshot once enough operations have accumulated past the last one.
   *
   * Without this, joining a long-lived vault means replaying every batch ever
   * written. The operations are left in place: a snapshot makes the download
   * cheap, and removing what it covers needs a delete the adapters do not have.
   */
  private async maybeSnapshot(
    adapter: SyncAdapter,
    key: CryptoKey,
    vaultId: string,
  ): Promise<void> {
    const row = await this.db.meta.get(LAST_SNAPSHOT_KEY);
    const last = (row?.value as string | undefined) ?? '';

    const since = await this.db.oplog.filter((op) => op.hlc > last).count();
    if (since < SNAPSHOT_AFTER_OPERATIONS) return;

    const operations = await this.db.oplog.orderBy('hlc').toArray();
    const watermark = operations[operations.length - 1]?.hlc;
    if (!watermark) return;

    const entities: LedgerSnapshot['entities'] = {};
    for (const name of ENTITY_NAMES) {
      entities[name] = (await (
        this.db[name] as unknown as { toArray(): Promise<AnyEntity[]> }
      ).toArray()) as AnyEntity[];
    }

    const device = this.vault.requireDeviceId();
    const snapshot: LedgerSnapshot = {
      vaultId,
      device,
      watermark,
      entities,
      operationCount: operations.length,
    };

    const name = snapshotObjectName(vaultId, watermark);
    const sealed = await this.crypto.sealJson(
      key,
      { v: vaultId, d: device, h: watermark, t: 'snapshot' },
      snapshot,
    );

    await adapter.put(name, sealed);
    await this.db.remoteObjects.put({ name, appliedAt: Date.now() });
    await this.db.meta.put({ key: LAST_SNAPSHOT_KEY, value: watermark });
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
