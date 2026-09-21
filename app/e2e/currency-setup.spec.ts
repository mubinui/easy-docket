import { expect, test } from './fixtures';
import { Screen, addAccount, createVault, goToTab, summaryCard, tap, tapAdd } from './helpers';

test.describe('the vault currency', () => {
  test('is chosen when the vault is created, and everything follows it', async ({ page }) => {
    await createVault(page, undefined, 'BDT');

    // The starter accounts are opened in it, so a new vault is not full of
    // dollars somebody has to convert or delete.
    //
    // "BDT" rather than the taka sign: the amount is formatted for the
    // viewer's locale, and an en-US browser spells this currency out.
    await goToTab(page, 'Accounts', Screen.accounts);
    const accounts = page.locator(Screen.accounts);
    await expect(accounts).toContainText('BDT');
    await expect(accounts).not.toContainText('$');

    // And totals are reported in it.
    await goToTab(page, 'Summary', Screen.dashboard);
    await expect(summaryCard(page, 'Net worth')).toContainText('BDT');
  });

  test('is what a new account is opened in', async ({ page }) => {
    await createVault(page, undefined, 'BDT');
    await addAccount(page, 'Joint account', '1000.00');

    await expect(page.locator(Screen.accounts)).toContainText('BDT 1,000.00');
  });

  test('defaults to dollars, which is still offered', async ({ page }) => {
    await createVault(page);
    await goToTab(page, 'Accounts', Screen.accounts);
    await expect(page.locator(Screen.accounts)).toContainText('$');
  });
});

test.describe('an account currency', () => {
  test('can be corrected while the account has no transactions', async ({ page }) => {
    // What makes a seeded account fixable rather than something to delete and
    // recreate.
    await createVault(page);
    await goToTab(page, 'Accounts', Screen.accounts);
    await page.locator(Screen.accounts).getByRole('heading', { name: 'Cash', exact: true }).click();

    const modal = page.locator('ion-modal.show-modal').last();
    const field = modal.locator('app-currency-field').getByRole('button').first();
    await expect(field).toBeEnabled();
    await expect(field).toContainText('USD');

    // The reason it is still open lives in the picker, next to the choice.
    await field.click();
    await expect(page.locator('app-currency-picker')).toContainText(
      'Changeable while the account has no transactions',
    );
  });

  test('is fixed once something is recorded against it', async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '100.00');
    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await page.locator('ion-modal.show-modal').last().locator('ion-input[label="Amount"] input').fill('10.00');
    await tap(page, 'Save');

    await goToTab(page, 'Accounts', Screen.accounts);
    await page.locator(Screen.accounts).getByRole('heading', { name: 'Cash', exact: true }).click();

    const modal = page.locator('ion-modal.show-modal').last();
    // Changing it would reinterpret every amount already recorded. The picker
    // cannot be opened to say so, so the form says it instead.
    await expect(modal).toContainText('Fixed once an account has transactions');
    await expect(modal.locator('app-currency-field').getByRole('button').first()).toBeDisabled();
  });
});
