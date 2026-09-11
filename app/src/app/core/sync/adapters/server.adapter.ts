import { RemoteObject, SyncAdapter, SyncTransportError } from '../sync-adapter';
import { ServerTarget } from '../sync-target';

/**
 * Adapter for the bundled Go sync server.
 *
 * This is the simplest of the three because the server was designed against
 * this interface: it is an append-only, authenticated blob store that knows
 * nothing about what the blobs contain.
 */
export class ServerAdapter implements SyncAdapter {
  readonly description: string;

  constructor(
    private readonly target: ServerTarget,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.description = `Sync server at ${target.endpoint}`;
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const objects: RemoteObject[] = [];
    let cursor: string | undefined;

    // The server pages its listing so a vault with years of history does not
    // arrive as one enormous response.
    do {
      const url = this.url('v1/objects');
      url.searchParams.set('prefix', prefix);
      if (cursor) url.searchParams.set('cursor', cursor);

      const body = (await this.request(url, { method: 'GET' }).then((r) => r.json())) as {
        objects: RemoteObject[];
        nextCursor?: string;
      };
      objects.push(...body.objects);
      cursor = body.nextCursor;
    } while (cursor);

    return objects.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async get(name: string): Promise<Uint8Array> {
    const response = await this.request(this.objectUrl(name), { method: 'GET' });
    return new Uint8Array(await response.arrayBuffer());
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    await this.request(this.objectUrl(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      // Copy into a standalone buffer: a view over a pooled buffer would send
      // whatever else happens to share it.
      body: bytes.slice().buffer as ArrayBuffer,
    });
  }

  /**
   * Check reachability *and* credentials.
   *
   * Two requests rather than one, because they fail for different reasons and
   * the user needs to be told which. `/v1/health` is deliberately
   * unauthenticated — it exists for load balancers — so probing it alone would
   * report "connected successfully" for a mistyped token and leave the real
   * failure to surface later as a silent background sync error. The listing
   * request is read-only and writes nothing.
   */
  async probe(): Promise<void> {
    await this.request(this.url('v1/health'), { method: 'GET' });

    const objects = this.url('v1/objects');
    objects.searchParams.set('prefix', 'vaults/');
    objects.searchParams.set('limit', '1');
    await this.request(objects, { method: 'GET' });
  }

  /**
   * Object names are hierarchical (`vaults/<id>/ops/<stamp>.edk`) and the server
   * routes on the path, so the separators must survive. Each segment is encoded
   * individually rather than the name as a whole, which would turn every `/`
   * into `%2F` and leave the request pointing at a single, non-existent segment.
   */
  private objectUrl(name: string): URL {
    const encoded = name.split('/').map(encodeURIComponent).join('/');
    return this.url(`v1/objects/${encoded}`);
  }

  /**
   * Relative to the configured endpoint, so a server mounted under a sub-path
   * (`https://example.com/docket/`) keeps that prefix.
   */
  private url(path: string): URL {
    return new URL(path, this.target.endpoint.replace(/\/+$/, '') + '/');
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.target.token}` },
      });
    } catch (cause) {
      // A network-level failure is always worth retrying: the device is most
      // likely just offline, which is the normal state for this app.
      throw new SyncTransportError(`Cannot reach ${this.target.endpoint}`, true, cause);
    }

    if (!response.ok) {
      throw new SyncTransportError(
        `Sync server returned ${response.status} ${response.statusText}`,
        response.status >= 500 || response.status === 429,
      );
    }
    return response;
  }
}
