import { Injectable } from '@angular/core';
import { SyncAdapter } from './sync-adapter';
import { SyncTarget } from './sync-target';

export class NoSyncTargetError extends Error {
  constructor() {
    super('No sync destination is configured');
    this.name = 'NoSyncTargetError';
  }
}

/**
 * Turns a stored configuration into a live adapter.
 *
 * Each adapter is loaded on demand. The S3 client and the Git implementation
 * are large — together they are most of what the app could possibly download —
 * and a user who syncs to their own server, or not at all, should never pay for
 * either. Dynamic imports mean the bundler emits them as separate chunks that
 * are fetched the first time that destination is actually used.
 *
 * It is also the seam that lets the sync engine be tested against an in-memory
 * destination without constructing any real transport.
 */
@Injectable({ providedIn: 'root' })
export class AdapterFactory {
  async create(target: SyncTarget): Promise<SyncAdapter> {
    switch (target.kind) {
      case 'server': {
        const { ServerAdapter } = await import('./adapters/server.adapter');
        return new ServerAdapter(target);
      }
      case 's3': {
        const { S3Adapter } = await import('./adapters/s3.adapter');
        return new S3Adapter(target);
      }
      case 'git': {
        const { GitAdapter } = await import('./adapters/git.adapter');
        return new GitAdapter(target);
      }
      case 'none':
        throw new NoSyncTargetError();
    }
  }
}
