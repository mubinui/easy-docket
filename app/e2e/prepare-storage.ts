import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Prepares the sync server's storage.
 *
 * Called while the Playwright config is being loaded rather than from
 * `globalSetup`, because Playwright starts the `webServer` processes first and
 * the server refuses to boot without a tokens file — correctly, since a server
 * that accepted nobody would be worse than one that will not start.
 *
 * The token is fixed rather than minted by `docket-sync token`, so a spec can
 * type it into the app without a round trip through stdout. Only its hash
 * reaches disk, which is the same path a real deployment takes.
 */
export function prepareStorage(dataDir: string, token: string): void {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(`${dataDir}/objects`, { recursive: true });

  const hash = createHash('sha256').update(token).digest('hex');
  writeFileSync(
    `${dataDir}/tokens`,
    `# Generated for the end-to-end suite; not a real credential.\ne2e:${hash}\n`,
  );
}
