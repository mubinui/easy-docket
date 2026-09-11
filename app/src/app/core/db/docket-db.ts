import Dexie, { Table } from 'dexie';
import {
  Account,
  Budget,
  Category,
  ExchangeRate,
  RecurringRule,
  Transaction,
  VaultSettings,
} from '../models/domain';
import { LocalOperation } from '../models/oplog';

/**
 * The local database is the application's source of truth. Sync is a background
 * concern that reconciles this database with a remote; nothing in the UI ever
 * waits on the network, which is what makes the app usable on a plane or in a
 * basement supermarket.
 *
 * Two kinds of table live here:
 *
 *  - **Materialised entities** (`accounts`, `categories`, `transactions`,
 *    `budgets`, `recurringRules`) — the current state, indexed for the queries
 *    the UI makes.
 *  - **Replication bookkeeping** (`oplog`, `remoteObjects`, `meta`) — the
 *    append-only operation log plus a record of which remote objects have
 *    already been merged, so a repeated pull is cheap and idempotent.
 */

/** A remote object we have already downloaded and applied. */
export interface RemoteObjectRecord {
  /** Remote object name, e.g. `ops/0000001700000000000-0000-a1b2c3d4.edk`. */
  name: string;
  appliedAt: number;
}

/** Small key/value rows for state that does not deserve a table of its own. */
export interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * The schema version this build declares.
 *
 * Exported so tests can assert "upgrades to the current version" rather than a
 * literal that has to be edited on every bump — a test that needs changing
 * whenever the schema grows stops being a check and becomes a chore.
 */
export const SCHEMA_VERSION = 5;

export class DocketDb extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  budgets!: Table<Budget, string>;
  recurringRules!: Table<RecurringRule, string>;
  rates!: Table<ExchangeRate, string>;
  vaultSettings!: Table<VaultSettings, string>;
  oplog!: Table<LocalOperation, string>;
  remoteObjects!: Table<RemoteObjectRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name = 'easy-docket') {
    super(name);

    // v1 — core ledger.
    this.version(1).stores({
      accounts: 'id, name, kind, archived',
      categories: 'id, name, kind, parentId, archived',
      // The compound [accountId+date] index serves the account register, which
      // is the single most frequent query in the app.
      transactions: 'id, date, accountId, categoryId, kind, [accountId+date], [kind+date]',
      // `synced` is indexed so the push path can find unsent work in one seek.
      oplog: 'hlc, synced, [entity+entityId]',
      remoteObjects: 'name',
      meta: 'key',
    });

    // v2 — budgets.
    //
    // Only the new table is declared: Dexie carries every unchanged store
    // forward, and an upgrade with no `.upgrade()` callback needs no data
    // migration because existing rows are untouched. Budgets replicate through
    // the same operation log as everything else, so neither the sync engine nor
    // any adapter changes for this.
    this.version(2).stores({
      budgets: 'id, period, archived',
    });

    // v3 — recurring rules.
    //
    // `nextDue` is not stored: it is derived from the schedule and what has
    // already been materialised, and a cached copy would be one more thing to
    // keep correct across two devices that both ran the materialiser.
    this.version(3).stores({
      recurringRules: 'id, startDate, archived',
    });

    // v4 — exchange rates.
    //
    // The compound [base+quote+date] index serves the only question asked of
    // this table: what was this pair worth on, or before, a given day. No
    // migration: `Transaction.rate` and `rateDate` are optional, and rows
    // written before multi-currency simply do not carry them.
    this.version(4).stores({
      rates: 'id, date, [base+quote+date]',
    });

    // v5 — vault-wide settings. One row, so no index beyond the key.
    this.version(5).stores({
      vaultSettings: 'id',
    });
  }
}

/**
 * Dexie keeps a module-level connection per database name; sharing one instance
 * avoids the "blocked" upgrade dance that happens when two connections to the
 * same database disagree about the schema version.
 */
let instance: DocketDb | null = null;

export function getDb(): DocketDb {
  return (instance ??= new DocketDb());
}

/** Test hook: swap in an isolated database so suites cannot see each other's rows. */
export function setDb(db: DocketDb | null): void {
  instance = db;
}
