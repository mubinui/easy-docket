import { describe, expect, it, vi } from 'vitest';
import { SyncTransportError } from '../sync-adapter';
import { ServerTarget } from '../sync-target';
import { ServerAdapter } from './server.adapter';

const target: ServerTarget = {
  kind: 'server',
  label: 'Home NAS',
  endpoint: 'https://docket.example.com',
  token: 'secret-token',
};

const OBJECT = 'vaults/8f2a1c64/ops/0000001700000000000-0000-aaaaaaaa.edk';

/** Builds a fetch stub that records its calls and returns scripted responses. */
function stubFetch(...responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const impl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return responses[Math.min(index++, responses.length - 1)];
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('ServerAdapter', () => {
  it('sends the bearer token on every request', async () => {
    const { impl, calls } = stubFetch(jsonResponse({ objects: [] }));
    await new ServerAdapter(target, impl).list('vaults/');

    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer secret-token',
    );
  });

  it('keeps path separators in object names intact', async () => {
    const { impl, calls } = stubFetch(new Response(new Uint8Array([1, 2, 3])));
    await new ServerAdapter(target, impl).get(OBJECT);

    expect(calls[0].url).toBe(`https://docket.example.com/v1/objects/${OBJECT}`);
    expect(calls[0].url).not.toContain('%2F');
  });

  it('preserves a sub-path in the configured endpoint', async () => {
    const { impl, calls } = stubFetch(new Response(new Uint8Array()));
    const nested: ServerTarget = { ...target, endpoint: 'https://example.com/docket/' };
    await new ServerAdapter(nested, impl).get(OBJECT);

    expect(calls[0].url).toBe(`https://example.com/docket/v1/objects/${OBJECT}`);
  });

  it('uploads raw bytes', async () => {
    const { impl, calls } = stubFetch(jsonResponse({ name: OBJECT }, 201));
    const payload = new Uint8Array([0x45, 0x44, 0x43, 0x4b]);
    await new ServerAdapter(target, impl).put(OBJECT, payload);

    expect(calls[0].init.method).toBe('PUT');
    expect(new Uint8Array(calls[0].init.body as ArrayBuffer)).toEqual(payload);
  });

  it('follows the listing cursor to the end', async () => {
    const { impl, calls } = stubFetch(
      jsonResponse({ objects: [{ name: 'b' }], nextCursor: 'b' }),
      jsonResponse({ objects: [{ name: 'a' }] }),
    );

    const objects = await new ServerAdapter(target, impl).list('vaults/');

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('cursor=b');
    // Pages arrive in whatever order the server returns; the adapter sorts.
    expect(objects.map((o) => o.name)).toEqual(['a', 'b']);
  });

  it('treats a network failure as retryable, because the device is probably offline', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(new ServerAdapter(target, impl).probe()).rejects.toMatchObject({
      name: 'SyncTransportError',
      retryable: true,
    });
  });

  it('classifies server errors by status', async () => {
    const cases: Array<[number, boolean]> = [
      [401, false],
      [404, false],
      [409, false],
      [429, true],
      [500, true],
      [503, true],
    ];

    for (const [status, retryable] of cases) {
      const { impl } = stubFetch(jsonResponse({ error: 'nope' }, status));
      const error = await new ServerAdapter(target, impl)
        .get(OBJECT)
        .catch((e: unknown) => e as SyncTransportError);

      expect(error).toBeInstanceOf(SyncTransportError);
      expect((error as SyncTransportError).retryable, `status ${status}`).toBe(retryable);
    }
  });
});
