import FS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { RemoteObject, SyncAdapter, SyncTransportError } from '../sync-adapter';
import { GitTarget } from '../sync-target';

/**
 * Adapter that treats a Git repository as the sync destination.
 *
 * This is the option people ask for most often, because it gives a versioned,
 * self-owned history of the vault in a place they already back up. Three things
 * about it are worth knowing:
 *
 *  1. The working copy lives in an IndexedDB-backed filesystem, so the clone
 *     survives restarts and a sync only has to fetch what changed.
 *  2. A sync produces exactly one commit. `put` stages files; `flush` commits
 *     and pushes. Otherwise a busy week would produce hundreds of commits.
 *  3. On the web a CORS proxy is unavoidable for hosts like GitHub, which serve
 *     no CORS headers. Inside the Android WebView requests are not subject to
 *     CORS and the proxy can be left blank. The proxy only ever sees encrypted
 *     envelopes, never a key — but it does see the repository URL and token, so
 *     it should be one you run yourself for anything sensitive.
 */
const REPO_DIR = '/vault';

export class GitAdapter implements SyncAdapter {
  readonly description: string;
  private readonly fs: FS;
  private readonly staged = new Set<string>();
  private ready: Promise<void> | null = null;

  constructor(
    private readonly target: GitTarget,
    fs?: FS,
  ) {
    this.description = `Git repository ${target.repoUrl} (${target.branch})`;
    this.fs = fs ?? new FS('easy-docket-git');
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    await this.sync();
    const dir = `${REPO_DIR}/${prefix}`.replace(/\/+$/, '');
    let names: string[];
    try {
      names = await this.fs.promises.readdir(dir);
    } catch {
      // A vault that has never been pushed has no directory yet.
      return [];
    }
    return names
      .filter((name) => !name.startsWith('.'))
      .map((name) => ({ name: `${prefix}${name}` }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async get(name: string): Promise<Uint8Array> {
    await this.ensureClone();
    const data = await this.fs.promises.readFile(`${REPO_DIR}/${name}`);
    return typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    await this.ensureClone();
    await this.mkdirp(`${REPO_DIR}/${name}`.replace(/\/[^/]+$/, ''));
    await this.fs.promises.writeFile(`${REPO_DIR}/${name}`, bytes);
    await this.run(() => git.add({ fs: this.fs, dir: REPO_DIR, filepath: name }));
    this.staged.add(name);
  }

  async remove(name: string): Promise<void> {
    await this.ensureClone();
    const path = `${REPO_DIR}/${name}`;

    try {
      await this.fs.promises.unlink(path);
    } catch (error) {
      // Already gone: nothing to stage, and nothing to complain about.
      if ((error as { code?: string }).code === 'ENOENT') return;
      throw error;
    }

    await this.run(() => git.remove({ fs: this.fs, dir: REPO_DIR, filepath: name }));
    this.staged.add(name);
  }

  /** Commit everything staged since the last flush and push it upstream. */
  async flush(): Promise<void> {
    if (this.staged.size === 0) return;
    const count = this.staged.size;

    await this.run(async () => {
      await git.commit({
        fs: this.fs,
        dir: REPO_DIR,
        message: `Easy Docket: sync ${count} object${count === 1 ? '' : 's'}`,
        author: {
          name: this.target.authorName || 'Easy Docket',
          email: this.target.authorEmail || 'docket@localhost',
        },
      });
      await git.push({
        fs: this.fs,
        http,
        dir: REPO_DIR,
        remote: 'origin',
        ref: this.target.branch,
        corsProxy: this.target.corsProxy || undefined,
        onAuth: () => this.auth(),
      });
    });

    this.staged.clear();
  }

  async probe(): Promise<void> {
    await this.run(() =>
      git.getRemoteInfo({
        http,
        url: this.target.repoUrl,
        corsProxy: this.target.corsProxy || undefined,
        onAuth: () => this.auth(),
      }),
    );
  }

  /** Fetch and fast-forward, so a listing reflects what other devices pushed. */
  private async sync(): Promise<void> {
    await this.ensureClone();
    await this.run(() =>
      git.fastForward({
        fs: this.fs,
        http,
        dir: REPO_DIR,
        ref: this.target.branch,
        singleBranch: true,
        corsProxy: this.target.corsProxy || undefined,
        onAuth: () => this.auth(),
      }),
    );
  }

  /**
   * Clone once, then reuse. Guarded by a memoised promise so two syncs racing
   * at startup cannot both try to clone into the same directory.
   */
  private ensureClone(): Promise<void> {
    return (this.ready ??= this.cloneOrInit().catch((error) => {
      this.ready = null; // Let the next attempt retry rather than caching failure.
      throw error;
    }));
  }

  private async cloneOrInit(): Promise<void> {
    const alreadyCloned = await this.fs.promises
      .stat(`${REPO_DIR}/.git`)
      .then(() => true)
      .catch(() => false);
    if (alreadyCloned) return;

    await this.mkdirp(REPO_DIR);
    await this.run(() =>
      git.clone({
        fs: this.fs,
        http,
        dir: REPO_DIR,
        url: this.target.repoUrl,
        ref: this.target.branch,
        singleBranch: true,
        // The vault is append-only, so old history is never read. A shallow
        // clone keeps a multi-year vault from costing a full download on a new
        // device, but keeps enough for a valid push.
        depth: 1,
        corsProxy: this.target.corsProxy || undefined,
        onAuth: () => this.auth(),
      }),
    );
  }

  private auth(): { username: string; password: string } {
    return {
      username: this.target.username || 'docket',
      password: this.target.token,
    };
  }

  /** LightningFS has no recursive mkdir. */
  private async mkdirp(path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      try {
        await this.fs.promises.mkdir(current);
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
      }
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      const error = cause as Error & { code?: string; data?: { statusCode?: number } };
      const status = error.data?.statusCode;
      const retryable =
        status === undefined || status >= 500 || status === 429 || error.code === 'HttpError';
      throw new SyncTransportError(`Git operation failed: ${error.message}`, retryable, cause);
    }
  }
}
