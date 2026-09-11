import { AnyEntity, EntityName } from './domain';

/**
 * Easy Docket replicates state as an append-only log of operations rather than
 * by shipping whole database snapshots. An operation is small, immutable and
 * content-addressed by its hybrid logical clock, which means two devices can
 * exchange logs in any order, any number of times, and converge on the same
 * ledger (last-writer-wins per field-set, ties broken by device id).
 */
export type OpKind = 'put' | 'delete';

export interface Operation {
  /** Hybrid logical clock stamp; lexicographically sortable and globally unique. */
  hlc: string;
  entity: EntityName;
  entityId: string;
  op: OpKind;
  /** Full entity snapshot for `put`, absent for `delete`. */
  value?: AnyEntity;
  /** Device that authored the operation. */
  device: string;
}

/** Local bookkeeping around an operation: has it been pushed to the remote yet? */
export interface LocalOperation extends Operation {
  synced: 0 | 1;
}

/** A batch of operations, which is the unit actually encrypted and uploaded. */
export interface OperationBatch {
  vaultId: string;
  device: string;
  /** HLC of the newest operation in the batch; used as the remote object name. */
  head: string;
  ops: Operation[];
}
