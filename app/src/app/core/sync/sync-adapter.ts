/**
 * The contract every sync destination implements.
 *
 * It is deliberately a dumb object store: list names, get bytes, put bytes.
 * Git, S3 and the custom server can all honour that, and keeping the interface
 * this narrow is what lets the sync engine be written once rather than three
 * times. The adapters never see a key and never see plaintext — by the time
 * bytes reach `put` they are already a sealed envelope.
 */
export interface RemoteObject {
  /** Full object name, including the vault prefix. */
  name: string;
  size?: number;
}

export class SyncTransportError extends Error {
  constructor(
    message: string,
    /** True when retrying later might succeed: offline, 5xx, rate limited. */
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

export interface SyncAdapter {
  /** Human-readable description for the settings screen and error messages. */
  readonly description: string;

  /** Object names under a prefix, in ascending lexicographic order. */
  list(prefix: string): Promise<RemoteObject[]>;

  get(name: string): Promise<Uint8Array>;

  put(name: string, bytes: Uint8Array): Promise<void>;

  /**
   * Called once after a batch of `put`s. Object stores do nothing here; the Git
   * adapter uses it to commit and push, so a sync produces one commit rather
   * than one per operation batch.
   */
  flush?(): Promise<void>;

  /** Verify credentials and reachability without writing anything. */
  probe(): Promise<void>;
}
