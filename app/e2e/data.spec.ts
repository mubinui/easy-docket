import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  addExpense,
  createVault,
  goToTab,
  tap,
  waitForEditorClosed,
} from './helpers';

const DATA = 'app-data';

/** Dated in the current month, which is the window the Activity screen shows. */
function statement(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const day = (n: number) => String(n).padStart(2, '0');

  return [
    'Date,Description,Amount,Category',
    `${day(5)}/${month}/${year},"Smith, Jones & Co",-125.50,Housing`,
    `${day(6)}/${month}/${year},Supermarket,-42.00,Groceries`,
    `${day(7)}/${month}/${year},Salary,3200.00,`,
    `${day(8)}/${month}/${year},Broken row,not-a-number,`,
  ].join('\n');
}

async function openData(page: import('@playwright/test').Page) {
  await goToTab(page, 'Settings', Screen.settings);
  await page.locator(Screen.settings).getByRole('heading', { name: 'Import and backup' }).click();
  await expect(page.locator(DATA)).toBeVisible();
}

/** Hand a file to the hidden input, as the picker would. */
async function choose(page: import('@playwright/test').Page, index: number, name: string, body: string) {
  await page.locator(`${DATA} input[type=file]`).nth(index).setInputFiles({
    name,
    mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream',
    buffer: Buffer.from(body, 'utf8'),
  });
}

test.describe('import and backup', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '0.00');
  });

  test('shows what an import will do before doing it', async ({ page }) => {
    await openData(page);
    await choose(page, 0, 'statement.csv', statement());

    const data = page.locator(DATA);
    await expect(data.getByText('3 ready to import')).toBeVisible();
    // The unreadable row is reported with its line, not swallowed.
    await expect(data.getByText(/Line 5: Could not read the amount/)).toBeVisible();
  });

  test('imports the rows, quoted commas and all', async ({ page }) => {
    await openData(page);
    await choose(page, 0, 'statement.csv', statement());
    await tap(page, 'Import 3 transaction(s)');

    await goToTab(page, 'Activity', Screen.transactions);

    // Scoped to the list: the header carries the month totals, which repeat
    // the same figures.
    const list = page.locator(`${Screen.transactions} ion-list`);
    // A payee containing a comma survived as one field.
    await expect(list.getByRole('heading', { name: 'Smith, Jones & Co' })).toBeVisible();
    await expect(list.getByText('−$125.50')).toBeVisible();
    // A positive amount became income.
    await expect(list.getByText('+$3,200.00')).toBeVisible();
  });

  test('a second import of the same file adds nothing', async ({ page }) => {
    await openData(page);
    await choose(page, 0, 'statement.csv', statement());
    await tap(page, 'Import 3 transaction(s)');

    // Wait for the import to finish before offering the file again: it clears
    // the plan when it completes, which would otherwise wipe the second one.
    await expect(page.getByText('Imported 3 transaction(s)')).toBeVisible();

    await choose(page, 0, 'statement.csv', statement());

    const data = page.locator(DATA);
    await expect(data.getByText('0 ready to import')).toBeVisible();
    await expect(data.getByText(/3 already recorded/)).toBeVisible();
  });

  test('re-reads the file when the date convention changes', async ({ page }) => {
    // 05/01 is 5 January day-first and 1 May month-first: the same file means
    // different days, so the plan is rebuilt rather than left showing counts
    // for the previous setting.
    await openData(page);
    await choose(page, 0, 'statement.csv', '...\n05/01/2026,Shop,-10.00');

    const data = page.locator(DATA);
    await data.getByRole('switch', { name: /day first/i }).click();
    await expect(data.getByText(/ready to import/)).toBeVisible();
  });

  test('backs up and restores', async ({ page }) => {
    await addExpense(page, '12.34', 'Corner Shop', 'Groceries');
    await openData(page);

    const download = page.waitForEvent('download');
    await tap(page, 'Export backup');
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^easy-docket-backup-.*\.edk$/);

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contents = Buffer.concat(chunks).toString('utf8');

    // Nothing readable in the file.
    expect(contents).not.toContain('Corner Shop');

    // Delete the transaction, then restore it.
    await goToTab(page, 'Activity', Screen.transactions);
    await page.locator(Screen.transactions).getByRole('heading', { name: 'Corner Shop' }).click();
    await tap(page, 'Delete transaction');
    await waitForEditorClosed(page);
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Corner Shop' }),
    ).toHaveCount(0);

    await openData(page);
    await choose(page, 1, 'backup.edk', contents.replace(/^﻿/, ''));

    await page.locator('ion-alert').getByRole('button', { name: 'Restore' }).click();
    await goToTab(page, 'Activity', Screen.transactions);

    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Corner Shop' }),
    ).toBeVisible();
  });

  test('refuses a file that is not a backup', async ({ page }) => {
    await openData(page);
    await choose(page, 1, 'notes.edk', 'this is not a backup');

    await expect(page.locator(DATA).getByText(/not an Easy Docket backup/)).toBeVisible();
  });
});
