# Security model

## What is promised

Easy Docket is end-to-end encrypted with a key that only your devices hold.
Every sync destination — the bundled server, an S3 bucket, a Git host, and any
CORS proxy in between — receives ciphertext it cannot decrypt.

Stated precisely: **an attacker with complete control of a sync destination, and
a full copy of everything stored there, learns nothing about your finances.**

## What is not promised

Honesty about the edges matters more than a longer list of claims.

| Exposure | Why |
| --- | --- |
| **Metadata** | A destination sees object names (`vaults/<random-uuid>/ops/<timestamp>-<counter>-<device>.edk`), sizes and upload times. That reveals *when* you use the app and roughly how much you record, though not what. |
| **Number of devices** | Device ids appear in object names. They are random, and a reinstall gets a new one. |
| **A compromised device** | The threat model does not extend to an attacker with code execution on an unlocked device. Nothing client-side can. |
| **A stolen S3 or Git credential** | Cannot read your data, but can delete it. Scope keys to one bucket or repository. |
| **Backup responsibility** | Lose the passphrase and the data is unrecoverable. That is the cost of the guarantee, not a bug. |

## Crypto protocol

### Keys

| Key | Derivation | Lifetime |
| --- | --- | --- |
| **Master key (MK)** | 256 bits from the platform CSPRNG, once per vault | Forever; the only key that reads ledger data |
| **Key-encryption key (KEK)** | PBKDF2-HMAC-SHA256, 650,000 iterations, 16-byte random salt | Derived on demand, never stored |

The MK is wrapped under the KEK and the wrapped form is persisted. Changing the
passphrase re-wraps the MK, so it is instant no matter how much history exists,
and data already synced stays readable.

**Why PBKDF2 and not Argon2id.** Argon2id is the better KDF, and if this were
server-side code it would be the choice. Client-side the calculus differs:
PBKDF2 is native to WebCrypto on every target — browser, Android WebView and
the Node test runner — with no WASM payload to ship, no fallback path to test
and no risk of a polyfill running the derivation in ordinary JavaScript where
timing is unpredictable. 650,000 iterations exceeds the OWASP 2023 floor for
SHA-256. The iteration count is recorded in each wrapped-key record, so it can
be raised later without invalidating existing vaults.

### Payloads

AES-256-GCM. A fresh 96-bit random IV per message — never reused with a key,
which is the one thing GCM cannot survive. The envelope header is passed as
additional authenticated data, so it cannot be tampered with even though it is
readable.

Key wrapping uses a separate AAD domain separator (`easy-docket/wrap/v1`), so a
wrapped key can never be replayed as a payload or vice versa.

### The envelope

Every byte handed to a destination is one of these:

```
 0   magic      4   "EDCK"
 4   version    1   1
 5   algorithm  1   1 = AES-256-GCM
 6   headerLen  2   big-endian
 8   iv        12   random per message
20   header     …   UTF-8 JSON, authenticated but NOT encrypted
 …   payload    …   ciphertext ‖ 16-byte GCM tag
```

Self-describing on purpose: a destination may be a Git repository cloned years
later on a different device, so the ciphertext must carry what is needed to
authenticate it.

The header is the only plaintext, and it is restricted to four fields — vault
id, device id, HLC stamp, payload type. All four are random or mechanical.
Nothing financial may ever go in it, and
`sync.service.spec.ts` asserts exactly that key set.

## Key storage

This is where platforms genuinely differ, and the app says so rather than
implying a uniform guarantee.

### Android

The master key is held by `capacitor-secure-storage-plugin`, which stores it in
an `EncryptedSharedPreferences` file whose encryption key lives in the
hardware-backed Android Keystore. The key material does not leave the keystore.
The vault therefore survives an app restart without a passphrase prompt.

### Web (PWA)

**The master key is never persisted in a browser.** It is held as a `CryptoKey`
handle for the lifetime of the tab, and the user unlocks with their passphrase
each session.

This is a deliberate refusal rather than a missing feature. `localStorage`,
`sessionStorage` and IndexedDB are all readable by any script running on the
origin, so a key placed in any of them is exposed to a future XSS — and a
"session passphrase" scheme that stores the derived key alongside its own salt
merely moves the problem one indirection along. There is no browser primitive
that holds a secret against script on its own origin, so the app asks for the
passphrase instead of pretending.

What *is* persisted on the web is the wrapped key, which is inert without the
passphrase, and `CryptoKey` handles are opaque references into the browser's
crypto implementation rather than byte arrays sitting in the JavaScript heap.

`VaultService.keyIsDurable` exposes the difference, and both the unlock screen
and the security settings page explain it in the user's own terms.

### Locking

`lock()` drops the in-memory key and evicts it from the keystore, so a stolen
device cannot resume. `destroy()` additionally erases the wrapped key and vault
identity.

## Credentials are treated as secrets too

A sync target holds a GitHub token or an S3 secret key. Those are encrypted
under the master key before they touch disk, exactly like ledger data
(`SyncSettingsService`). The natural consequence — sync cannot run while the
vault is locked — is correct anyway: a locked vault has no key to encrypt
outgoing data with either.

`redactTarget()` exists so that no code path can log a target in the clear.

## Server posture

The Go server is built so the zero-knowledge claim is *checkable* rather than
merely asserted. There is no code path in `internal/storage` that could decrypt
anything, because the package deals only in names and bytes.

- **Bearer tokens**, stored as SHA-256 hashes and compared in constant time.
  Tokens are high-entropy values issued by the operator, not user-chosen
  passwords, so a password KDF would add cost without adding security.
- **Account isolation** enforced at the path level, with a second check that the
  resolved path is inside the account root even though name validation already
  rejects traversal.
- **Strict name validation** — `vaults/<vault>/ops/<stamp>.edk` and nothing
  else. That single regex removes path traversal, absolute paths, control
  characters, and clients using the vault as general-purpose storage.
- **Immutable objects.** Re-uploading identical bytes succeeds (a retry after a
  crash must be safe); different bytes under an existing name return 409.
- **Atomic writes** — write to a temp file, `fsync`, then rename. A power cut
  cannot leave a correctly named file with truncated contents, which would be
  worse than no file at all.
- **Quotas** per account, and a per-object size cap.
- **CORS off by default.** Browser origins must be named explicitly in
  `DOCKET_ALLOWED_ORIGINS`. A cross-origin page could never read the
  ciphertext, but it should not get to spend the user's token either.
- **No TLS of its own.** Run it behind a reverse proxy that terminates TLS.

## How the main claim was checked

Beyond the unit and integration suites, the pipeline was run end to end: the
built PWA in a real browser, creating a vault, recording a transaction for
"Dr Mehta Clinic" against an account named "Joint Current Account", and syncing
to the Go server over HTTP.

The file that reached the server's disk:

```
00000000: 4544 434b 0101 006d c2b8 d43b b506 5ba4  EDCK...m...;..[.
00000010: 3db9 234e 7b22 7622 3a22 6362 6561 3638  =.#N{"v":"cbea68
          … {"v":"<vault-uuid>","d":"RbWKuTdf","h":"…","t":"ops"} …
00000080: 7df4 c866 209d eb34 3508 901c 4473 ffea  }..f ..45...Ds..
```

The only readable bytes are the magic, the version, the algorithm and the four
header fields. Searching the object for `Dr Mehta Clinic`, `Joint Current
Account`, `consultation`, the amounts, and even the entity names `transactions`
and `accounts` returns nothing.

## Reporting a vulnerability

Open a security advisory on the repository rather than a public issue.
