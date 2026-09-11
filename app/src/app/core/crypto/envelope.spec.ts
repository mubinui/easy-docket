import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_MAGIC,
  EnvelopeFormatError,
  EnvelopeHeader,
  IV_LENGTH,
  parseEnvelope,
  serialiseEnvelope,
} from './envelope';

const header: EnvelopeHeader = { v: 'vault-1', d: 'device-1', h: '0001-0000-device-1', t: 'ops' };
const iv = new Uint8Array(IV_LENGTH).fill(9);
const payload = new Uint8Array([1, 2, 3, 4, 5]);

describe('envelope', () => {
  it('round-trips header, iv and payload', () => {
    const parsed = parseEnvelope(serialiseEnvelope(header, iv, payload));
    expect(parsed.header).toEqual(header);
    expect(parsed.iv).toEqual(iv);
    expect(parsed.payload).toEqual(payload);
  });

  it('marks the bytes with a recognisable magic so a stray file is not mistaken for a vault', () => {
    const bytes = serialiseEnvelope(header, iv, payload);
    expect(bytes.slice(0, 4)).toEqual(ENVELOPE_MAGIC);
    expect(bytes[4]).toBe(1);
  });

  it('reports the header bytes verbatim as the authenticated data', () => {
    const parsed = parseEnvelope(serialiseEnvelope(header, iv, payload));
    expect(new TextDecoder().decode(parsed.aad)).toBe(JSON.stringify(header));
  });

  it('rejects foreign or truncated input', () => {
    expect(() => parseEnvelope(new Uint8Array(4))).toThrow(EnvelopeFormatError);
    expect(() => parseEnvelope(new Uint8Array(64))).toThrow(/Not an Easy Docket envelope/);

    const bytes = serialiseEnvelope(header, iv, payload);
    expect(() => parseEnvelope(bytes.slice(0, 24))).toThrow(/truncated inside header/);
  });

  it('rejects a version or algorithm it cannot safely interpret', () => {
    const future = serialiseEnvelope(header, iv, payload);
    future[4] = 2;
    expect(() => parseEnvelope(future)).toThrow(/Unsupported envelope version 2/);

    const otherAlg = serialiseEnvelope(header, iv, payload);
    otherAlg[5] = 7;
    expect(() => parseEnvelope(otherAlg)).toThrow(/Unsupported algorithm 7/);
  });

  it('refuses an IV of the wrong length instead of producing an unreadable blob', () => {
    expect(() => serialiseEnvelope(header, new Uint8Array(8), payload)).toThrow(
      /IV must be 12 bytes/,
    );
  });
});
