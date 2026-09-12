import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker.js';

const ENV = {
  ALLOWED_ORIGINS: 'https://docket.xiidea.net',
  ALLOWED_HOSTS: 'github.com',
};

const ORIGIN = 'https://docket.xiidea.net';
const REFS = 'https://proxy.example/github.com/you/vault.git/info/refs?service=git-upload-pack';
const UPLOAD_PACK = 'https://proxy.example/github.com/you/vault.git/git-upload-pack';

/** Calls made to the upstream, so a test can assert what was forwarded. */
let upstream;

function stubUpstream(responder) {
  vi.stubGlobal('fetch', async (url, init) => {
    upstream.push({ url: String(url), init });
    return responder(String(url), init);
  });
}

function ok(body = 'refs', headers = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-git-upload-pack-advertisement', ...headers },
  });
}

function get(url = REFS, headers = {}) {
  return new Request(url, { method: 'GET', headers: { Origin: ORIGIN, ...headers } });
}

beforeEach(() => {
  upstream = [];
  stubUpstream(() => ok());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the preflight GitHub refuses', () => {
  it('is answered, which is the whole point of the proxy', async () => {
    const response = await worker.fetch(
      new Request(REFS, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      }),
      ENV,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    // Without this the browser never sends the authenticated request at all.
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('echoes whatever headers were asked for', async () => {
    const response = await worker.fetch(
      new Request(REFS, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Headers': 'authorization, git-protocol, content-type',
        },
      }),
      ENV,
    );

    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'authorization, git-protocol, content-type',
    );
  });

  it('is refused for an origin that is not allowed', async () => {
    const response = await worker.fetch(
      new Request(REFS, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
      ENV,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('never reaches the upstream', async () => {
    await worker.fetch(new Request(REFS, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), ENV);
    expect(upstream).toEqual([]);
  });
});

describe('forwarding a fetch', () => {
  it('rebuilds the upstream URL from the path, query and all', async () => {
    await worker.fetch(get(), ENV);

    expect(upstream[0].url).toBe(
      'https://github.com/you/vault.git/info/refs?service=git-upload-pack',
    );
    expect(upstream[0].init.method).toBe('GET');
  });

  it('carries the credential through', async () => {
    // The token is what makes a private repository reachable, and the header it
    // travels in is the one that triggers the preflight.
    await worker.fetch(get(REFS, { Authorization: 'Basic dXNlcjp0b2tlbg==' }), ENV);

    expect(upstream[0].init.headers.get('authorization')).toBe('Basic dXNlcjp0b2tlbg==');
  });

  it('carries the protocol-version header Git negotiates with', async () => {
    await worker.fetch(get(REFS, { 'Git-Protocol': 'version=2' }), ENV);
    expect(upstream[0].init.headers.get('git-protocol')).toBe('version=2');
  });

  it('does not forward a cookie', async () => {
    // Nothing in Git needs one, and a proxy that passes cookies is a proxy that
    // can be used to reach someone's logged-in session.
    await worker.fetch(get(REFS, { Cookie: 'session=secret' }), ENV);
    expect(upstream[0].init.headers.get('cookie')).toBeNull();
  });

  it('lets the browser read the response', async () => {
    const response = await worker.fetch(get(), ENV);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    // `content-type` is how a Git client tells a packfile from an error page.
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('content-type');
    expect(await response.text()).toBe('refs');
  });

  it('varies on Origin, so a cache cannot serve one origin another\'s headers', async () => {
    const response = await worker.fetch(get(), ENV);
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('passes a 401 back rather than swallowing it', async () => {
    // isomorphic-git retries with credentials when it sees a 401; turning that
    // into an error would break authentication entirely.
    stubUpstream(() => new Response('no', { status: 401 }));

    const response = await worker.fetch(get(), ENV);
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('forwards a push', async () => {
    const response = await worker.fetch(
      new Request(UPLOAD_PACK.replace('git-upload-pack', 'git-receive-pack'), {
        method: 'POST',
        headers: { Origin: ORIGIN, 'content-type': 'application/x-git-receive-pack-request' },
        body: 'packfile',
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(upstream[0].url).toBe('https://github.com/you/vault.git/git-receive-pack');
    expect(upstream[0].init.headers.get('content-type')).toBe(
      'application/x-git-receive-pack-request',
    );
  });
});

describe('what it refuses to be', () => {
  it('does not forward to a host that was not allowed', async () => {
    const response = await worker.fetch(
      get('https://proxy.example/evil.example/repo.git/info/refs?service=git-upload-pack'),
      ENV,
    );

    expect(response.status).toBe(403);
    expect(upstream).toEqual([]);
  });

  it('forwards nothing at all when no hosts are configured', async () => {
    // A fresh deploy must not be an open relay.
    const response = await worker.fetch(get(), { ALLOWED_ORIGINS: ORIGIN });

    expect(response.status).toBe(403);
    expect(upstream).toEqual([]);
  });

  it('allows a subdomain of an allowed host', async () => {
    const response = await worker.fetch(
      get('https://proxy.example/www.github.com/you/vault.git/info/refs?service=git-upload-pack'),
      ENV,
    );

    expect(response.status).toBe(200);
  });

  it('does not treat a lookalike host as allowed', async () => {
    // `notgithub.com` ends with the allowed string but is a different host.
    const response = await worker.fetch(
      get('https://proxy.example/notgithub.com/x.git/info/refs?service=git-upload-pack'),
      ENV,
    );

    expect(response.status).toBe(403);
    expect(upstream).toEqual([]);
  });

  it('refuses an origin that is not allowed', async () => {
    const response = await worker.fetch(get(REFS, { Origin: 'https://evil.example' }), ENV);

    expect(response.status).toBe(403);
    expect(upstream).toEqual([]);
  });

  it('serves any origin when none are configured', async () => {
    const response = await worker.fetch(get(), { ALLOWED_HOSTS: 'github.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('refuses anything that is not a Git endpoint', async () => {
    for (const path of [
      'https://proxy.example/github.com/you/vault.git/raw/main/secrets.txt',
      'https://proxy.example/github.com/',
      'https://proxy.example/github.com/you/vault.git/info/refs?service=evil',
    ]) {
      const response = await worker.fetch(get(path), ENV);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
    expect(upstream).toEqual([]);
  });

  it('explains itself at the root rather than proxying nothing', async () => {
    const response = await worker.fetch(get('https://proxy.example/'), ENV);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('info/refs');
  });

  it('refuses a host smuggled in with a scheme or credentials', async () => {
    for (const path of [
      'https://proxy.example/https://evil.example/x.git/info/refs?service=git-upload-pack',
      'https://proxy.example/user@evil.example/x.git/info/refs?service=git-upload-pack',
      'https://proxy.example/github.com@evil.example/x.git/info/refs?service=git-upload-pack',
    ]) {
      const response = await worker.fetch(get(path), ENV);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
    expect(upstream).toEqual([]);
  });

  it('refuses a method Git never uses', async () => {
    const response = await worker.fetch(
      new Request(REFS, { method: 'DELETE', headers: { Origin: ORIGIN } }),
      ENV,
    );

    expect(response.status).toBe(405);
    expect(upstream).toEqual([]);
  });
});

describe('redirects', () => {
  it('follows a redirect within the allowlist', async () => {
    // A renamed repository is the ordinary case.
    stubUpstream((url) =>
      url.includes('/old.git')
        ? new Response(null, { status: 301, headers: { location: 'https://github.com/you/new.git/info/refs?service=git-upload-pack' } })
        : ok(),
    );

    const response = await worker.fetch(
      get('https://proxy.example/github.com/you/old.git/info/refs?service=git-upload-pack'),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveLength(2);
    expect(response.headers.get('x-redirected-url')).toContain('/new.git/');
  });

  it('refuses to follow a redirect off the allowlist', async () => {
    // Otherwise the allowlist is advisory: anyone who can make an allowed host
    // redirect can borrow this worker to reach anywhere.
    stubUpstream(() =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }),
    );

    const response = await worker.fetch(get(), ENV);
    expect(response.status).toBe(403);
    expect(upstream).toHaveLength(1);
  });

  it('gives up rather than looping forever', async () => {
    stubUpstream((url) =>
      new Response(null, {
        status: 302,
        headers: { location: `https://github.com/you/${url.length}.git/info/refs?service=git-upload-pack` },
      }),
    );

    const response = await worker.fetch(get(), ENV);
    expect(upstream.length).toBeLessThanOrEqual(6);
    expect(response.status).toBe(302);
  });
});
