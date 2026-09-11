import { describe, expect, it } from 'vitest';
import { CryptoService, DecryptionError, fromBase64, toBase64 } from './crypto.service';
import { EnvelopeHeader, parseEnvelope } from './envelope';

/**
 * PBKDF2 at production strength takes ~0.5s per derivation, which would make
 * this suite unpleasant. Wrapping is exercised at a low iteration count and the
 * production constant is asserted separately.
 */
const FAST_ITERATIONS = 1_000;

const header: EnvelopeHeader = { v: 'vault-1', d: 'device-1', h: '0001-0000-device-1', t: 'ops' };

function service() {
  return new CryptoService();
}

describe('CryptoService', () => {
  it('generates 256-bit master keys', async () => {
    const svc = service();
    const key = await svc.generateMasterKey();
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(await svc.exportMasterKey(key)).toHaveLength(32);
  });

  it('produces a different key every time', async () => {
    const svc = service();
    const a = toBase64(await svc.exportMasterKey(await svc.generateMasterKey()));
    const b = toBase64(await svc.exportMasterKey(await svc.generateMasterKey()));
    expect(a).not.toBe(b);
  });

  it('round-trips a JSON payload through seal/open', async () => {
    const svc = service();
    const key = await svc.generateMasterKey();
    const value = { ops: [{ entity: 'transactions', amount: 1250 }] };

    const sealed = await svc.sealJson(key, header, value);
    const opened = await svc.openJson<typeof value>(key, sealed);

    expect(opened.value).toEqual(value);
    expect(opened.header).toEqual(header);
  });

  it('never leaves plaintext in the sealed bytes', async () => {
    const svc = service();
    const key = await svc.generateMasterKey();
    const sealed = await svc.sealJson(key, header, { payee: 'Rent', amount: 120000 });
    const asText = new TextDecoder().decode(sealed);

    expect(asText).not.toContain('Rent');
    expect(asText).not.toContain('120000');
    // The header is visible by design; assert it carries nothing financial.
    expect(parseEnvelope(sealed).header).toEqual(header);
  });

  it('uses a fresh IV for every message', async () => {
    const svc = service();
    const key = await svc.generateMasterKey();
    const first = parseEnvelope(await svc.sealJson(key, header, { a: 1 }));
    const second = parseEnvelope(await svc.sealJson(key, header, { a: 1 }));

    expect(toBase64(first.iv)).not.toBe(toBase64(second.iv));
    expect(toBase64(first.payload)).not.toBe(toBase64(second.payload));
  });

  it('fails closed when the wrong key is used', async () => {
    const svc = service();
    const sealed = await svc.sealJson(await svc.generateMasterKey(), header, { a: 1 });
    await expect(svc.openJson(await svc.generateMasterKey(), sealed)).rejects.toThrow(
      DecryptionError,
    );
  });

  it('detects tampering with the ciphertext', async () => {
    const svc = service();
    const key = await svc.generateMasterKey();
    const sealed = await svc.sealJson(key, header, { amount: 100 });
    sealed[sealed.length - 1] ^= 0xff;
    await expect(svc.openJson(key, sealed)).rejects.toThrow(DecryptionError);
  });

  it('detects tampering with the authenticated header', async () => {
    const svc = service();
    const key = await svc.generateMasterKey();
    const sealed = await svc.sealJson(key, header, { amount: 100 });

    // Rewrite the device id in place: same length, so only the AAD changes.
    const text = new TextDecoder().decode(sealed.slice(20, 20 + JSON.stringify(header).length));
    const forged = new TextEncoder().encode(text.replace('device-1', 'device-9'));
    sealed.set(forged, 20);

    await expect(svc.openJson(key, sealed)).rejects.toThrow(DecryptionError);
  });

  describe('passphrase wrapping', () => {
    it('recovers the master key with the right passphrase', async () => {
      const svc = service();
      const master = await svc.generateMasterKey();
      const wrapped = await svc.wrapMasterKey(master, 'correct horse battery', FAST_ITERATIONS);
      const recovered = await svc.unwrapMasterKey(wrapped, 'correct horse battery');

      expect(await svc.exportMasterKey(recovered)).toEqual(await svc.exportMasterKey(master));
    });

    it('rejects the wrong passphrase without revealing anything', async () => {
      const svc = service();
      const wrapped = await svc.wrapMasterKey(
        await svc.generateMasterKey(),
        'correct horse battery',
        FAST_ITERATIONS,
      );
      await expect(svc.unwrapMasterKey(wrapped, 'correct horse batter')).rejects.toThrow(
        /Incorrect passphrase/,
      );
    });

    it('stores no plaintext key material in the wrapped record', async () => {
      const svc = service();
      const master = await svc.generateMasterKey();
      const raw = toBase64(await svc.exportMasterKey(master));
      const wrapped = await svc.wrapMasterKey(master, 'pass', FAST_ITERATIONS);

      expect(JSON.stringify(wrapped)).not.toContain(raw);
      expect(fromBase64(wrapped.salt)).toHaveLength(16);
      expect(fromBase64(wrapped.iv)).toHaveLength(12);
      // 32-byte key plus the 16-byte GCM tag.
      expect(fromBase64(wrapped.key)).toHaveLength(48);
    });

    it('salts every wrap, so the same passphrase yields different records', async () => {
      const svc = service();
      const master = await svc.generateMasterKey();
      const a = await svc.wrapMasterKey(master, 'pass', FAST_ITERATIONS);
      const b = await svc.wrapMasterKey(master, 'pass', FAST_ITERATIONS);
      expect(a.salt).not.toBe(b.salt);
      expect(a.key).not.toBe(b.key);
    });

    it('normalises the passphrase so equivalent Unicode spellings still unlock', async () => {
      const svc = service();
      const master = await svc.generateMasterKey();
      // "é" as a single code point vs. "e" + combining acute.
      const wrapped = await svc.wrapMasterKey(master, 'café', FAST_ITERATIONS);
      const recovered = await svc.unwrapMasterKey(wrapped, 'café');
      expect(await svc.exportMasterKey(recovered)).toEqual(await svc.exportMasterKey(master));
    });

    it('refuses a wrapped record it does not understand', async () => {
      const svc = service();
      const wrapped = await svc.wrapMasterKey(await svc.generateMasterKey(), 'p', FAST_ITERATIONS);
      await expect(
        svc.unwrapMasterKey({ ...wrapped, kdf: 'scrypt' as never }, 'p'),
      ).rejects.toThrow(/Unsupported wrapped-key format/);
    });
  });

  it('keeps the production KDF cost above the OWASP floor', async () => {
    const { PBKDF2_ITERATIONS } = await import('./crypto.service');
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });
});
