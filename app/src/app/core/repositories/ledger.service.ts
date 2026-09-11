import { Injectable, inject } from '@angular/core';
import { Table } from 'dexie';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { AnyEntity, EntityMap, EntityName } from '../models/domain';
import { LocalOperation, Operation } from '../models/oplog';
import { HlcState, HybridLogicalClock, compareHlc } from '../util/hlc';

/**
 * Every write to the ledger goes through this service, and every write produces
 * an operation. That is the whole trick behind offline sync: the UI mutates
 * local state and the replication log falls out as a side effect, in the same
 * IndexedDB transaction, so the two can never disagree even if the app is
 * killed mid-write.
 *
 * Conflict resolution is last-writer-wins at whole-entity granularity, ordered
 * by hybrid logical clock. Field-level merging was considered and rejected: for
 * a personal ledger, two devices editing the *same* transaction at the same
 * time is vanishingly rare, whereas a subtly half-merged transaction whose
 * amount comes from one device and category from another would be actively
 * misleading in a financial record.
 */
const CLOCK_STATE_KEY = 'hlc.state';

@Injectable({ providedIn: 'root' })
export class LedgerService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private clock: HybridLogicalClock | null = null;

  /**
   * The clock has to be restored from disk before the first write, or a device
   * restarted inside the same millisecond could reuse a stamp.
   */
  async initialise(deviceId: string): Promise<void> {
    const row = await this.db.meta.get(CLOCK_STATE_KEY);
    this.clock = new HybridLogicalClock(deviceId, Date.now, row?.value as HlcState | undefined);
  }

  private requireClock(): HybridLogicalClock {
    if (!this.clock) throw new Error('LedgerService.initialise() has not been called');
    return this.clock;
  }

  /** Create or replace an entity, recording the operation for replication. */
  async put<K extends EntityName>(entity: K, value: EntityMap[K]): Promise<EntityMap[K]> {
    const clock = this.requireClock();
    const stamped = { ...value, updatedAt: clock.tick() } as EntityMap[K];

    await this.db.transaction('rw', this.table(entity), this.db.oplog, this.db.meta, async () => {
      await this.table(entity).put(stamped);
      await this.db.oplog.put({
        hlc: stamped.updatedAt,
        entity,
        entityId: stamped.id,
        op: 'put',
        value: stamped,
        device: clock.device,
        synced: 0,
      });
      await this.persistClock(clock);
    });

    return stamped;
  }

  /**
   * Delete an entity. The row goes, but a tombstone operation stays in the log:
   * without it, a stale `put` arriving later from a device that was offline
   * would quietly resurrect the deleted record.
   */
  async remove(entity: EntityName, id: string): Promise<void> {
    const clock = this.requireClock();
    const hlc = clock.tick();

    await this.db.transaction('rw', this.table(entity), this.db.oplog, this.db.meta, async () => {
      await this.table(entity).delete(id);
      await this.db.oplog.put({
        hlc,
        entity,
        entityId: id,
        op: 'delete',
        device: clock.device,
        synced: 0,
      });
      await this.persistClock(clock);
    });
  }

  /**
   * Apply operations received from another device.
   *
   * Returns the number actually applied; the rest were duplicates or stale,
   * which is expected and cheap — a pull that overlaps a previous pull must be
   * a no-op, because remote destinations give no transactional guarantees.
   */
  async merge(ops: readonly Operation[]): Promise<number> {
    if (ops.length === 0) return 0;
    const clock = this.requireClock();

    // Applying in causal order means a delete that follows a put in the same
    // batch lands in the right sequence regardless of arrival order.
    const ordered = [...ops].sort((a, b) => compareHlc(a.hlc, b.hlc));
    let applied = 0;

    await this.db.transaction(
      'rw',
      this.db.accounts,
      this.db.categories,
      this.db.transactions,
      this.db.oplog,
      this.db.meta,
      async () => {
        for (const op of ordered) {
          const latest = await this.latestStampFor(op.entity, op.entityId);
          if (latest && compareHlc(op.hlc, latest) <= 0) continue;

          if (op.op === 'delete') {
            await this.table(op.entity).delete(op.entityId);
          } else if (op.value) {
            await this.table(op.entity).put(op.value);
          } else {
            // A `put` with no value is malformed; skip it rather than writing
            // `undefined` into the ledger.
            continue;
          }

          await this.db.oplog.put({ ...op, synced: 1 });
          applied++;
        }
        await this.persistClock(clock);
      },
    );

    return applied;
  }

  /**
   * Fold remote clock stamps into the local clock. Done before `merge` so that
   * a subsequent local edit is ordered after everything we just learned about.
   */
  observeStamps(stamps: readonly string[]): void {
    const clock = this.requireClock();
    for (const stamp of stamps) clock.observe(stamp);
  }

  /** Operations authored here that the remote has not seen yet. */
  async pendingOperations(limit = 5_000): Promise<LocalOperation[]> {
    return this.db.oplog.where('synced').equals(0).limit(limit).sortBy('hlc');
  }

  async markSynced(stamps: readonly string[]): Promise<void> {
    await this.db.transaction('rw', this.db.oplog, async () => {
      for (const hlc of stamps) {
        await this.db.oplog.update(hlc, { synced: 1 });
      }
    });
  }

  /** Full operation history, used to seed a brand new remote destination. */
  async allOperations(): Promise<LocalOperation[]> {
    return this.db.oplog.orderBy('hlc').toArray();
  }

  async persistClockState(): Promise<void> {
    await this.persistClock(this.requireClock());
  }

  private async latestStampFor(entity: EntityName, entityId: string): Promise<string | null> {
    // The primary key of `oplog` is the HLC stamp itself, so the newest write
    // for an entity can be found without deserialising a single row.
    const stamps = (await this.db.oplog
      .where('[entity+entityId]')
      .equals([entity, entityId])
      .primaryKeys()) as string[];

    let max: string | null = null;
    for (const stamp of stamps) {
      if (!max || compareHlc(stamp, max) > 0) max = stamp;
    }
    return max;
  }

  private async persistClock(clock: HybridLogicalClock): Promise<void> {
    await this.db.meta.put({ key: CLOCK_STATE_KEY, value: clock.snapshot });
  }

  /**
   * The three entity tables are structurally identical from this service's
   * point of view; widening to a common row type keeps `put`/`remove`/`merge`
   * from needing a switch over every entity name.
   */
  private table(entity: EntityName): Table<AnyEntity, string> {
    return this.db[entity] as unknown as Table<AnyEntity, string>;
  }
}
