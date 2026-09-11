import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { config } from '../playwright.config';
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
 * The zero-knowledge guarantee, proven against the real server rather than a
 * mock. The app encrypts in a real browser, ships the bytes over HTTP, and this
 * spec reads what landed on the server's disk.
 *
 * A mock could not establish this. The whole claim is about what a real
 * destination ends up holding.
 */
async function storedObjects(): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of glob(`${config.dataDir}/objects/**/*.edk`)) {
    paths.push(entry);
  }
  return paths;
}

async function configureSync(page: import('@playwright/test').Page): Promise<void> {
  await goToTab(page, 'Settings', Screen.settings);
  await page.locator(Screen.settings).getByRole('heading', { name: 'Destination' }).click();

  // `ion-title` renders as plain text rather than a heading landmark.
  await expect(page.getByText('Sync destination')).toBeVisible();
  await chooseOption(page, 'Destination', 'Easy Docket sync server');
  await fillField(page, 'Endpoint', config.apiOrigin);
  await fillField(page, 'Access token', config.apiToken);
}

test.describe('sync', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Joint Current Account', '4200.00');
  });

  test('rejects a bad token before saving it', async ({ page }) => {
    await goToTab(page, 'Settings', Screen.settings);
    await page.locator(Screen.settings).getByRole('heading', { name: 'Destination' }).click();

    await chooseOption(page, 'Destination', 'Easy Docket sync server');
    await fillField(page, 'Endpoint', config.apiOrigin);
    await fillField(page, 'Access token', 'not-the-right-token');
    await tap(page, 'Test connection');

    await expect(page.getByText(/401|unauthor/i)).toBeVisible();
  });

  test('confirms a good token', async ({ page }) => {
    await configureSync(page);
    await tap(page, 'Test connection');

    await expect(page.getByText('Connected successfully.')).toBeVisible();
  });

  test('uploads the ledger, and the server can read none of it', async ({ page }) => {
    await addExpense(page, '450.00', 'Dr Mehta Clinic', 'Health');
    await configureSync(page);
    await tap(page, 'Save');

    // The push happens in the background once the settings are saved.
    await expect(async () => {
      expect(await storedObjects()).not.toHaveLength(0);
    }).toPass({ timeout: 20_000 });

    const [objectPath] = await storedObjects();
    const bytes = readFileSync(objectPath);

    // A self-describing envelope: magic, version 1, algorithm 1 (AES-256-GCM).
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('EDCK');
    expect(bytes[4]).toBe(1);
    expect(bytes[5]).toBe(1);

    // Nothing the user typed, and not even the entity names, survive in the clear.
    const raw = bytes.toString('binary');
    for (const secret of [
      'Dr Mehta Clinic',
      'Joint Current Account',
      'Health',
      '45000',
      '420000',
      'transactions',
      'accounts',
      'payee',
      'correct horse',
    ]) {
      expect(raw, `"${secret}" must not appear in a synced object`).not.toContain(secret);
    }

    // The one readable part is the header, and it carries nothing identifying.
    const headerLength = bytes.readUInt16BE(6);
    const header = JSON.parse(bytes.subarray(20, 20 + headerLength).toString('utf8'));
    expect(Object.keys(header).sort()).toEqual(['d', 'h', 't', 'v']);
    expect(header.t).toBe('ops');
  });

  test('reports its progress on the settings screen', async ({ page }) => {
    await addExpense(page, '12.00', 'Corner Shop');
    await configureSync(page);
    await tap(page, 'Save');

    await goToTab(page, 'Settings', Screen.settings);
    await expect(page.locator(Screen.settings).getByText(/up to date/)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('survives being offline and catches up afterwards', async ({ page, context }) => {
    await configureSync(page);
    await tap(page, 'Save');

    await context.setOffline(true);
    await addExpense(page, '31.50', 'Bakery', 'Groceries');

    // Recording works with no network at all; that is the whole point.
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Bakery' }),
    ).toBeVisible();

    await context.setOffline(false);
    await goToTab(page, 'Summary', Screen.dashboard);
    await page.locator(Screen.dashboard).locator('app-sync-status ion-button').click();

    await expect(async () => {
      const objects = await storedObjects();
      expect(objects.length).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
  });
});
