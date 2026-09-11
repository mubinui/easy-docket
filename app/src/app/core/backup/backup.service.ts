import { Injectable, inject } from '@angular/core';
import { CryptoService, fromBase64, toBase64 } from '../crypto/crypto.service';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { FileExportService } from '../export/file-export.service';
import { VaultService } from '../keys/vault.service';
import { AnyEntity, ENTITY_NAMES, EntityName } from '../models/domain';
import { LedgerService } from '../repositories/ledger.service';
import {
  BACKUP_FORMAT,
  BackupFormatError,
  BackupPayload,
  backupFilename,
  countRows,
  validateBackup,
} from './backup';

export interface RestoreResult {
  /** Rows written into the ledger. */
  restored: number;
  /** Rows already present and newer, so left alone. */
  skipped: number;
}

/**
 * Writing and reading a backup file.
 *
 * The file is sealed with the vault's master key, exactly like anything sent to
 * a sync destination — a backup of an encrypted ledger that landed in plain
 * text would undo the whole design. That has a consequence worth stating: the
 * file is useless without the passphrase, so it is a backup of the *data*, not
 * of the key. The recovery bundle on the security screen is the other half.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly crypto = inject(CryptoService);
  private readonly vault = inject(VaultService);
  private readonly ledger = inject(LedgerService);
  private readonly files = inject(FileExportService);

  /** Build the payload for the current vault. */
  async build(): Promise<BackupPayload> {
    const entities: BackupPayload['entities'] = {};

    for (const name of ENTITY_NAMES) {
      entities[name] = await (this.db[name] as unknown as { toArray(): Promise<unknown[]> }).toArray();
    }

    return {
      format: BACKUP_FORMAT,
      takenAt: Date.now(),
      vaultId: this.vault.requireVaultId(),
      entities,
    };
  }

  /** Seal a backup and hand it to the user. */
  async export(): Promise<{ filename: string; rows: number }> {
    const payload = await this.build();
    const sealed = await this.crypto.sealJson(
      this.vault.requireKey(),
      {
        v: payload.vaultId,
        d: this.vault.requireDeviceId(),
        h: '',
        t: 'backup',
      },
      payload,
    );

    const filename = backupFilename(payload.takenAt);
    // Base64 rather than raw bytes: the file travels through share sheets and
    // mail attachments, and a text payload survives that unchanged.
    await this.files.exportText(filename, toBase64(sealed), 'application/octet-stream');

    return { filename, rows: countRows(payload) };
  }

  /** Decrypt and check a backup without writing anything. */
  async inspect(contents: string): Promise<BackupPayload> {
    let value: unknown;

    try {
      const sealed = fromBase64(contents.trim());
      ({ value } = await this.crypto.openJson<unknown>(this.vault.requireKey(), sealed));
    } catch {
      // Base64 that will not decode, bytes that are not an envelope, and a
      // wrong key all land here, and the distinction is not one a user can act
      // on — nor one worth confirming to someone holding a file they should not
      // have. "Envelope truncated before header" is a sentence for a developer.
      throw new BackupFormatError(
        'That file is not an Easy Docket backup, or it was made by a different vault',
      );
    }

    const payload = validateBackup(value);

    if (payload.vaultId !== this.vault.requireVaultId()) {
      // Decryption succeeded, so the key matches — but the vault id does not,
      // which means this is a backup of a different ledger that happens to
      // share a passphrase. Merging them would interleave two people's money.
      throw new BackupFormatError('That backup belongs to a different vault');
    }

    return payload;
  }

  /**
   * Restore a backup into the current vault.
   *
   * Rows are written through the ledger, so each becomes an operation and
   * replicates like any other edit. A row already present with a newer stamp is
   * left alone: restoring an old backup should not undo work done since, and
   * the clock is the only thing that can settle which is which.
   */
  async restore(payload: BackupPayload): Promise<RestoreResult> {
    let restored = 0;
    let skipped = 0;

    for (const name of ENTITY_NAMES) {
      const rows = (payload.entities[name] ?? []) as AnyEntity[];

      for (const row of rows) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string') {
          skipped++;
          continue;
        }

        if (await this.isNewerLocally(name, row)) {
          skipped++;
          continue;
        }

        await this.ledger.put(name, row as never);
        restored++;
      }
    }

    return { restored, skipped };
  }

  /** Whether what is on this device already supersedes the backed-up row. */
  private async isNewerLocally(name: EntityName, row: AnyEntity): Promise<boolean> {
    const table = this.db[name] as unknown as { get(id: string): Promise<AnyEntity | undefined> };
    const existing = await table.get(row.id);

    return existing !== undefined && existing.updatedAt > row.updatedAt;
  }
}
