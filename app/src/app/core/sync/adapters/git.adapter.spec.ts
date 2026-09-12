import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitTarget } from '../sync-target';
import { SyncTransportError } from '../sync-adapter';
import { GitAdapter } from './git.adapter';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativePlatform },
}));

let nativePlatform = false;

function target(overrides: Partial<GitTarget> = {}): GitTarget {
  return {
    kind: 'git',
    repoUrl: 'https://github.com/someone/docket-vault.git',
    branch: 'main',
    token: 'secret',
    username: 'someone',
    corsProxy: '',
    authorName: 'Docket',
    authorEmail: 'docket@example.com',
    ...overrides,
  } as GitTarget;
}

/** Reach the private error mapper the way every operation does. */
function errorFor(t: GitTarget, cause: unknown): SyncTransportError {
  const adapter = new GitAdapter(t) as unknown as {
    transportError(cause: unknown): SyncTransportError;
  };
  return adapter.transportError(cause);
}

describe('GitAdapter error reporting', () => {
  beforeEach(() => {
    nativePlatform = false;
  });

  describe('when no CORS proxy is configured', () => {
    it('explains why a public host is unreachable from a browser', () => {
      const error = errorFor(target(), new Error('HTTP Error: 401 Unauthorized'));

      // The raw status sends people hunting for a token problem they do not have.
      expect(error.message).toContain('github.com');
      expect(error.message).toContain('CORS');
      expect(error.message).toContain('cors.isomorphic-git.org');
      // The real failure is still there for anyone who needs it.
      expect(error.message).toContain('401 Unauthorized');
    });

    it('names the host that was actually configured', () => {
      const error = errorFor(
        target({ repoUrl: 'https://gitlab.com/someone/vault.git' }),
        new Error('boom'),
      );

      expect(error.message).toContain('gitlab.com');
      expect(error.message).not.toContain('github.com');
    });

    it('says nothing about CORS for a host on this machine', () => {
      // The test suite reaches a local git http-backend that sends its own
      // headers, and a self-hosted server may too.
      for (const host of ['localhost', '127.0.0.1']) {
        const error = errorFor(
          target({ repoUrl: `http://${host}:7005/vault.git` }),
          new Error('boom'),
        );
        expect(error.message).toBe('Git operation failed: boom');
      }
    });

    it('says nothing when the URL is not a URL at all', () => {
      const error = errorFor(target({ repoUrl: 'not a url' }), new Error('boom'));
      expect(error.message).toBe('Git operation failed: boom');
    });
  });

  it('says nothing about CORS once a proxy is set', () => {
    const error = errorFor(
      target({ corsProxy: 'https://cors.isomorphic-git.org' }),
      new Error('HTTP Error: 401 Unauthorized'),
    );

    expect(error.message).toBe('Git operation failed: HTTP Error: 401 Unauthorized');
  });

  it('says nothing about CORS on Android, where requests are not subject to it', () => {
    nativePlatform = true;
    const error = errorFor(target(), new Error('boom'));
    expect(error.message).toBe('Git operation failed: boom');
  });

  describe('retryability is unchanged', () => {
    it('treats a server error as worth retrying', () => {
      const cause = Object.assign(new Error('bad gateway'), { data: { statusCode: 502 } });
      expect(errorFor(target(), cause).retryable).toBe(true);
    });

    it('treats a rejected token as not worth retrying', () => {
      const cause = Object.assign(new Error('unauthorized'), { data: { statusCode: 401 } });
      expect(errorFor(target(), cause).retryable).toBe(false);
    });
  });
});
