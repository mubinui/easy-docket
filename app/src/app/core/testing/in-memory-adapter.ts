import { RemoteObject, SyncAdapter, SyncTransportError } from '../sync/sync-adapter';

/**
 * A sync destination backed by a `Map`, standing in for Git, S3 or the server.
 *
 * Because all three real adapters are the same narrow interface, a test against
 * this one exercises the entire sync engine: batching, envelope sealing,
 * idempotent pulls and convergence. What it deliberately does *not* stand in
 * for is transport behaviour, which each adapter tests separately.
 *
 * It doubles as the zero-knowledge oracle: `objects` holds exactly the bytes a
 * real destination would hold, so a test can assert that no plaintext is in there.
 */
export class InMemoryAdapter implements SyncAdapter {
  readonly description = 'In-memory test destination';
  readonly objects = new Map<string, Uint8Array>();

  /** Call counts, so tests can assert a repeated pull downloads nothing. */
  readonly calls = { list: 0, get: 0, put: 0, flush: 0, probe: 0 };

  /** Set to make the next operation fail, simulating a flaky network. */
  failNext: SyncTransportError | null = null;

  constructor(private readonly shared?: Map<string, Uint8Array>) {
    if (shared) this.objects = shared;
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    this.calls.list++;
    this.maybeFail();
    return [...this.objects.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, bytes]) => ({ name, size: bytes.length }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async get(name: string): Promise<Uint8Array> {
    this.calls.get++;
    this.maybeFail();
    const bytes = this.objects.get(name);
    if (!bytes) throw new SyncTransportError(`No such object: ${name}`, false);
    return bytes;
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    this.calls.put++;
    this.maybeFail();
    this.objects.set(name, bytes);
  }

  async flush(): Promise<void> {
    this.calls.flush++;
  }

  async probe(): Promise<void> {
    this.calls.probe++;
    this.maybeFail();
  }

  /** Every byte the destination holds, concatenated, for plaintext assertions. */
  dump(): string {
    let text = '';
    for (const [name, bytes] of this.objects) {
      text += name + new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return text;
  }

  private maybeFail(): void {
    const failure = this.failNext;
    if (failure) {
      this.failNext = null;
      throw failure;
    }
  }
}
