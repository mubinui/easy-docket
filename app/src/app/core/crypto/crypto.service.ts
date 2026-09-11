import { Injectable } from '@angular/core';
import {
  EnvelopeHeader,
  IV_LENGTH,
  parseEnvelope,
  serialiseEnvelope,
} from './envelope';

/**
 * All cryptography in Easy Docket goes through this service. It knows about
 * keys and bytes only; it has no idea what a transaction is, and nothing above
 * it ever touches `SubtleCrypto` directly.
 *
 * Protocol summary
 * ----------------
 *  - Master key (MK): 256-bit AES-GCM key, generated once per vault from the
 *    platform CSPRNG. It is the only key that can read ledger data.
 *  - Key-encryption key (KEK): derived from the user's passphrase with
 *    PBKDF2-HMAC-SHA256. The MK is wrapped under the KEK, so changing the
 *    passphrase re-wraps the MK instead of re-encrypting the whole ledger.
 *  - Payloads: AES-256-GCM with a fresh 96-bit random IV per message and the
 *    envelope header bound in as additional authenticated data.
 *
 * PBKDF2 is used rather than Argon2id because it is available natively in
 * WebCrypto on every target (browser, Android WebView, Node test runner) with
 * no WASM payload. The iteration count is well above the OWASP 2023 floor of
 * 600k for SHA-256 and is recorded per vault so it can be raised later without
 * invalidating existing wrapped keys.
 */
export const PBKDF2_ITERATIONS = 650_000;
export const SALT_LENGTH = 16;
export const MASTER_KEY_BITS = 256;

/** AAD domain separator for key wrapping, so a wrap can never be replayed as a payload. */
const WRAP_AAD = new TextEncoder().encode('easy-docket/wrap/v1');

/** A wrapped master key is safe to persist anywhere; it is useless without the passphrase. */
export interface WrappedMasterKey {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64, ciphertext + GCM tag */
  key: string;
}

export class DecryptionError extends Error {
  constructor(message = 'Unable to decrypt: wrong key or corrupted data') {
    super(message);
    this.name = 'DecryptionError';
  }
}

@Injectable({ providedIn: 'root' })
export class CryptoService {
  /**
   * Resolved lazily rather than captured at construction: under the Angular
   * test runner the global is installed by the test setup file, and on older
   * Android WebViews `crypto.subtle` is only present on a secure origin, where
   * we want a clear error instead of a cryptic `undefined is not a function`.
   */
  private get subtle(): SubtleCrypto {
    const api = globalThis.crypto?.subtle;
    if (!api) {
      throw new Error(
        'WebCrypto is unavailable. Easy Docket must be served over HTTPS or localhost.',
      );
    }
    return api;
  }

  randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  /** Generate a fresh, non-extractable-by-default master key for a new vault. */
  async generateMasterKey(): Promise<CryptoKey> {
    return this.subtle.generateKey({ name: 'AES-GCM', length: MASTER_KEY_BITS }, true, [
      'encrypt',
      'decrypt',
    ]);
  }

  async importMasterKey(raw: Uint8Array): Promise<CryptoKey> {
    if (raw.length !== MASTER_KEY_BITS / 8) {
      throw new Error(`Master key must be ${MASTER_KEY_BITS / 8} bytes`);
    }
    return this.subtle.importKey('raw', toBuffer(raw), { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ]);
  }

  async exportMasterKey(key: CryptoKey): Promise<Uint8Array> {
    return new Uint8Array(await this.subtle.exportKey('raw', key));
  }

  /**
   * Stretch a passphrase into a key-encryption key. The derived key is marked
   * non-extractable so that a bug elsewhere in the app cannot read it back out.
   */
  async deriveKek(
    passphrase: string,
    salt: Uint8Array,
    iterations = PBKDF2_ITERATIONS,
  ): Promise<CryptoKey> {
    const material = await this.subtle.importKey(
      'raw',
      toBuffer(new TextEncoder().encode(passphrase.normalize('NFKC'))),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return this.subtle.deriveKey(
      { name: 'PBKDF2', salt: toBuffer(salt), iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: MASTER_KEY_BITS },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async wrapMasterKey(
    masterKey: CryptoKey,
    passphrase: string,
    iterations = PBKDF2_ITERATIONS,
  ): Promise<WrappedMasterKey> {
    const salt = this.randomBytes(SALT_LENGTH);
    const iv = this.randomBytes(IV_LENGTH);
    const kek = await this.deriveKek(passphrase, salt, iterations);
    const raw = await this.exportMasterKey(masterKey);
    const wrapped = await this.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(WRAP_AAD) },
      kek,
      toBuffer(raw),
    );
    raw.fill(0);
    return {
      version: 1,
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      key: toBase64(new Uint8Array(wrapped)),
    };
  }

  async unwrapMasterKey(wrapped: WrappedMasterKey, passphrase: string): Promise<CryptoKey> {
    if (wrapped.version !== 1 || wrapped.kdf !== 'PBKDF2-SHA256') {
      throw new Error('Unsupported wrapped-key format');
    }
    const kek = await this.deriveKek(passphrase, fromBase64(wrapped.salt), wrapped.iterations);
    let raw: ArrayBuffer;
    try {
      raw = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toBuffer(fromBase64(wrapped.iv)),
          additionalData: toBuffer(WRAP_AAD),
        },
        kek,
        toBuffer(fromBase64(wrapped.key)),
      );
    } catch {
      throw new DecryptionError('Incorrect passphrase');
    }
    return this.importMasterKey(new Uint8Array(raw));
  }

  /** Encrypt an arbitrary JSON payload into a self-describing envelope. */
  async sealJson(key: CryptoKey, header: EnvelopeHeader, value: unknown): Promise<Uint8Array> {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    return this.seal(key, header, plaintext);
  }

  async seal(key: CryptoKey, header: EnvelopeHeader, plaintext: Uint8Array): Promise<Uint8Array> {
    const iv = this.randomBytes(IV_LENGTH);
    // The header must be serialised exactly once: the bytes fed to GCM as
    // additional data have to be byte-identical to the bytes written out.
    const aad = new TextEncoder().encode(JSON.stringify(header));
    const ciphertext = await this.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(aad) },
      key,
      toBuffer(plaintext),
    );
    return serialiseEnvelope(header, iv, new Uint8Array(ciphertext));
  }

  async openJson<T>(key: CryptoKey, bytes: Uint8Array): Promise<{ header: EnvelopeHeader; value: T }> {
    const { header, plaintext } = await this.open(key, bytes);
    return { header, value: JSON.parse(new TextDecoder().decode(plaintext)) as T };
  }

  async open(
    key: CryptoKey,
    bytes: Uint8Array,
  ): Promise<{ header: EnvelopeHeader; plaintext: Uint8Array }> {
    const envelope = parseEnvelope(bytes);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toBuffer(envelope.iv),
          additionalData: toBuffer(envelope.aad),
        },
        key,
        toBuffer(envelope.payload),
      );
    } catch {
      throw new DecryptionError();
    }
    return { header: envelope.header, plaintext: new Uint8Array(plaintext) };
  }
}

/**
 * `Uint8Array` is generic over its buffer type in TypeScript 5.7+, and
 * `SubtleCrypto` insists on a plain `ArrayBuffer`. Copying into a fresh buffer
 * keeps the call sites readable and avoids leaking a view over a larger pool.
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
