import Dexie, { Table } from 'dexie';
import { Account, Category, Transaction } from '../models/domain';
import { LocalOperation } from '../models/oplog';

/**
 * The local database is the application's source of truth. Sync is a background
 * concern that reconciles this database with a remote; nothing in the UI ever
 * waits on the network, which is what makes the app usable on a plane or in a
 * basement supermarket.
 *
 * Two kinds of table live here:
 *
 *  - **Materialised entities** (`accounts`, `categories`, `transactions`) — the
 *    current state, indexed for the queries the UI actually makes.
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

export class DocketDb extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
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
