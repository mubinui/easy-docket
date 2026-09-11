import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../crypto/crypto.service';
import { parseEnvelope } from '../crypto/envelope';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { VaultService } from '../keys/vault.service';
import { AdapterFactory } from './adapter-factory';
import { LedgerService } from '../repositories/ledger.service';
import { SyncSettingsService } from './sync-settings.service';
import { fakeVault } from '../testing/fake-vault';
import { InMemoryAdapter } from '../testing/in-memory-adapter';
import { aBudget, aTransaction, anAccount } from '../testing/factories';
import { SyncTransportError } from './sync-adapter';
import { SyncService } from './sync.service';

/**
 * These are integration tests: a real Dexie database, real AES-GCM, the real
 * merge algorithm and the real sync engine, with only the transport replaced.
 * Two "devices" share one `Map` of objects, which is exactly what two phones
 * pointed at the same bucket or repository look like.
 */
const VAULT_ID = '8f2a1c64-0a9a-4a4d-9c2a-3b7f1e5d6c90';

interface Device {
  ledger: LedgerService;
  sync: SyncService;
  db: DocketDb;
  adapter: InMemoryAdapter;
}

let counter = 0;

async function makeDevice(
  deviceId: string,
  key: CryptoKey,
  remote: Map<string, Uint8Array>,
): Promise<Device> {
  const db = new DocketDb(`sync-${deviceId}-${counter++}`);

  // A child environment injector gives each simulated device its own database
  // and vault while still inheriting the root-scoped services, so two devices
  // can coexist in one test process.
  const injector = createEnvironmentInjector(
    [
      { provide: DOCKET_DB, useValue: db },
      { provide: VaultService, useValue: fakeVault(VAULT_ID, deviceId, key) },
      CryptoService,
      AdapterFactory,
      SyncSettingsService,
      LedgerService,
      SyncService,
    ],
    TestBed.inject(EnvironmentInjector),
  );

  const ledger = injector.get(LedgerService);
  await ledger.initialise(deviceId);
  const sync = injector.get(SyncService);
  await sync.initialise();

  return { ledger, sync, db, adapter: new InMemoryAdapter(remote) };
}

describe('SyncService', () => {
  let key: CryptoKey;
  let remote: Map<string, Uint8Array>;
  let alice: Device;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    key = await new CryptoService().generateMasterKey();
    remote = new Map();
    alice = await makeDevice('aaaaaaaa', key, remote);
  });

  it('uploads pending operations and clears the local queue', async () => {
    await alice.ledger.put('accounts', anAccount());
    await alice.ledger.put('transactions', aTransaction());

    const status = await alice.sync.sync(alice.adapter);

    expect(status.state).toBe('idle');
    expect(status.pushed).toBe(2);
    expect(status.pending).toBe(0);
    expect(remote.size).toBe(1); // One batch object, not one per operation.
  });

  it('names remote objects under the vault prefix', async () => {
    await alice.ledger.put('accounts', anAccount());
    await alice.sync.sync(alice.adapter);

    const [name] = [...remote.keys()];
    expect(name.startsWith(`vaults/${VAULT_ID}/ops/`)).toBe(true);
    expect(name.endsWith('.edk')).toBe(true);
  });

  it('does nothing when there is nothing to do', async () => {
    const status = await alice.sync.sync(alice.adapter);
    expect(status.pushed).toBe(0);
    expect(status.pulled).toBe(0);
    expect(remote.size).toBe(0);
  });

  describe('zero knowledge', () => {
    it('leaves no plaintext of any kind at the destination', async () => {
      await alice.ledger.put('accounts', anAccount({ name: 'Joint Current Account' }));
      await alice.ledger.put(
        'transactions',
        aTransaction({ payee: 'Dr Mehta Clinic', note: 'consultation', amount: 45_000 }),
      );
      await alice.sync.sync(alice.adapter);

      const dump = alice.adapter.dump();
      for (const secret of [
        'Joint Current Account',
        'Dr Mehta Clinic',
        'consultation',
        '45000',
        'transactions',
        'accounts',
      ]) {
        expect(dump).not.toContain(secret);
      }
    });

    it('exposes only non-identifying metadata in the envelope header', async () => {
      await alice.ledger.put('transactions', aTransaction());
      await alice.sync.sync(alice.adapter);

      const [bytes] = [...remote.values()];
      const header = parseEnvelope(bytes).header;

      expect(Object.keys(header).sort()).toEqual(['d', 'h', 't', 'v']);
      expect(header.v).toBe(VAULT_ID);
      expect(header.d).toBe('aaaaaaaa');
      expect(header.t).toBe('ops');
    });

    it('never hands the key to the adapter', async () => {
      await alice.ledger.put('transactions', aTransaction());
      await alice.sync.sync(alice.adapter);

      const raw = await new CryptoService().exportMasterKey(key);
      const dump = alice.adapter.dump();
      expect(dump).not.toContain(String.fromCharCode(...raw));
    });

    it('cannot be read by a device holding a different key', async () => {
      await alice.ledger.put('transactions', aTransaction({ payee: 'Secret' }));
      await alice.sync.sync(alice.adapter);

      const otherKey = await new CryptoService().generateMasterKey();
      const intruder = await makeDevice('cccccccc', otherKey, remote);
      const status = await intruder.sync.sync(intruder.adapter);

      expect(status.state).toBe('error');
      expect(await intruder.db.transactions.count()).toBe(0);
    });
  });

  describe('two devices', () => {
    let bob: Device;

    beforeEach(async () => {
      bob = await makeDevice('bbbbbbbb', key, remote);
    });

    it('converges on the same ledger', async () => {
      await alice.ledger.put('accounts', anAccount());
      await alice.ledger.put('transactions', aTransaction({ id: 'txn-a', payee: 'From Alice' }));
      await alice.sync.sync(alice.adapter);

      await bob.ledger.put('transactions', aTransaction({ id: 'txn-b', payee: 'From Bob' }));
      await bob.sync.sync(bob.adapter); // pulls Alice, pushes Bob
      await alice.sync.sync(alice.adapter); // pulls Bob

      const inAlice = await alice.db.transactions.orderBy('id').toArray();
      const inBob = await bob.db.transactions.orderBy('id').toArray();
      expect(inAlice).toEqual(inBob);
      expect(inAlice.map((t) => t.payee)).toEqual(['From Alice', 'From Bob']);
      expect(await bob.db.accounts.count()).toBe(1);
    });

    it('resolves a concurrent edit of the same record deterministically', async () => {
      await alice.ledger.put('transactions', aTransaction({ payee: 'Original' }));
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);

      // Both edit the same transaction while offline; Bob writes second.
      await alice.ledger.put('transactions', aTransaction({ payee: 'Alice edit' }));
      await bob.ledger.put('transactions', aTransaction({ payee: 'Bob edit' }));

      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);

      const winner = (await alice.db.transactions.get('txn-1'))?.payee;
      expect(winner).toBe((await bob.db.transactions.get('txn-1'))?.payee);
      expect(winner).toBe('Bob edit');
    });

    it('propagates a deletion instead of resurrecting the record', async () => {
      await alice.ledger.put('transactions', aTransaction());
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);
      expect(await bob.db.transactions.count()).toBe(1);

      await alice.ledger.remove('transactions', 'txn-1');
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);

      expect(await bob.db.transactions.count()).toBe(0);
    });

    it('does not re-download objects it has already applied', async () => {
      await alice.ledger.put('transactions', aTransaction());
      await alice.sync.sync(alice.adapter);

      await bob.sync.sync(bob.adapter);
      const afterFirst = bob.adapter.calls.get;

      const second = await bob.sync.sync(bob.adapter);
      expect(bob.adapter.calls.get).toBe(afterFirst);
      expect(second.pulled).toBe(0);
    });

    it('ignores its own objects coming back from the remote', async () => {
      await alice.ledger.put('transactions', aTransaction());
      await alice.sync.sync(alice.adapter);

      const again = await alice.sync.sync(alice.adapter);
      expect(again.pulled).toBe(0);
      expect(await alice.db.transactions.count()).toBe(1);
    });
  });

  describe('budgets', () => {
    /**
     * Budgets are the first entity added after the sync engine was written.
     * These tests are the check that adding one costs nothing: no adapter, no
     * envelope and no engine code knows budgets exist.
     */
    it('replicates a budget to another device', async () => {
      const bob = await makeDevice('bbbbbbbb', key, remote);

      await alice.ledger.put('budgets', aBudget({ name: 'Groceries cap', amount: 40_000 }));
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);

      expect(await bob.db.budgets.get('bud-1')).toMatchObject({
        name: 'Groceries cap',
        amount: 40_000,
      });
    });

    it('encrypts budgets like everything else', async () => {
      await alice.ledger.put(
        'budgets',
        aBudget({ name: 'Divorce lawyer fund', amount: 250_000 }),
      );
      await alice.sync.sync(alice.adapter);

      const dump = alice.adapter.dump();
      expect(dump).not.toContain('Divorce lawyer fund');
      expect(dump).not.toContain('250000');
      expect(dump).not.toContain('budgets');
    });

    it('carries budgets and transactions in one batch', async () => {
      await alice.ledger.put('accounts', anAccount());
      await alice.ledger.put('budgets', aBudget());
      await alice.ledger.put('transactions', aTransaction());

      const status = await alice.sync.sync(alice.adapter);

      expect(status.pushed).toBe(3);
      expect(remote.size).toBe(1);
    });

    it('propagates a budget deletion', async () => {
      const bob = await makeDevice('bbbbbbbb', key, remote);

      await alice.ledger.put('budgets', aBudget());
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);
      expect(await bob.db.budgets.count()).toBe(1);

      await alice.ledger.remove('budgets', 'bud-1');
      await alice.sync.sync(alice.adapter);
      await bob.sync.sync(bob.adapter);

      expect(await bob.db.budgets.count()).toBe(0);
    });
  });

  describe('failure handling', () => {
    it('reports a transient failure as retryable and keeps the work queued', async () => {
      await alice.ledger.put('transactions', aTransaction());
      alice.adapter.failNext = new SyncTransportError('offline', true);

      const status = await alice.sync.sync(alice.adapter);

      expect(status.state).toBe('error');
      expect(status.retryable).toBe(true);
      expect(status.pending).toBe(1);
    });

    it('recovers on the next attempt, losing nothing', async () => {
      await alice.ledger.put('transactions', aTransaction());
      alice.adapter.failNext = new SyncTransportError('offline', true);
      await alice.sync.sync(alice.adapter);

      const status = await alice.sync.sync(alice.adapter);
      expect(status.state).toBe('idle');
      expect(status.pushed).toBe(1);
      expect(remote.size).toBe(1);
    });

    it('coalesces concurrent calls into a single cycle', async () => {
      await alice.ledger.put('transactions', aTransaction());

      const [a, b, c] = await Promise.all([
        alice.sync.sync(alice.adapter),
        alice.sync.sync(alice.adapter),
        alice.sync.sync(alice.adapter),
      ]);

      expect([a, b, c].every((s) => s.state === 'idle')).toBe(true);
      expect(alice.adapter.calls.put).toBe(1);
      expect(remote.size).toBe(1);
    });
  });
});
