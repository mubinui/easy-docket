import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  addExpense,
  chooseOption,
  createVault,
  fillField,
  goToTab,
  summaryCard,
  tap,
  tapAdd,
  unlockToLedger,
} from './helpers';

/** Create a budget from the budgets screen, which must already be open. */
async function addBudget(page: import('@playwright/test').Page, name: string, amount: string) {
  await tapAdd(page, Screen.budgets);
  await fillField(page, 'Name', name);
  await fillField(page, 'Amount per period', amount);
  await chooseOption(page, 'Categories', 'Groceries');
  await tap(page, 'Save');
  await expect(page.locator(Screen.budgets).getByRole('heading', { name })).toBeVisible();
}

async function openBudgets(page: import('@playwright/test').Page) {
  await goToTab(page, 'Summary', Screen.dashboard);
  await summaryCard(page, 'Budgets').locator('ion-item').last().click();
  await expect(page.locator(Screen.budgets)).toBeVisible();
}

test.describe('budgets', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '1000.00');
  });

  test('the summary invites you to set one', async ({ page }) => {
    await goToTab(page, 'Summary', Screen.dashboard);

    await expect(summaryCard(page, 'Budgets').getByText('Set a spending limit')).toBeVisible();
  });

  test('a budget starts empty and fills as you spend', async ({ page }) => {
    await openBudgets(page);
    await addBudget(page, 'Groceries budget', '250.00');

    const list = page.locator(Screen.budgets);
    await expect(list.getByText('$0.00 of $250.00')).toBeVisible();
    await expect(list.getByText('$250.00 left')).toBeVisible();

    await addExpense(page, '100.00', 'Corner Shop', 'Groceries');
    await openBudgets(page);

    await expect(list.getByText('$100.00 of $250.00')).toBeVisible();
    await expect(list.getByText('$150.00 left')).toBeVisible();
  });

  test('overspending is called out, not buried', async ({ page }) => {
    await openBudgets(page);
    await addBudget(page, 'Groceries budget', '50.00');

    await addExpense(page, '75.00', 'Corner Shop', 'Groceries');
    await openBudgets(page);

    await expect(page.locator(Screen.budgets).getByText('over by $25.00')).toBeVisible();
  });

  test('the summary card mirrors the budgets screen', async ({ page }) => {
    await openBudgets(page);
    await addBudget(page, 'Groceries budget', '250.00');
    await addExpense(page, '100.00', 'Corner Shop', 'Groceries');

    await goToTab(page, 'Summary', Screen.dashboard);
    const card = summaryCard(page, 'Budgets');

    await expect(card.getByRole('heading', { name: 'Groceries budget' })).toBeVisible();
    await expect(card.getByText('$150.00 left')).toBeVisible();
    await expect(card.getByText('All budgets within their limits')).toBeVisible();
  });

  test('the summary card reports a breach', async ({ page }) => {
    await openBudgets(page);
    await addBudget(page, 'Groceries budget', '50.00');
    await addExpense(page, '75.00', 'Corner Shop', 'Groceries');

    await goToTab(page, 'Summary', Screen.dashboard);
    const card = summaryCard(page, 'Budgets');

    await expect(card.getByText('OVER', { exact: true })).toBeVisible();
    await expect(card.getByText('1 budget over its limit')).toBeVisible();
  });

  test('only expenses in the budget’s categories count', async ({ page }) => {
    await openBudgets(page);
    await addBudget(page, 'Groceries budget', '250.00');

    // A different category, so the budget must not move.
    await addExpense(page, '80.00', 'Bus fare', 'Transport');
    await openBudgets(page);

    await expect(page.locator(Screen.budgets).getByText('$0.00 of $250.00')).toBeVisible();
  });

  test('a budget survives a lock and unlock', async ({ page }) => {
    await openBudgets(page);
    await addBudget(page, 'Groceries budget', '250.00');

    await page.reload();
    await unlockToLedger(page);
    await openBudgets(page);

    await expect(
      page.locator(Screen.budgets).getByRole('heading', { name: 'Groceries budget' }),
    ).toBeVisible();
  });
});
