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

## Deploy it, step by step

Ten steps, about five minutes. Every command is run from the `cors-proxy`
directory unless it says otherwise, and each one shows what you should see, so
you can tell a working step from a step that only looked like it worked.

### Step 1 — Check what you need

```console
$ node --version
v22.22.3
```

Node 20 or newer. You also need a Cloudflare account; the free plan is enough,
and you can create one during step 6 if you do not have one yet.

### Step 2 — Get the code and open the right directory

```console
$ git clone https://github.com/xiidea/easy-docket.git
$ cd easy-docket/cors-proxy
```

Already have the repository? Just `cd easy-docket/cors-proxy`.

### Step 3 — Install

```console
$ npm install

added 80 packages, and audited 81 packages in 4s
found 0 vulnerabilities
```

This installs Wrangler — Cloudflare's deployment tool — and the test runner.
The worker itself has no dependencies.

### Step 4 — Run the tests

Before deploying anything, confirm the code you are about to put on the internet
behaves:

```console
$ npm test

 Test Files  1 passed (1)
      Tests  25 passed (25)
```

Most of those tests are about what the proxy **refuses** to do.

### Step 5 — Decide your configuration

Open `wrangler.toml`. There are three things you may want to change, and the
defaults are fine for GitHub:

| Setting | Default | Change it when |
|---|---|---|
| `name` | `easy-docket-cors-proxy` | You want a different URL |
| `ALLOWED_HOSTS` | `github.com` | Your repository is on GitLab, Bitbucket or your own server |
| `ALLOWED_ORIGINS` | *(empty — any origin)* | You want only your app to be able to use the proxy |

**If your repository is on GitHub, change nothing and go to step 6.**

Otherwise, edit the values. They are comma-separated:

```toml
ALLOWED_HOSTS = "gitlab.com,git.example.com"
ALLOWED_ORIGINS = "https://docket.xiidea.net,http://localhost:4200"
```

An origin is the scheme, host and port — `https://docket.xiidea.net`, with no
path and no trailing slash. If you use the app from a phone *and* a laptop,
that is still one origin: the site's address, not the device's.

> **Why `ALLOWED_HOSTS` cannot be left empty.** An empty list forwards nothing.
> A proxy that will reach any host is an open relay running on your account and
> your quota, and open relays get found.

### Step 6 — Sign in to Cloudflare

```console
$ npm run login
```

A browser opens and asks you to authorise Wrangler. If you do not have an
account yet, create one on that page — it is free and takes a minute — then
authorise. The terminal confirms when it has worked.

Then check which account you are about to deploy into, which matters if you
have more than one:

```console
$ npm run whoami
```

It prints the email and account the token belongs to. Before you log in it
fails instead, with `Not logged in.` — so this is also how you tell whether
step 6 worked.

<details>
<summary>Deploying from a server or CI, without a browser</summary>

Create an API token in the Cloudflare dashboard with the **Edit Cloudflare
Workers** template, then:

```console
$ export CLOUDFLARE_API_TOKEN=your-token
$ export CLOUDFLARE_ACCOUNT_ID=your-account-id
$ npm run deploy
```

Wrangler uses those instead of the browser login.
</details>

### Step 7 — Check before you upload

```console
$ npm run check

Total Upload: 6.59 KiB / gzip: 2.31 KiB
Your Worker has access to the following bindings:
Binding                                 Resource
env.ALLOWED_HOSTS ("github.com")        Environment Variable
env.ALLOWED_ORIGINS ("")                Environment Variable

--dry-run: exiting now.
```

This compiles and validates without uploading. **Read the two bindings** — they
are the settings your proxy will actually run with. If they are not what you
intended, go back to step 5.

### Step 8 — Deploy

```console
$ npm run deploy
```

Wrangler uploads the worker and finishes by printing the URL it is now served
from, of the form:

```
https://easy-docket-cors-proxy.<your-subdomain>.workers.dev
```

`<your-subdomain>` is assigned to your Cloudflare account; the first part is the
`name` from `wrangler.toml`.

**That URL is what goes in the app.** Copy it.

Lost it later? It is in the Cloudflare dashboard under **Workers & Pages**, or
run `npm run deploy` again and it prints it.

### Step 9 — Verify the deployment

Three checks. Replace `<your-worker>` with the URL from step 8.

**a. It answers the preflight** — the thing GitHub refuses, and the reason this
proxy exists:

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

**b. It forwards a real Git request** — any public repository will do, so you
can test this before involving your own token:

```console
$ curl -s 'https://<your-worker>/github.com/git/git.git/info/refs?service=git-upload-pack' \
    -H 'Origin: https://docket.xiidea.net' | head -c 40

001e# service=git-upload-pack
```

**c. It refuses what it should.** A proxy that forwards anywhere is the failure
mode worth checking for:

```console
$ curl -s -o /dev/null -w '%{http_code}\n' \
    'https://<your-worker>/evil.example/x.git/info/refs?service=git-upload-pack'

403
```

If (a) and (b) work and (c) prints `403`, the proxy is correct.

### Step 10 — Point the app at it

In Easy Docket: **Settings → Destination → Git repository**

| Field | Value |
|---|---|
| HTTPS clone URL | `https://github.com/you/docket-vault.git` |
| Branch | `main` |
| Username | anything — GitHub ignores it when a token is used |
| Access token | a GitHub personal access token (below) |
| CORS proxy | the URL from step 8 |

Press **Test connection**. It authenticates without writing, so a mistake shows
up here rather than as a silent background failure days later. Then **Save**, and
sync once to confirm a commit lands in the repository.

#### The access token

Fine-grained token (preferred), scoped to that one repository:

- **Contents: Read and write**

Classic token:

- **`repo`** scope

An empty repository is fine — the first sync initialises it.

---

## Changing the configuration later

**Edit and redeploy** — the version in `wrangler.toml` stays the record of what
is running:

```console
$ npm run deploy
```

**Or override for a single deploy**, without editing the file:

```console
$ npx wrangler deploy \
    --var ALLOWED_HOSTS:gitlab.com \
    --var ALLOWED_ORIGINS:https://docket.xiidea.net
```

**Or from the dashboard**, with no terminal at all: **Workers & Pages → your
worker → Settings → Variables and Secrets**. Edit and deploy there. Note that
the next `npm run deploy` will overwrite dashboard edits with whatever is in
`wrangler.toml`, so keep the two in step.

Deploying a second, separate proxy — one for work, one for personal — needs no
second copy of the code:

```console
$ npx wrangler deploy --name docket-proxy-work --var ALLOWED_HOSTS:git.work.example
```

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
| `npm run login` never finishes | The browser did not reach Cloudflare. Run `npx wrangler login` directly — it prints a URL you can open by hand |
| `Not logged in.` | Step 6 did not complete. Run `npm run login` again, then `npm run whoami` |
| `npm run deploy` asks you to select an account | You are a member of more than one. Pick the one you want, or set `CLOUDFLARE_ACCOUNT_ID` |
| The app still says "A browser cannot reach github.com directly…" | The CORS proxy field is empty or was not saved. That message is the app recognising this exact situation |
| `403` — "This proxy does not forward to github.com" | `ALLOWED_HOSTS` does not list the host. Check step 5, then redeploy — the value in `npm run check` is the one that counts |
| `403` — "Origin … is not allowed" | `ALLOWED_ORIGINS` does not list your app's origin. Include the scheme and any port, with no trailing slash |
| `400` — "Expected a URL of the form…" | The CORS proxy field has a path or trailing slash on it. It should be the bare URL from step 8 |
| `401` from GitHub | A genuine credential problem now: the token is wrong, expired, or lacks Contents write |
| "Only Git smart-HTTP endpoints are forwarded" | Working as intended — this proxy is not a general-purpose one |
| Sync works on Android but not in the browser | Expected if no proxy is configured. Android needs none |

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
