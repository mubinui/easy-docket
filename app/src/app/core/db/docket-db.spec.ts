import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DocketDb } from './docket-db';
import { anAccount, aTransaction } from '../testing/factories';

/**
 * Schema migration tests.
 *
 * The thing worth protecting here is that an upgrade never costs a user their
 * ledger. A device that has been on v1 for a year must open v2 with every row
 * exactly where it was, so the v1 schema is rebuilt by hand rather than taken
 * from the current source — otherwise the test would move in lockstep with the
 * code it is meant to catch.
 */
const V1_STORES = {
  accounts: 'id, name, kind, archived',
  categories: 'id, name, kind, parentId, archived',
  transactions: 'id, date, accountId, categoryId, kind, [accountId+date], [kind+date]',
  oplog: 'hlc, synced, [entity+entityId]',
  remoteObjects: 'name',
  meta: 'key',
};

let counter = 0;

async function seedV1Database(name: string): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(1).stores(V1_STORES);
  await legacy.open();

  await legacy.table('accounts').put(anAccount({ updatedAt: 'stamp-a' }));
  await legacy.table('transactions').put(aTransaction({ updatedAt: 'stamp-t' }));
  await legacy.table('meta').put({ key: 'hlc.state', value: { physical: 42, counter: 7 } });
  await legacy.table('oplog').put({
    hlc: 'stamp-a',
    entity: 'accounts',
    entityId: 'acc-1',
    op: 'put',
    device: 'aaaaaaaa',
    synced: 1,
  });

  legacy.close();
}

describe('DocketDb schema', () => {
  it('upgrades a v1 database to v2 without disturbing existing rows', async () => {
    const name = `migration-${counter++}`;
    await seedV1Database(name);

    const db = new DocketDb(name);
    await db.open();

    expect(db.verno).toBe(2);
    expect(await db.accounts.get('acc-1')).toMatchObject({
      name: 'Everyday',
      updatedAt: 'stamp-a',
    });
    expect(await db.transactions.get('txn-1')).toMatchObject({ payee: 'Corner Shop' });
    expect((await db.meta.get('hlc.state'))?.value).toEqual({ physical: 42, counter: 7 });
    expect(await db.oplog.count()).toBe(1);

    db.close();
  });

  it('adds an empty budgets table on upgrade', async () => {
    const name = `migration-${counter++}`;
    await seedV1Database(name);

    const db = new DocketDb(name);
    await db.open();

    expect(await db.budgets.count()).toBe(0);
    db.close();
  });

  it('creates every table on a fresh install', async () => {
    const db = new DocketDb(`fresh-${counter++}`);
    await db.open();

    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'accounts',
      'budgets',
      'categories',
      'meta',
      'oplog',
      'remoteObjects',
      'transactions',
    ]);
    db.close();
  });

  it('indexes budgets for the queries the budget screens will make', async () => {
    const db = new DocketDb(`indexes-${counter++}`);
    await db.open();

    const indexes = db.budgets.schema.indexes.map((i) => i.keyPath);
    expect(indexes).toContain('period');
    expect(indexes).toContain('archived');
    expect(db.budgets.schema.primKey.keyPath).toBe('id');
    db.close();
  });
});
