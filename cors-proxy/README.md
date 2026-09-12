# Git CORS proxy

A Cloudflare Worker that lets the Easy Docket **web app** sync to GitHub, GitLab
or Bitbucket. Those hosts send no CORS headers on their Git endpoints and refuse
the preflight an authenticated request needs, so a browser cannot reach them
directly. This proxy answers the preflight and forwards the request.

You do not need it for the Android app, the sync server, or S3.

## Deploy

```console
$ npm install
$ npm test           # 25 tests, no network
$ npm run login      # opens a browser, once
$ npm run check      # compiles and shows the settings, without uploading
$ npm run deploy     # prints the URL to paste into the app
```

Then put that URL in **Settings → Destination → CORS proxy**.

**Step-by-step, with what to expect at each step and how to verify the result:
[docs/CORS_PROXY.md](../docs/CORS_PROXY.md).**

## Configure

Everything is in `wrangler.toml`. The defaults deploy a working proxy for
GitHub; change them for anything else.

| Setting | Default | Meaning |
|---|---|---|
| `name` | `easy-docket-cors-proxy` | Becomes part of the URL |
| `ALLOWED_HOSTS` | `github.com` | Git hosts it will forward to. **Empty forwards nothing** |
| `ALLOWED_ORIGINS` | *(empty)* | Origins allowed to use it. Empty means any |

Override for one deploy without editing the file:

```console
$ npx wrangler deploy --var ALLOWED_HOSTS:gitlab.com --name my-proxy
```

Or change them afterwards in the Cloudflare dashboard, under
**Workers & Pages → your worker → Settings → Variables and Secrets**.

## What it can see

The ledger is encrypted in the browser before it is sent, so the proxy relays
ciphertext. **Your Git access token is not encrypted** — it travels in an
`Authorization` header, and this worker handles it. That is the argument for
running your own rather than using a public proxy.

Nothing is logged or stored here. `npm run tail` streams live requests while you
watch.
