import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  addExpense,
  chooseOption,
  createVault,
  fillField,
  goToTab,
  tap,
} from './helpers';

/**
 * The Git adapter against a real Git remote.
 *
 * Everything else about Git sync was unit-tested against a stub, which cannot
 * tell you whether the protocol works — and `git http-backend` is the CGI
 * program every Git host runs, so this exercises the real thing. The server
 * adds CORS headers, which a public host would not; that is what the app's
 * proxy setting is for, and allowing the origin here keeps the test about the
 * adapter rather than somebody's proxy.
 */
const PORT = 9500;
const ROOT = join(tmpdir(), 'docket-git-e2e');
const REPO = join(ROOT, 'vault.git');
const REMOTE = `http://localhost:${PORT}/vault.git`;

let server: Server | undefined;

/** Everything committed to the repository, as paths. */
function filesInRepo(): string[] {
  try {
    return execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', 'main'])
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function blobContents(path: string): string {
  return execFileSync('git', ['-C', REPO, 'show', `main:${path}`]).toString('binary');
}

test.describe('git sync', () => {
  test.beforeAll(async () => {
    try {
      execFileSync('git', ['--version']);
    } catch {
      test.skip(true, 'git is not installed');
    }

    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    execFileSync('git', ['init', '--bare', '--initial-branch=main', REPO]);
    execFileSync('git', ['-C', REPO, 'config', 'http.receivepack', 'true']);

    process.env['GIT_ROOT'] = ROOT;
    process.env['GIT_PORT'] = String(PORT);
    process.env['GIT_ALLOW_ORIGIN'] = 'http://localhost:4599';

    const { startGitServer } = await import('./servers/git-http.mjs');
    server = await startGitServer();
  });

  test.afterAll(() => {
    server?.close();
  });

  test('pushes an encrypted ledger to a repository that starts empty', async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '1000.00');
    await addExpense(page, '45.00', 'Dr Mehta Clinic', 'Health');

    await goToTab(page, 'Settings', Screen.settings);
    await page.locator(Screen.settings).getByRole('heading', { name: 'Destination' }).click();
    await expect(page.getByText('Sync destination')).toBeVisible();

    await chooseOption(page, 'Destination', 'Git repository');
    await fillField(page, 'HTTPS clone URL', REMOTE);
    await fillField(page, 'Branch', 'main');
    await fillField(page, 'Access token', 'not-checked-by-this-server');

    await tap(page, 'Test connection');
    await expect(page.getByText('Connected successfully.')).toBeVisible({ timeout: 20_000 });

    await tap(page, 'Save');

    // The push happens in the background once the settings are saved. Asserting
    // on the status line first means a failure reports what went wrong rather
    // than just timing out waiting for a file.
    await goToTab(page, 'Settings', Screen.settings);
    await expect(async () => {
      const status = await page.locator('ion-content').last().innerText();
      expect(status, `sync status: ${status}`).toMatch(/up to date/);
    }).toPass({ timeout: 30_000 });

    expect(filesInRepo().filter((path) => path.endsWith('.edk'))).not.toHaveLength(0);

    const [object] = filesInRepo().filter((path) => path.endsWith('.edk'));
    expect(object).toMatch(/^vaults\/[0-9a-f-]+\/ops\/\d{19}-[0-9a-f]{4}-\w+\.edk$/);

    // Committed as an Easy Docket envelope, and unreadable.
    const contents = blobContents(object);
    expect(contents.startsWith('EDCK')).toBe(true);
    for (const secret of ['Dr Mehta Clinic', 'Everyday', '4500', 'transactions']) {
      expect(contents, `"${secret}" must not reach the repository`).not.toContain(secret);
    }
  });
});
