# Git CORS proxy

A Cloudflare Worker that lets the web app sync to GitHub, GitLab or Bitbucket.
Deploying it takes about five minutes and costs nothing on Cloudflare's free
plan. **You only need it for Git sync in a browser** — the Android app, the
Easy Docket sync server and S3 all work without it.

---

## Why it is needed

Not a limitation of this app, and not something the app can work around.

A browser refuses to let a page read a cross-origin response unless the server
says it may, and GitHub's Git endpoints never do:

```console
$ curl -s -D - -o /dev/null -H 'Origin: https://docket.xiidea.net' \
    'https://github.com/git/git.git/info/refs?service=git-upload-pack' \
  | grep -iE '^HTTP/|access-control'
HTTP/2 200
```

A `200`, and not one `Access-Control-*` header. The response arrives and the
browser discards it.

A **private** repository is worse. It needs an `Authorization` header, which
makes the request "non-simple", so the browser first asks permission with a
preflight:

```console
$ curl -s -D - -o /dev/null -X OPTIONS \
    -H 'Origin: https://docket.xiidea.net' \
    -H 'Access-Control-Request-Method: GET' \
    -H 'Access-Control-Request-Headers: authorization' \
    'https://github.com/you/vault.git/info/refs?service=git-upload-pack' \
  | grep -iE '^HTTP/|allow'
HTTP/2 405
allow: GET
```

The preflight is refused, so the authenticated request is never sent at all.
This is why the app reports a Git failure that looks like an authentication
problem when it is not one.

A proxy sits between the two: it answers the preflight, makes the request from a
server (where CORS does not apply), and returns the response with the headers a
browser needs.

---

## What the proxy can see

Worth understanding before you pick where to run it.

| | Visible to the proxy |
|---|---|
| Your ledger | **No.** Encrypted in the browser before it is sent; the proxy relays ciphertext |
| Your passphrase or keys | **No.** They never leave the device |
| Your repository URL | Yes |
| **Your Git access token** | **Yes** — it travels in an `Authorization` header, in the clear |

The token is the reason to run your own rather than use a public proxy. A token
scoped to one private repository is a small thing to lose, but it is not
nothing: it can read and rewrite that repository.

This worker stores nothing and logs nothing. Cloudflare can still see traffic
through it, as any host can.

---

## Deploy it

### 1. Prerequisites

- A Cloudflare account (the free plan is enough)
- Node.js 20 or newer

### 2. Configure

Edit `cors-proxy/wrangler.toml`:

```toml
name = "easy-docket-cors-proxy"
main = "src/worker.js"
compatibility_date = "2026-09-01"

[vars]
ALLOWED_ORIGINS = "https://docket.xiidea.net"
ALLOWED_HOSTS = "github.com"
```

| Variable | Meaning |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to use the proxy. Empty means any origin. Set it to your app's origin |
| `ALLOWED_HOSTS` | Comma-separated Git hosts it will forward to. Subdomains of a listed host are included. **Unset means nothing is forwarded** |

`ALLOWED_HOSTS` fails closed deliberately: a proxy that forwards anywhere is an
open relay on your account, and it will be found and used.

If you use the app from more than one place — the deployed site and
`http://localhost:4200` while developing — list both:

```toml
ALLOWED_ORIGINS = "https://docket.xiidea.net,http://localhost:4200"
```

### 3. Deploy

```console
$ cd cors-proxy
$ npm install
$ npx wrangler login      # opens a browser once
$ npm run deploy
```

Wrangler prints the URL it deployed to:

```
https://easy-docket-cors-proxy.<your-subdomain>.workers.dev
```

That URL is what goes in the app.

### 4. Check it before trusting it

Answering the preflight is the whole job, so test that first:

```console
$ curl -s -D - -o /dev/null -X OPTIONS \
    -H 'Origin: https://docket.xiidea.net' \
    -H 'Access-Control-Request-Headers: authorization' \
    'https://<your-worker>/github.com/you/vault.git/info/refs?service=git-upload-pack' \
  | grep -iE '^HTTP/|access-control'
HTTP/2 204
access-control-allow-origin: https://docket.xiidea.net
access-control-allow-headers: authorization
access-control-allow-methods: GET, POST, OPTIONS
```

Then a real request, against any public repository:

```console
$ curl -s 'https://<your-worker>/github.com/git/git.git/info/refs?service=git-upload-pack' \
    -H 'Origin: https://docket.xiidea.net' | head -c 40
001e# service=git-upload-pack
```

And confirm it refuses what it should:

```console
$ curl -s -o /dev/null -w '%{http_code}\n' \
    'https://<your-worker>/evil.example/x.git/info/refs?service=git-upload-pack'
403
```

### 5. Point the app at it

**Settings → Destination → Git repository**

| Field | Value |
|---|---|
| HTTPS clone URL | `https://github.com/you/docket-vault.git` |
| Branch | `main` |
| Username | anything — GitHub ignores it when a token is used |
| Access token | a GitHub personal access token (below) |
| CORS proxy | `https://easy-docket-cors-proxy.<your-subdomain>.workers.dev` |

Then **Test connection**. It authenticates without writing, so a mistake shows
up here rather than as a silent background failure days later.

#### The access token

Fine-grained token (preferred), on that one repository:

- **Contents: Read and write**

Classic token:

- **`repo`** scope

An empty repository is fine — the first sync initialises it.

---

## Optional: a custom domain

A `workers.dev` URL works. If you would rather use your own domain, and it is on
Cloudflare:

```toml
routes = [
  { pattern = "git-proxy.example.com", custom_domain = true }
]
```

Then `npm run deploy` again.

---

## Operating it

**Logs.** `npm run tail` streams live requests. Nothing is logged persistently.

**Cost.** The free plan allows 100,000 requests a day. A sync is a handful of
requests, so ordinary use is nowhere near it.

**Updating.** `git pull` and `npm run deploy`.

**Removing it.** `npx wrangler delete`. Sync stops working in the browser until
you clear the CORS proxy field or point it elsewhere; nothing in the vault is
affected.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| "A browser cannot reach github.com directly…" | No CORS proxy is set in the app. That message is the app recognising this exact situation |
| `403` and "This proxy does not forward to github.com" | `ALLOWED_HOSTS` does not list the host. Unset means nothing is forwarded |
| `403` and "Origin … is not allowed" | `ALLOWED_ORIGINS` does not list the app's origin. Include the scheme and any port |
| `400` and "Expected a URL of the form…" | Something other than the app called the worker, or the CORS proxy field has a trailing path. It should be a bare origin |
| `401` from GitHub | Now a genuine credential problem: wrong token, expired, or missing Contents write |
| "Only Git smart-HTTP endpoints are forwarded" | Working as intended — this proxy is not a general-purpose one |

---

## How it works

`isomorphic-git` rewrites a repository URL by stripping the scheme and putting
the proxy in front:

```
https://github.com/you/vault.git/info/refs?service=git-upload-pack
    ↓
https://<worker>/github.com/you/vault.git/info/refs?service=git-upload-pack
```

The worker reads the first path segment as the upstream host, rebuilds the URL,
and forwards it. It is about 200 lines with no dependencies, in
`cors-proxy/src/worker.js`, and deliberately narrow:

- only `GET` and `POST`, the only methods Git's smart-HTTP protocol uses;
- only the four Git endpoints — `info/refs` for `git-upload-pack` and
  `git-receive-pack`, and the two services themselves. Fetching a file from a
  repository through it is refused;
- only hosts on your allowlist, **including after a redirect** — otherwise the
  allowlist would be advisory, since anyone who can make an allowed host
  redirect could borrow the worker to reach anywhere;
- a fixed list of request headers is forwarded, so a cookie is never passed on;
- upstream is always HTTPS.

`cors-proxy/test/worker.test.js` covers all of that, including the refusals.
Run it with `npm test`.

---

## Alternatives

Nothing to deploy, if these suit you better:

| Instead of a proxy | Trade-off |
|---|---|
| The **Android app** | A WebView is not subject to CORS, so leave the proxy field empty. Nothing else changes |
| The **Easy Docket sync server** | Purpose-built, sends its own CORS headers, one container — see [DEPLOYMENT.md](DEPLOYMENT.md) |
| **S3** (or R2, B2, MinIO) | Configure CORS on the bucket; no middleman sees your credentials |
