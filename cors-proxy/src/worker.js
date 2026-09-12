/**
 * A CORS proxy for Git-over-HTTP, as a Cloudflare Worker.
 *
 * Browsers cannot speak Git to GitHub, GitLab or Bitbucket directly. Those
 * hosts send no `Access-Control-Allow-Origin` on their Git endpoints, and a
 * private repository needs an `Authorization` header — which makes the request
 * "non-simple", so the browser sends a CORS preflight first. GitHub answers
 * that preflight with `405 Method Not Allowed`, and the real request is never
 * sent at all.
 *
 * This worker sits in the middle: it answers the preflight, forwards the Git
 * request, and returns the response with the headers a browser needs to read
 * it. `isomorphic-git` addresses it as
 *
 *     https://<worker>/github.com/you/vault.git/info/refs?service=git-upload-pack
 *
 * — the upstream URL with its scheme removed and the proxy prefixed.
 *
 * ## What it is not
 *
 * It is not a general-purpose proxy, and it is deliberately awkward to use as
 * one: only Git's four smart-HTTP endpoints are forwarded, only to hosts on an
 * allowlist you configure, and only for origins you name. An open proxy on your
 * account is someone else's free bandwidth and your abuse report.
 *
 * ## What it can see
 *
 * The vault is encrypted before it leaves the browser, so the bytes passing
 * through are ciphertext. The **credentials are not**: a Git access token
 * travels in the `Authorization` header in the clear, and this worker handles
 * it. That is the whole reason to run your own rather than use a public one.
 * Nothing is logged or stored here, but you are trusting the code and the
 * platform — which is a smaller ask when the account is yours.
 */

/** The only methods Git's smart-HTTP protocol uses. */
const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

/** The only services worth proxying: fetch and push. */
const GIT_SERVICES = ['git-upload-pack', 'git-receive-pack'];

/**
 * Request headers forwarded upstream.
 *
 * An allowlist rather than "everything except": a header nobody considered is
 * more likely to leak something (a cookie, a client hint) than to be needed.
 */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'content-length',
  'content-type',
  'git-protocol',
  'pragma',
  'range',
  'user-agent',
];

/**
 * Response headers a browser is allowed to read.
 *
 * Without `Access-Control-Expose-Headers` a script sees only the handful of
 * safelisted ones, and `content-type` is how a Git client tells a packfile from
 * an HTML error page.
 */
const EXPOSE_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-encoding',
  'content-length',
  'content-language',
  'content-type',
  'date',
  'etag',
  'expires',
  'last-modified',
  'location',
  'pragma',
  'server',
  'transfer-encoding',
  'vary',
  'www-authenticate',
  'x-redirected-url',
];

/** Redirects followed before giving up. Renamed repositories are the common case. */
const MAX_REDIRECTS = 5;

export default {
  /**
   * @param {Request} request
   * @param {{ ALLOWED_ORIGINS?: string, ALLOWED_HOSTS?: string }} env
   */
  async fetch(request, env) {
    const config = readConfig(env);
    const origin = request.headers.get('Origin');
    const allowedOrigin = originAllowed(origin, config.origins) ? origin : null;

    if (request.method === 'OPTIONS') {
      return preflight(request, allowedOrigin);
    }

    if (!ALLOWED_METHODS.includes(request.method)) {
      return problem(405, `Method ${request.method} is not used by Git over HTTP.`, allowedOrigin);
    }

    // An Origin the deployment does not know is refused before anything is
    // forwarded, so a stray page cannot spend this worker's quota.
    if (origin !== null && allowedOrigin === null) {
      return problem(403, `Origin ${origin} is not allowed by this proxy.`, null);
    }

    const target = parseTarget(new URL(request.url));
    if (!target) {
      return problem(
        400,
        'Expected a URL of the form /<host>/<path>/info/refs?service=git-upload-pack, ' +
          '/<host>/<path>/git-upload-pack or /<host>/<path>/git-receive-pack.',
        allowedOrigin,
      );
    }

    if (!hostAllowed(target.hostname, config.hosts)) {
      return problem(403, `This proxy does not forward to ${target.hostname}.`, allowedOrigin);
    }

    if (!isGitRequest(request.method, target)) {
      return problem(403, 'Only Git smart-HTTP endpoints are forwarded.', allowedOrigin);
    }

    return forward(request, target, config, allowedOrigin);
  },
};

/** @param {{ ALLOWED_ORIGINS?: string, ALLOWED_HOSTS?: string }} env */
function readConfig(env) {
  return {
    origins: splitList(env.ALLOWED_ORIGINS),
    hosts: splitList(env.ALLOWED_HOSTS).map((host) => host.toLowerCase()),
  };
}

/** @param {string | undefined} value */
function splitList(value) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Whether this origin may use the proxy.
 *
 * An unset allowlist means "any origin", which is what a proxy on a private
 * worker URL usually wants; naming your app's origin is one line better.
 */
function originAllowed(origin, allowed) {
  if (origin === null) return true;
  if (allowed.length === 0 || allowed.includes('*')) return true;
  return allowed.includes(origin);
}

/**
 * Whether this upstream host may be reached.
 *
 * Unset means nothing is forwarded. Failing closed here is the difference
 * between a proxy for your vault and an open relay with your name on it.
 */
function hostAllowed(hostname, allowed) {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Read `/<host>/<path…>` into the upstream URL it stands for.
 *
 * Returns null for anything that is not shaped like a proxied URL, including
 * the bare root, so a browser hitting the worker directly gets an explanation
 * rather than a fetch to nowhere.
 */
function parseTarget(url) {
  const path = url.pathname.replace(/^\/+/, '');
  if (!path) return null;

  const slash = path.indexOf('/');
  if (slash <= 0) return null;

  const host = path.slice(0, slash);
  // A host with a scheme, credentials or a port is not what isomorphic-git
  // sends, and each is a way to smuggle a different destination past the
  // allowlist check below.
  if (!/^[a-z0-9.-]+$/i.test(host)) return null;

  try {
    return new URL(`https://${host}/${path.slice(slash + 1)}${url.search}`);
  } catch {
    return null;
  }
}

/** Whether this is one of Git's four smart-HTTP requests. */
function isGitRequest(method, target) {
  if (method === 'GET') {
    if (!target.pathname.endsWith('/info/refs')) return false;
    return GIT_SERVICES.includes(target.searchParams.get('service') ?? '');
  }
  return GIT_SERVICES.some((service) => target.pathname.endsWith(`/${service}`));
}

function preflight(request, allowedOrigin) {
  if (allowedOrigin === null && request.headers.get('Origin') !== null) {
    return new Response(null, { status: 403 });
  }

  const requested = request.headers.get('Access-Control-Request-Headers');
  const headers = new Headers({
    'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
    // Echoed rather than listed: the set a browser asks for varies with the
    // request, and echoing what was asked keeps the preflight from failing over
    // a header this file did not predict. Only the allowlist above is actually
    // forwarded.
    'Access-Control-Allow-Headers': requested ?? FORWARD_REQUEST_HEADERS.join(', '),
    'Access-Control-Max-Age': '86400',
    ...corsHeaders(allowedOrigin),
  });
  return new Response(null, { status: 204, headers });
}

/**
 * Forward the request, following redirects ourselves.
 *
 * `redirect: 'manual'` and an explicit loop, because the allowlist has to hold
 * for every hop: a redirect to a host you did not allow is still a request this
 * worker made on someone's behalf.
 */
async function forward(request, target, config, allowedOrigin) {
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const body = request.method === 'GET' ? undefined : request.body;
  let current = target;
  let response = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await fetch(current.toString(), {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });

    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;

    let next;
    try {
      next = new URL(location, current);
    } catch {
      return problem(502, 'The upstream sent a redirect this proxy could not read.', allowedOrigin);
    }
    if (!hostAllowed(next.hostname, config.hosts)) {
      return problem(403, `The upstream redirected to ${next.hostname}, which is not allowed.`, allowedOrigin);
    }
    // A redirect on a request with a body cannot be replayed: the stream is
    // spent. Git only redirects on the initial GET in practice.
    if (body !== undefined) {
      return problem(502, 'The upstream redirected a request that cannot be replayed.', allowedOrigin);
    }
    current = next;
  }

  const outgoing = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(allowedOrigin))) {
    outgoing.set(name, value);
  }
  outgoing.set('Access-Control-Expose-Headers', EXPOSE_RESPONSE_HEADERS.join(', '));
  if (current.toString() !== target.toString()) {
    outgoing.set('x-redirected-url', current.toString());
  }
  // Set by the platform for the hop we made; re-sending it with a body we are
  // streaming through would be a lie.
  outgoing.delete('content-encoding');

  return new Response(response.body, { status: response.status, headers: outgoing });
}

function corsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin ?? '*',
    Vary: 'Origin',
  };
}

function problem(status, message, allowedOrigin) {
  return new Response(`${message}\n`, {
    status,
    headers: new Headers({ 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(allowedOrigin) }),
  });
}
