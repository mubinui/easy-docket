import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../crypto/crypto.service';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { FileExportService } from '../export/file-export.service';
import { VaultService } from '../keys/vault.service';
import { LedgerService } from '../repositories/ledger.service';
import { fakeVault } from '../testing/fake-vault';
import { encodeHlc } from '../util/hlc';
import { aBudget, aCategory, aTransaction, anAccount } from '../testing/factories';
import { BackupFormatError, backupFilename, countRows, validateBackup } from './backup';
import { BackupService } from './backup.service';

let counter = 0;
const VAULT_ID = '8f2a1c64-0a9a-4a4d-9c2a-3b7f1e5d6c90';

interface Harness {
  backup: BackupService;
  ledger: LedgerService;
  db: DocketDb;
  exported: { filename: string; contents: string }[];
}

async function makeHarness(key: CryptoKey, vaultId = VAULT_ID): Promise<Harness> {
  const db = new DocketDb(`backup-${counter++}`);
  const exported: { filename: string; contents: string }[] = [];

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const files = {
    exportText: vi.fn(async (filename: string, contents: string) => {
      exported.push({ filename, contents });
    }),
  };

  const injector = createEnvironmentInjector(
    [
      { provide: DOCKET_DB, useValue: db },
      { provide: VaultService, useValue: fakeVault(vaultId, 'aaaaaaaa', key) },
      { provide: FileExportService, useValue: files },
      CryptoService,
      LedgerService,
      BackupService,
    ],
    TestBed.inject(EnvironmentInjector),
  );

  const ledger = injector.get(LedgerService);
  await ledger.initialise('aaaaaaaa');

  return { backup: injector.get(BackupService), ledger, db, exported };
}

describe('backup format', () => {
  it('names a file so backups sort by date', () => {
    expect(backupFilename(Date.UTC(2026, 2, 14, 9, 30, 0))).toBe(
      'easy-docket-backup-2026-03-14-09-30-00.edk',
    );
  });

  it('counts the rows a payload holds', () => {
    expect(
      countRows({
        format: 1,
        takenAt: 0,
        vaultId: VAULT_ID,
        entities: { accounts: [1, 2], transactions: [3] } as never,
      }),
    ).toBe(3);
  });

  describe('validation', () => {
    const valid = { format: 1, takenAt: 1, vaultId: VAULT_ID, entities: { accounts: [] } };

    it('accepts a well-formed payload', () => {
      expect(validateBackup(valid).vaultId).toBe(VAULT_ID);
    });

    it('rejects something that is not a backup', () => {
      for (const value of [null, 42, 'hello', {}]) {
        expect(() => validateBackup(value)).toThrow(BackupFormatError);
      }
    });

    it('refuses a format from a newer build rather than half-applying it', () => {
      expect(() => validateBackup({ ...valid, format: 99 })).toThrow(/newer version/);
    });

    it('refuses a payload naming an entity it does not know', () => {
      // Restoring the rest would silently drop whatever that was.
      expect(() => validateBackup({ ...valid, entities: { wallets: [] } })).toThrow(/unknown data/);
    });

    it('refuses a malformed section', () => {
      expect(() => validateBackup({ ...valid, entities: { accounts: 'nope' } })).toThrow(
        /malformed/,
      );
    });
  });
});

describe('BackupService', () => {
  let key: CryptoKey;
  let harness: Harness;

  beforeEach(async () => {
    key = await new CryptoService().generateMasterKey();
    harness = await makeHarness(key);
  });

  /**
   * Seeded through the ledger so every row carries a real clock stamp.
   * Restore compares stamps, and a literal like "a" sorts above a real HLC
   * (which begins with a digit), which would make a backup look newer than
   * anything written since.
   */
  async function seed(): Promise<void> {
    await harness.ledger.put('accounts', anAccount());
    await harness.ledger.put('categories', aCategory());
    await harness.ledger.put('transactions', aTransaction());
    await harness.ledger.put('budgets', aBudget());
  }

  describe('export', () => {
    it('writes an encrypted file naming every entity', async () => {
      await seed();
      const result = await harness.backup.export();

      expect(result.rows).toBe(4);
      expect(result.filename).toMatch(/^easy-docket-backup-/);
      expect(harness.exported).toHaveLength(1);
    });

    it('leaves nothing readable in the file', async () => {
      // A backup of an encrypted ledger landing in plain text would undo the
      // entire design.
      await harness.db.transactions.put(
        aTransaction({ payee: 'Dr Mehta Clinic', amount: 45_000 }),
      );
      await harness.backup.export();

      const [file] = harness.exported;
      expect(file.contents).not.toContain('Dr Mehta');
      expect(file.contents).not.toContain('45000');
      expect(file.contents).not.toContain('transactions');
    });
  });

  describe('inspect', () => {
    it('reads back what it wrote', async () => {
      await seed();
      await harness.backup.export();

      const payload = await harness.backup.inspect(harness.exported[0].contents);

      expect(payload.vaultId).toBe(VAULT_ID);
      expect(countRows(payload)).toBe(4);
    });

    it('rejects a file that is not a backup, in words a person can act on', async () => {
      for (const contents of ['not a backup at all', '', 'AAAA', '{"format":1}']) {
        await expect(harness.backup.inspect(contents), contents).rejects.toThrow(
          /not an Easy Docket backup/,
        );
      }
    });

    it('cannot be opened with a different key', async () => {
      await seed();
      await harness.backup.export();

      const other = await makeHarness(await new CryptoService().generateMasterKey());
      await expect(other.backup.inspect(harness.exported[0].contents)).rejects.toThrow(
        /not an Easy Docket backup/,
      );
    });

    it('refuses a backup of another vault, even with the same key', async () => {
      // Two vaults can share a passphrase; merging them would interleave two
      // people's money.
      await seed();
      await harness.backup.export();

      const elsewhere = await makeHarness(key, 'a-different-vault');
      await expect(elsewhere.backup.inspect(harness.exported[0].contents)).rejects.toThrow(
        /different vault/,
      );
    });
  });

  describe('restore', () => {
    it('writes every row into an empty vault', async () => {
      await seed();
      await harness.backup.export();

      const fresh = await makeHarness(key);
      const payload = await fresh.backup.inspect(harness.exported[0].contents);
      const result = await fresh.backup.restore(payload);

      expect(result).toEqual({ restored: 4, skipped: 0 });
      expect(await fresh.db.transactions.count()).toBe(1);
      expect(await fresh.db.budgets.count()).toBe(1);
    });

    it('writes through the ledger, so a restored vault still syncs', async () => {
      await seed();
      await harness.backup.export();

      const fresh = await makeHarness(key);
      await fresh.backup.restore(await fresh.backup.inspect(harness.exported[0].contents));

      // Every restored row is an operation waiting to be pushed.
      expect(await fresh.ledger.pendingOperations()).toHaveLength(4);
    });

    it('does not undo work done since the backup was taken', async () => {
      await seed();
      await harness.backup.export();

      // The same transaction, edited after the backup.
      await harness.ledger.put('transactions', aTransaction({ payee: 'Edited since' }));
      const payload = await harness.backup.inspect(harness.exported[0].contents);

      const result = await harness.backup.restore(payload);

      expect((await harness.db.transactions.get('txn-1'))?.payee).toBe('Edited since');
      expect(result.skipped).toBeGreaterThan(0);
    });

    it('restores a row that is older locally', async () => {
      await seed();
      await harness.backup.export();

      const fresh = await makeHarness(key);
      // An explicitly ancient stamp, so the backed-up row is unambiguously newer.
      await fresh.db.transactions.put(
        aTransaction({ payee: 'Stale', updatedAt: encodeHlc({ physical: 1, counter: 0 }, 'zzzzzzzz') }),
      );

      await fresh.backup.restore(await fresh.backup.inspect(harness.exported[0].contents));
      expect((await fresh.db.transactions.get('txn-1'))?.payee).toBe('Corner Shop');
    });

    it('skips a malformed row rather than writing rubbish', async () => {
      const fresh = await makeHarness(key);
      const result = await fresh.backup.restore({
        format: 1,
        takenAt: 0,
        vaultId: VAULT_ID,
        entities: { accounts: [null, { noId: true }, anAccount()] } as never,
      });

      expect(result).toEqual({ restored: 1, skipped: 2 });
    });

    it('is safe to run twice', async () => {
      await seed();
      await harness.backup.export();

      const fresh = await makeHarness(key);
      const payload = await fresh.backup.inspect(harness.exported[0].contents);

      await fresh.backup.restore(payload);
      const second = await fresh.backup.restore(payload);

      // The first restore stamped every row with a newer clock, so the second
      // has nothing to do.
      expect(second.restored).toBe(0);
      expect(await fresh.db.accounts.count()).toBe(1);
    });
  });
});
