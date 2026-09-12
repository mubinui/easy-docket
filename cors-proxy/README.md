# Git CORS proxy

A Cloudflare Worker that lets the Easy Docket **web app** sync to GitHub, GitLab
or Bitbucket. Those hosts send no CORS headers on their Git endpoints and refuse
the preflight an authenticated request needs, so a browser cannot reach them
directly. This proxy answers the preflight and forwards the request.

You do not need it for the Android app, the sync server, or S3.

```console
$ npm install
$ npx wrangler login
$ npm run deploy
```

Then put the deployed URL in **Settings → Destination → CORS proxy**.

Configure `ALLOWED_ORIGINS` and `ALLOWED_HOSTS` in `wrangler.toml` first —
`ALLOWED_HOSTS` is empty by default and forwards nothing until you set it, so a
fresh deploy is never an open relay.

**It sees your Git access token.** The ledger itself is encrypted before it
leaves the browser, but the credential is not. That is the reason to run your
own rather than use a public proxy.

Full instructions, including what to verify after deploying:
**[docs/CORS_PROXY.md](../docs/CORS_PROXY.md)**

```console
$ npm test      # 25 tests, no network
```
