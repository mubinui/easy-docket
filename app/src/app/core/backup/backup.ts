import { ENTITY_NAMES, EntityName } from '../models/domain';

/**
 * The shape of a backup file.
 *
 * A backup is a snapshot of every entity, not a copy of the operation log. The
 * log is how devices reconcile with each other; a backup answers a different
 * question — "what did this ledger look like at this moment" — and shipping
 * years of superseded operations to answer it would make the file far larger
 * than the ledger it holds.
 *
 * Restoring therefore replays the snapshot as fresh operations on the restoring
 * device, which is what lets a restored vault carry on syncing normally.
 */
export const BACKUP_FORMAT = 1;

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  /** When the backup was taken, for the restore screen to show. */
  takenAt: number;
  /** The vault the backup came from; a restore into another vault is refused. */
  vaultId: string;
  /** Every entity, keyed by name. */
  entities: Partial<Record<EntityName, unknown[]>>;
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/** Total rows across every entity, for the restore confirmation. */
export function countRows(payload: BackupPayload): number {
  return Object.values(payload.entities).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
}

/**
 * Check a decrypted payload before anything is written.
 *
 * Decryption already proves the file came from a holder of this vault's key, so
 * this is about shape rather than trust: a file from a newer build, or one
 * whose contents are not what they claim, should be refused with an explanation
 * rather than half-applied.
 */
export function validateBackup(value: unknown): BackupPayload {
  if (typeof value !== 'object' || value === null) {
    throw new BackupFormatError('That file does not contain a backup');
  }

  const payload = value as Partial<BackupPayload>;

  if (payload.format !== BACKUP_FORMAT) {
    throw new BackupFormatError(
      payload.format === undefined
        ? 'That file does not contain a backup'
        : `This backup was written by a newer version of Easy Docket (format ${payload.format})`,
    );
  }
  if (typeof payload.vaultId !== 'string' || payload.vaultId === '') {
    throw new BackupFormatError('The backup does not say which vault it came from');
  }
  if (typeof payload.entities !== 'object' || payload.entities === null) {
    throw new BackupFormatError('The backup contains no entities');
  }

  for (const [name, rows] of Object.entries(payload.entities)) {
    if (!ENTITY_NAMES.includes(name as EntityName)) {
      // An unknown entity means a build that knew about something this one does
      // not. Restoring the rest would silently drop it.
      throw new BackupFormatError(`The backup contains unknown data ("${name}")`);
    }
    if (!Array.isArray(rows)) {
      throw new BackupFormatError(`The backup's "${name}" section is malformed`);
    }
  }

  return {
    format: BACKUP_FORMAT,
    takenAt: typeof payload.takenAt === 'number' ? payload.takenAt : 0,
    vaultId: payload.vaultId,
    entities: payload.entities,
  };
}

/** A filename that sorts chronologically. */
export function backupFilename(takenAt = Date.now()): string {
  const stamp = new Date(takenAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `easy-docket-backup-${stamp}.edk`;
}
