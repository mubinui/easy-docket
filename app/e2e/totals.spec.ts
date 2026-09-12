import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  addExpense,
  createVault,
  goToTab,
  summaryCard,
  tap,
  waitForScreen,
} from './helpers';

const TOTALS = 'app-totals-settings';

/**
 * The net worth figure at the top of the totals screen.
 *
 * Scoped deliberately: the page also lists each account's own balance, so a
 * page-wide text assertion matches a row and passes before the switch has
 * written anything. That is how the first version of the lock-and-unlock test
 * below fooled itself into reloading mid-write.
 */
function totalsHeadline(page: import('@playwright/test').Page) {
  return page.locator(`${TOTALS} .summary`);
}

async function openTotals(page: import('@playwright/test').Page): Promise<void> {
  await goToTab(page, 'Settings', Screen.settings);
  await page.locator(Screen.settings).getByText('Accounts in totals').click();
  await waitForScreen(page, TOTALS);
}

/** Switch an account off by name. */
async function switchOff(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .locator(`${TOTALS} ion-item`)
    .filter({ hasText: name })
    .locator('ion-toggle')
    .click();
}

test.describe('accounts in totals', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Current', '1000.00');
    await addAccount(page, 'Shared pot', '500.00');
  });

  test('every account counts until told otherwise', async ({ page }) => {
    await goToTab(page, 'Accounts', Screen.accounts);
    await expect(page.locator(Screen.accounts)).toContainText('$1,500.00');

    await openTotals(page);
    await expect(totalsHeadline(page)).toContainText('$1,500.00');
  });

  test('switching an account off removes it from net worth', async ({ page }) => {
    await openTotals(page);
    await switchOff(page, 'Shared pot');

    await expect(totalsHeadline(page)).toContainText('$1,000.00');

    // The accounts screen agrees, still shows the account, and says why.
    await goToTab(page, 'Accounts', Screen.accounts);
    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('$1,000.00');
    await expect(screen.getByRole('heading', { name: 'Shared pot' })).toBeVisible();
    await expect(screen).toContainText('not counted');
    await expect(screen).toContainText('Not counting 1 account');
  });

  test('the summary screen agrees with the setting', async ({ page }) => {
    await openTotals(page);
    await switchOff(page, 'Shared pot');

    await goToTab(page, 'Summary', Screen.dashboard);
    await expect(summaryCard(page, 'Net worth')).toContainText('$1,000.00');
  });

  test('an excluded account still records transactions', async ({ page }) => {
    // Excluding is a reporting choice, not a deletion.
    await openTotals(page);
    await switchOff(page, 'Shared pot');

    await addExpense(page, '25.00', 'Corner Shop');
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Corner Shop' }),
    ).toBeVisible();
  });

  test('the choice survives a lock and unlock', async ({ page }) => {
    await openTotals(page);
    await switchOff(page, 'Shared pot');
    // The headline only moves once the write has landed, which is what makes
    // the reload below safe.
    await expect(totalsHeadline(page)).toContainText('$1,000.00');

    await page.reload();
    await waitForScreen(page, Screen.vault);
    await page.locator(`${Screen.vault} ion-input[label="Passphrase"] input`).fill('correct horse battery staple');
    await tap(page, 'Unlock', Screen.vault);
    await waitForScreen(page, Screen.dashboard);

    await expect(summaryCard(page, 'Net worth')).toContainText('$1,000.00');
  });
});
