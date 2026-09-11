/**
 * On-the-wire container for every byte Easy Docket hands to a sync destination.
 *
 * The envelope is deliberately self-describing: a destination may be a Git
 * repository cloned years later on a different device, so the ciphertext has to
 * carry the algorithm, the nonce and the header needed to authenticate it.
 *
 * Layout (all integers big-endian):
 *
 *   0   magic      4  bytes  "EDCK"
 *   4   version    1  byte   currently 1
 *   5   algorithm  1  byte   1 = AES-256-GCM
 *   6   headerLen  2  bytes  length of the UTF-8 JSON header
 *   8   iv        12  bytes  random per message, never reused with a key
 *   20  header     headerLen bytes, authenticated but NOT encrypted
 *   ..  payload    ciphertext followed by the 16-byte GCM tag
 *
 * The header is passed to AES-GCM as additional authenticated data, so it
 * cannot be tampered with, but it is readable by the destination. Nothing
 * financial may ever be placed in it — see `EnvelopeHeader`.
 */

export const ENVELOPE_MAGIC = new Uint8Array([0x45, 0x44, 0x43, 0x4b]); // "EDCK"
export const ENVELOPE_VERSION = 1;
export const ALG_AES_256_GCM = 1;
export const IV_LENGTH = 12;
const HEADER_OFFSET = 20;

/**
 * Metadata a sync destination is allowed to see. Keep this list minimal and
 * non-identifying: the vault id is a random UUID, never an email or user name.
 */
export interface EnvelopeHeader {
  /** Random vault identifier, shared by the devices replicating one ledger. */
  v: string;
  /** Random device identifier that produced this envelope. */
  d: string;
  /** HLC stamp of the newest operation inside; also the remote object name. */
  h: string;
  /** Payload discriminator, e.g. `ops` for an operation batch. */
  t: string;
}

export class EnvelopeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeFormatError';
  }
}

export interface ParsedEnvelope {
  header: EnvelopeHeader;
  iv: Uint8Array;
  payload: Uint8Array;
  /** The exact bytes that were authenticated as additional data. */
  aad: Uint8Array;
}

export function serialiseEnvelope(
  header: EnvelopeHeader,
  iv: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  if (iv.length !== IV_LENGTH) {
    throw new EnvelopeFormatError(`IV must be ${IV_LENGTH} bytes, got ${iv.length}`);
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (headerBytes.length > 0xffff) {
    throw new EnvelopeFormatError('Envelope header exceeds 64 KiB');
  }

  const out = new Uint8Array(HEADER_OFFSET + headerBytes.length + payload.length);
  const view = new DataView(out.buffer);
  out.set(ENVELOPE_MAGIC, 0);
  out[4] = ENVELOPE_VERSION;
  out[5] = ALG_AES_256_GCM;
  view.setUint16(6, headerBytes.length);
  out.set(iv, 8);
  out.set(headerBytes, HEADER_OFFSET);
  out.set(payload, HEADER_OFFSET + headerBytes.length);
  return out;
}

export function parseEnvelope(bytes: Uint8Array): ParsedEnvelope {
  if (bytes.length < HEADER_OFFSET) {
    throw new EnvelopeFormatError('Envelope truncated before header');
  }
  for (let i = 0; i < ENVELOPE_MAGIC.length; i++) {
    if (bytes[i] !== ENVELOPE_MAGIC[i]) {
      throw new EnvelopeFormatError('Not an Easy Docket envelope');
    }
  }
  if (bytes[4] !== ENVELOPE_VERSION) {
    throw new EnvelopeFormatError(`Unsupported envelope version ${bytes[4]}`);
  }
  if (bytes[5] !== ALG_AES_256_GCM) {
    throw new EnvelopeFormatError(`Unsupported algorithm ${bytes[5]}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint16(6);
  const payloadStart = HEADER_OFFSET + headerLen;
  if (bytes.length < payloadStart) {
    throw new EnvelopeFormatError('Envelope truncated inside header');
  }

  const iv = bytes.slice(8, 8 + IV_LENGTH);
  const aad = bytes.slice(HEADER_OFFSET, payloadStart);
  let header: EnvelopeHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(aad)) as EnvelopeHeader;
  } catch {
    throw new EnvelopeFormatError('Envelope header is not valid JSON');
  }

  return { header, iv, payload: bytes.slice(payloadStart), aad };
}
