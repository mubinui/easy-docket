import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  chooseSegment,
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

test.describe('ledger', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
  });

  test('an account carries its opening balance', async ({ page }) => {
    await addAccount(page, 'Everyday', '1500.00');

    await expect(page.getByText('$1,500.00').first()).toBeVisible();
  });

  test('an expense reduces the balance', async ({ page }) => {
    await addAccount(page, 'Everyday', '1500.00');
    await addExpense(page, '12.34', 'Corner Shop');

    await goToTab(page, 'Accounts', Screen.accounts);
    await expect(page.getByText('$1,487.66').first()).toBeVisible();
  });

  test('income increases it', async ({ page }) => {
    await addAccount(page, 'Everyday', '100.00');

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await chooseSegment(page, 'Income');
    await fillField(page, 'Amount', '250.00');
    await fillField(page, 'Payee', 'Salary');
    await tap(page, 'Save');

    await goToTab(page, 'Accounts', Screen.accounts);
    await expect(page.getByText('$350.00').first()).toBeVisible();
  });

  test('a transfer moves money without changing net worth', async ({ page }) => {
    await addAccount(page, 'Everyday', '1000.00');
    await addAccount(page, 'Savings', '500.00');

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await chooseSegment(page, 'Transfer');
    await fillField(page, 'Amount', '200.00');
    await chooseOption(page, 'From account', 'Everyday');
    await chooseOption(page, 'To account', 'Savings');
    await tap(page, 'Save');

    await goToTab(page, 'Accounts', Screen.accounts);
    // Both sides moved, and the total is untouched.
    await expect(page.getByText('$800.00').first()).toBeVisible();
    await expect(page.getByText('$700.00').first()).toBeVisible();
    await expect(page.getByText('$1,500.00').first()).toBeVisible();
  });

  test('the summary reflects the month', async ({ page }) => {
    await addAccount(page, 'Everyday', '1000.00');
    await addExpense(page, '40.00', 'Corner Shop', 'Groceries');

    await goToTab(page, 'Summary', Screen.dashboard);
    await expect(summaryCard(page, 'This month').getByText('$40.00')).toBeVisible();
    await expect(summaryCard(page, 'Where it went').getByText('Groceries')).toBeVisible();
    await expect(summaryCard(page, 'Recent activity').getByText('Corner Shop')).toBeVisible();
  });

  test('a transaction survives a lock and unlock', async ({ page }) => {
    await addAccount(page, 'Everyday', '1000.00');
    await addExpense(page, '25.00', 'Bakery');

    await page.reload();
    await unlockToLedger(page);

    await goToTab(page, 'Activity', Screen.transactions);
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Bakery' }),
    ).toBeVisible();
  });

  test('an edit replaces the transaction rather than adding one', async ({ page }) => {
    await addAccount(page, 'Everyday', '1000.00');
    await addExpense(page, '25.00', 'Bakery');

    await page.locator(Screen.transactions).getByRole('heading', { name: 'Bakery' }).click();
    await fillField(page, 'Payee', 'Bakery on the corner');
    await tap(page, 'Save');

    const list = page.locator(Screen.transactions);
    await expect(list.getByRole('heading', { name: 'Bakery on the corner' })).toBeVisible();
    await expect(list.getByRole('heading', { name: 'Bakery', exact: true })).toHaveCount(0);
  });
});
