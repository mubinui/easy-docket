import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DocketDb, SCHEMA_VERSION } from './docket-db';
import { aBudget, anAccount, anAccountGroup, aTransaction } from '../testing/factories';

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

/**
 * The schema exactly as the previous release declared it. Hand-written for the
 * same reason as `V1_STORES`: a fixture copied from the current source would
 * follow every change made to it and catch nothing.
 */
const V5_VERSIONS: ReadonlyArray<[number, Record<string, string>]> = [
  [1, V1_STORES],
  [2, { budgets: 'id, period, archived' }],
  [3, { recurringRules: 'id, startDate, archived' }],
  [4, { rates: 'id, date, [base+quote+date]' }],
  [5, { vaultSettings: 'id' }],
];

/** Open `name` at v5, as a device on the previous release would have it. */
async function openAtV5(name: string): Promise<Dexie> {
  const legacy = new Dexie(name);
  for (const [version, stores] of V5_VERSIONS) legacy.version(version).stores(stores);
  await legacy.open();
  return legacy;
}

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
  it('upgrades a v1 database to the current version without disturbing existing rows', async () => {
    const name = `migration-${counter++}`;
    await seedV1Database(name);

    const db = new DocketDb(name);
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
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
      'accountGroups',
      'accounts',
      'budgets',
      'categories',
      'meta',
      'oplog',
      'rates',
      'recurringRules',
      'remoteObjects',
      'transactions',
      'vaultSettings',
    ]);
    db.close();
  });

  it('upgrades a v2 database to the current version, budgets intact', async () => {
    const name = `migration-${counter++}`;
    await seedV1Database(name);

    // Open at v2 and write a budget, as a device on the previous release would.
    const v2 = new Dexie(name);
    v2.version(1).stores(V1_STORES);
    v2.version(2).stores({ budgets: 'id, period, archived' });
    await v2.open();
    await v2.table('budgets').put(aBudget({ name: 'Groceries cap' }));
    v2.close();

    const db = new DocketDb(name);
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    expect((await db.budgets.get('bud-1'))?.name).toBe('Groceries cap');
    expect(await db.accounts.get('acc-1')).toBeDefined();
    expect(await db.recurringRules.count()).toBe(0);

    db.close();
  });

  it('indexes recurring rules for the queries the rule screens will make', async () => {
    const db = new DocketDb(`indexes-${counter++}`);
    await db.open();

    const indexes = db.recurringRules.schema.indexes.map((i) => i.keyPath);
    expect(indexes).toContain('startDate');
    expect(indexes).toContain('archived');
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

  it('upgrades a v5 database to v6 with every row intact and accounts ungrouped', async () => {
    const name = `migration-${counter++}`;
    await seedV1Database(name);

    const v5 = await openAtV5(name);
    await v5.table('budgets').put(aBudget({ name: 'Groceries cap' }));
    await v5.table('vaultSettings').put({
      id: 'vault',
      reportingCurrency: 'EUR',
      createdAt: 1,
      updatedAt: 'stamp-v',
    });
    v5.close();

    const db = new DocketDb(name);
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    // Everything the previous release wrote is still where it was.
    expect(await db.accounts.get('acc-1')).toMatchObject({
      name: 'Everyday',
      updatedAt: 'stamp-a',
    });
    expect((await db.budgets.get('bud-1'))?.name).toBe('Groceries cap');
    expect((await db.vaultSettings.get('vault'))?.reportingCurrency).toBe('EUR');
    expect(await db.transactions.get('txn-1')).toBeDefined();
    expect(await db.oplog.count()).toBe(1);

    // An account written before groups existed reads as ungrouped rather than
    // being rewritten to carry an explicit null.
    const account = await db.accounts.get('acc-1');
    expect(account?.groupId ?? null).toBeNull();
    expect(Object.hasOwn(account as object, 'groupId')).toBe(false);

    expect(await db.accountGroups.count()).toBe(0);

    db.close();
  });

  it('indexes account groups and account membership for the accounts screen', async () => {
    const db = new DocketDb(`indexes-${counter++}`);
    await db.open();

    const groupIndexes = db.accountGroups.schema.indexes.map((i) => i.keyPath);
    expect(groupIndexes).toEqual(expect.arrayContaining(['name', 'type', 'order', 'archived']));
    expect(db.accountGroups.schema.primKey.keyPath).toBe('id');

    // Redeclaring `accounts` in v6 replaces its index set, so the indexes it
    // already had have to survive alongside the new one.
    const accountIndexes = db.accounts.schema.indexes.map((i) => i.keyPath);
    expect(accountIndexes).toEqual(
      expect.arrayContaining(['name', 'kind', 'archived', 'groupId']),
    );

    db.close();
  });

  it('finds the accounts in a group by index', async () => {
    const db = new DocketDb(`group-query-${counter++}`);
    await db.open();

    await db.accountGroups.put(anAccountGroup({ id: 'grp-cards' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'acc-visa', name: 'Visa', groupId: 'grp-cards' }),
      anAccount({ id: 'acc-amex', name: 'Amex', groupId: 'grp-cards' }),
      anAccount({ id: 'acc-loose', name: 'Everyday', groupId: null }),
      anAccount({ id: 'acc-legacy', name: 'Old' }),
    ]);

    const inGroup = await db.accounts.where('groupId').equals('grp-cards').toArray();
    expect(inGroup.map((a) => a.id).sort()).toEqual(['acc-amex', 'acc-visa']);

    db.close();
  });
});
