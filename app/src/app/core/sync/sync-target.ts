/**
 * Configuration for the place a vault replicates to.
 *
 * Credentials live in these records, which is why the settings layer encrypts
 * the whole `SyncTarget` under the master key before it ever touches disk — a
 * GitHub token or an S3 secret key deserves the same protection as the ledger.
 */
export type SyncTargetKind = 'none' | 'server' | 's3' | 'git';

export interface BaseTarget {
  kind: SyncTargetKind;
  /** User-facing label, e.g. "Home NAS". */
  label: string;
}

export interface NoneTarget extends BaseTarget {
  kind: 'none';
}

/** The self-hosted Go sync server. */
export interface ServerTarget extends BaseTarget {
  kind: 'server';
  /** Base URL, e.g. `https://docket.example.com`. */
  endpoint: string;
  /** Bearer token issued by the server operator. */
  token: string;
}

/** Any S3-compatible object store: AWS, Cloudflare R2, MinIO, Backblaze B2. */
export interface S3Target extends BaseTarget {
  kind: 's3';
  bucket: string;
  region: string;
  /** Custom endpoint for non-AWS providers; blank means AWS. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 and MinIO need path-style addressing. */
  forcePathStyle: boolean;
  /** Optional key prefix so one bucket can host several apps. */
  prefix: string;
}

export interface GitTarget extends BaseTarget {
  kind: 'git';
  /** HTTPS clone URL. SSH is not reachable from a browser. */
  repoUrl: string;
  branch: string;
  /** Personal access token; used as the HTTP password. */
  token: string;
  /** Username expected by the host; GitHub accepts anything when a PAT is used. */
  username: string;
  /**
   * Browsers cannot talk to most Git hosts directly because those hosts send no
   * CORS headers. A proxy such as `https://cors.isomorphic-git.org` (or one you
   * run yourself) is required on the web; on Android the WebView request is not
   * subject to CORS, so this may be left blank.
   */
  corsProxy: string;
  /** Author identity written into commits; purely cosmetic. */
  authorName: string;
  authorEmail: string;
}

export type SyncTarget = NoneTarget | ServerTarget | S3Target | GitTarget;

export interface SyncSettings {
  target: SyncTarget;
  /** Minutes between automatic syncs; 0 disables the timer. */
  intervalMinutes: number;
  /** Sync as soon as connectivity returns. */
  syncOnReconnect: boolean;
  /** Only sync when the device reports an unmetered connection. */
  wifiOnly: boolean;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  target: { kind: 'none', label: 'Not configured' },
  intervalMinutes: 15,
  syncOnReconnect: true,
  wifiOnly: false,
};

/** Object layout at every destination, shared by all three adapters. */
export function opsPrefix(vaultId: string): string {
  return `vaults/${vaultId}/ops/`;
}

export function opsObjectName(vaultId: string, head: string): string {
  return `${opsPrefix(vaultId)}${head}.edk`;
}

/**
 * Snapshots live beside the operations they summarise.
 *
 * A device joining a long-lived vault takes the newest snapshot and only the
 * operations after it, rather than replaying every batch ever written. The
 * operations stay where they are — a snapshot makes the download cheap, not the
 * history disposable.
 */
export function snapshotPrefix(vaultId: string): string {
  return `vaults/${vaultId}/snapshots/`;
}

export function snapshotObjectName(vaultId: string, watermark: string): string {
  return `${snapshotPrefix(vaultId)}${watermark}.edk`;
}

/**
 * The clock stamp an object is named after.
 *
 * Names sort by stamp, so this is how a pull decides which objects a snapshot
 * already covers without downloading them.
 */
export function stampFromObjectName(name: string): string | null {
  const match = /\/([0-9]{19}-[0-9a-f]{4}-[A-Za-z0-9]+)\.edk$/.exec(name);
  return match ? match[1] : null;
}

/**
 * Redact a target for logging or diagnostics. Nothing in the app should ever
 * print a `SyncTarget` without going through this.
 */
export function redactTarget(target: SyncTarget): Record<string, unknown> {
  switch (target.kind) {
    case 'server':
      return { kind: target.kind, endpoint: target.endpoint, token: mask(target.token) };
    case 's3':
      return {
        kind: target.kind,
        bucket: target.bucket,
        region: target.region,
        endpoint: target.endpoint,
        accessKeyId: mask(target.accessKeyId),
        secretAccessKey: mask(target.secretAccessKey),
      };
    case 'git':
      return {
        kind: target.kind,
        repoUrl: target.repoUrl,
        branch: target.branch,
        token: mask(target.token),
      };
    default:
      return { kind: target.kind };
  }
}

function mask(secret: string): string {
  return secret ? `${'*'.repeat(8)}${secret.slice(-4)}` : '';
}
