import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  chooseOption,
  createVault,
  fillField,
  goToTab,
  tap,
  tapAdd,
  unlockToLedger,
  waitForEditorClosed,
} from './helpers';

const RULES = 'app-rules';

/** Yesterday, so the first occurrence is already due and gets materialised. */
function yesterday(): string {
  return offsetDays(-1);
}

function offsetDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // Local calendar, matching how the app dates a transaction.
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

async function openRecurring(page: import('@playwright/test').Page) {
  await goToTab(page, 'Activity', Screen.transactions);
  // `routerLink` on an ion-button renders an anchor, so it is a link.
  await page.locator(Screen.transactions).getByRole('link', { name: 'Recurring' }).click();
  await expect(page.locator(RULES)).toBeVisible();
}

async function addRule(
  page: import('@playwright/test').Page,
  name: string,
  amount: string,
  startDate: string,
) {
  await tapAdd(page, RULES);
  await fillField(page, 'Name', name);
  await fillField(page, 'Amount', amount);
  await fillField(page, 'Starting', startDate);
  await tap(page, 'Save');
  await expect(page.locator(RULES).getByRole('heading', { name })).toBeVisible();
}

test.describe('recurring', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '5000.00');
  });

  test('invites a first rule', async ({ page }) => {
    await openRecurring(page);
    await expect(page.getByText(/Nothing recurring yet/)).toBeVisible();
  });

  test('shows a rule with its cadence and next date', async ({ page }) => {
    await openRecurring(page);
    await addRule(page, 'Rent', '1200.00', yesterday());

    const list = page.locator(RULES);
    await expect(list.getByText('$1,200.00')).toBeVisible();
    await expect(list.getByText(/every month/)).toBeVisible();
    await expect(list.getByText(/next \d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  test('previews the dates a schedule would produce', async ({ page }) => {
    // A schedule is hard to picture; the preview is where a user checks it.
    await openRecurring(page);
    await tapAdd(page, RULES);
    await fillField(page, 'Starting', '2026-01-31');

    const modal = page.locator('ion-modal.show-modal');
    await expect(modal.getByText('2026-01-31')).toBeVisible();
    // A rule anchored to the 31st falls on the 28th in February.
    await expect(modal.getByText('2026-02-28')).toBeVisible();
  });

  test('materialises a due occurrence into the ledger', async ({ page }) => {
    await openRecurring(page);
    await addRule(page, 'Rent', '1200.00', yesterday());

    // The materialiser runs on app open, so reload and unlock.
    await page.reload();
    await unlockToLedger(page);
    await goToTab(page, 'Activity', Screen.transactions);

    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Rent' }).first(),
    ).toBeVisible();
  });

  test('does not create the same transaction twice', async ({ page }) => {
    await openRecurring(page);
    await addRule(page, 'Rent', '1200.00', yesterday());

    for (let i = 0; i < 2; i++) {
      await page.reload();
      await unlockToLedger(page);
    }
    await goToTab(page, 'Activity', Screen.transactions);

    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Rent' }),
    ).toHaveCount(1);
  });

  test('a deleted occurrence stays deleted', async ({ page }) => {
    await openRecurring(page);
    await addRule(page, 'Rent', '1200.00', yesterday());

    await page.reload();
    await unlockToLedger(page);
    await goToTab(page, 'Activity', Screen.transactions);

    // Delete the materialised transaction.
    await page.locator(Screen.transactions).getByRole('heading', { name: 'Rent' }).first().click();
    await tap(page, 'Delete transaction');
    await waitForEditorClosed(page);
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Rent' }),
    ).toHaveCount(0);

    // Reopening the app must not bring it back.
    await page.reload();
    await unlockToLedger(page);
    await goToTab(page, 'Activity', Screen.transactions);

    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Rent' }),
    ).toHaveCount(0);
  });

  test('skipping moves the rule on to the occurrence after', async ({ page }) => {
    // The button skips the *next* occurrence, which is what its label says. An
    // occurrence already due is a transaction by then, and is deleted as one.
    const tomorrow = offsetDays(1);
    await openRecurring(page);
    await addRule(page, 'Gym', '45.00', tomorrow);

    const list = page.locator(RULES);
    await expect(list.getByText(`next ${tomorrow}`)).toBeVisible();

    await list.getByRole('button', { name: `Skip` }).or(
      list.getByRole('button', { name: /^Skip/ }),
    ).first().click();

    await expect(list.getByText(`next ${tomorrow}`)).toHaveCount(0);
    await expect(list.getByText(/next \d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  test('a skipped occurrence is never recorded', async ({ page }) => {
    const tomorrow = offsetDays(1);
    await openRecurring(page);
    await addRule(page, 'Gym', '45.00', tomorrow);

    await page.locator(RULES).getByRole('button', { name: /^Skip/ }).first().click();
    await expect(page.locator(RULES).getByText(`next ${tomorrow}`)).toHaveCount(0);

    await page.reload();
    await unlockToLedger(page);
    await goToTab(page, 'Activity', Screen.transactions);

    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Gym' }),
    ).toHaveCount(0);
  });

  test('deleting a rule keeps the transactions it already made', async ({ page }) => {
    await openRecurring(page);
    await addRule(page, 'Rent', '1200.00', yesterday());

    await page.reload();
    await unlockToLedger(page);
    await openRecurring(page);

    await page.locator(RULES).getByRole('heading', { name: 'Rent' }).click();
    await tap(page, 'Delete rule');
    await page.locator('ion-alert').getByRole('button', { name: 'Delete' }).click();

    await goToTab(page, 'Activity', Screen.transactions);
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Rent' }).first(),
    ).toBeVisible();
  });
});
