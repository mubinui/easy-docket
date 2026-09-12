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
  waitForEditorClosed,
  waitForScreen,
} from './helpers';

const GROUPS = 'app-account-groups';

/**
 * Open the group management screen from the Accounts toolbar.
 *
 * Addressed as a link rather than a button: `routerLink` on an `ion-button`
 * renders an inner anchor and Ionic moves the `aria-label` onto it, so the host
 * carries neither the attribute nor the button role.
 */
async function openGroups(page: import('@playwright/test').Page): Promise<void> {
  await goToTab(page, 'Accounts', Screen.accounts);
  await page.locator(Screen.accounts).getByRole('link', { name: 'Account groups' }).click();
  await waitForScreen(page, GROUPS);
}

async function addGroup(
  page: import('@playwright/test').Page,
  name: string,
  type?: string,
): Promise<void> {
  await tapAdd(page, GROUPS);
  await fillField(page, 'Name', name);
  if (type) await chooseOption(page, 'Type', type);
  await tap(page, 'Save');
  await expect(
    page.locator(GROUPS).getByRole('heading', { name, exact: true }),
  ).toBeVisible();
}

/** Create an account already filed into a group. */
async function addFiledAccount(
  page: import('@playwright/test').Page,
  name: string,
  opening: string,
  group: string,
): Promise<void> {
  await goToTab(page, 'Accounts', Screen.accounts);
  await tapAdd(page, Screen.accounts);
  await fillField(page, 'Name', name);
  await fillField(page, 'Opening balance', opening);
  await chooseOption(page, 'Group', group);
  await tap(page, 'Save');
  await expect(
    page.locator(Screen.accounts).getByRole('heading', { name, exact: true }),
  ).toBeVisible();
}

test.describe('account groups', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
  });

  test('a new vault arrives with a starter group of each kind', async ({ page }) => {
    await openGroups(page);

    for (const name of ['Everyday', 'Savings', 'Credit cards', 'Debit cards', 'Loans']) {
      await expect(page.locator(GROUPS).getByRole('heading', { name, exact: true })).toBeVisible();
    }
    // None of them is an empty shell: each holds at least one account.
    await expect(page.locator(GROUPS)).not.toContainText('0 accounts');
  });

  test('a group can be created and named', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Air miles', 'Credit card');

    // A group starts empty, unlike the seeded ones.
    await expect(
      page.locator(`${GROUPS} ion-item`).filter({ hasText: 'Air miles' }),
    ).toContainText('0 accounts');
  });

  test('an account can be filed into a group', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');

    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    await fillField(page, 'Name', 'Visa');
    await fillField(page, 'Opening balance', '0');
    await chooseOption(page, 'Group', 'My cards');
    await tap(page, 'Save');

    await expect(page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' })).toBeVisible();

    await openGroups(page);
    await expect(page.locator(GROUPS)).toContainText('1 account');
  });

  test('an account survives its group being deleted', async ({ page }) => {
    await addAccount(page, 'Visa', '0');
    await openGroups(page);
    await addGroup(page, 'My cards');

    // File the existing account into it.
    await goToTab(page, 'Accounts', Screen.accounts);
    await page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' }).click();
    await chooseOption(page, 'Group', 'My cards');
    await tap(page, 'Save');

    await openGroups(page);
    await expect(page.locator(GROUPS)).toContainText('1 account');

    // Delete the group and confirm.
    await page.locator(GROUPS).getByRole('heading', { name: 'My cards', exact: true }).click();
    await page.locator('ion-modal.show-modal').getByText('Delete group').click();
    const alert = page.locator('ion-alert');
    await expect(alert).toContainText('will be kept and left ungrouped');
    await alert.getByRole('button', { name: 'Delete' }).click();
    await expect(alert).toBeHidden();

    // The group is gone; the starter groups it never belonged to are not.
    await expect(
      page.locator(GROUPS).getByRole('heading', { name: 'My cards', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator(GROUPS).getByRole('heading', { name: 'Everyday', exact: true }),
    ).toBeVisible();

    // The account is still there, and still has its balance.
    await goToTab(page, 'Accounts', Screen.accounts);
    await expect(page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' })).toBeVisible();
  });

  test('a group survives a lock and unlock', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');

    await page.reload();
    await waitForScreen(page, Screen.vault);
    await fillField(page, 'Passphrase', 'correct horse battery staple', Screen.vault);
    await tap(page, 'Unlock', Screen.vault);
    await waitForScreen(page, Screen.dashboard);

    await openGroups(page);
    await expect(
      page.locator(GROUPS).getByRole('heading', { name: 'My cards', exact: true }),
    ).toBeVisible();
  });

  test('the accounts screen groups accounts under their group', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');
    await addGroup(page, 'My everyday', 'Default');

    await addFiledAccount(page, 'Visa', '-1240.00', 'My cards');
    await addFiledAccount(page, 'Joint account', '4100.00', 'My everyday');
    await addAccount(page, 'Shoebox', '60.00');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('My cards');
    await expect(screen).toContainText('My everyday');
    await expect(screen).toContainText('Not in a group');

    // A credit-card group reads as money owed, not as a negative balance.
    await expect(screen).toContainText('owed');
    await expect(screen).not.toContainText('\u22121,240.00');

    // Subtotals per group, and net worth still subtracts the debt.
    await expect(screen).toContainText('$1,240.00');
    await expect(screen).toContainText('$4,100.00');
    await expect(screen).toContainText('$2,920.00');
  });

  test('an account moves between groups from its editor', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');
    await addGroup(page, 'My everyday', 'Default');
    await addFiledAccount(page, 'Visa', '-100.00', 'My cards');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('owed');

    await screen.getByRole('heading', { name: 'Visa' }).click();
    await chooseOption(page, 'Group', 'My everyday');
    await tap(page, 'Save');

    // Now an ordinary account, so its own row stops reading as owed. Scoped to
    // the row: the seeded card and loan groups still say "owed", correctly.
    const visaRow = screen.locator('ion-item').filter({ hasText: 'Visa' });
    await expect(visaRow).not.toContainText('owed');
    await expect(screen).toContainText('My everyday');
  });

  test('a card carries its terms, and only a card is asked for them', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');
    await addGroup(page, 'My everyday', 'Default');

    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    const modal = page.locator('ion-modal.show-modal');

    // Nothing about cards until the account is filed as one.
    await expect(modal.locator('ion-input[label="Credit limit"]')).toHaveCount(0);

    await fillField(page, 'Name', 'Visa');
    await chooseOption(page, 'Group', 'My cards');
    await expect(modal.locator('ion-input[label="Credit limit"]')).toBeVisible();

    await fillField(page, 'Opening balance', '-1240.00');
    await fillField(page, 'Credit limit', '5000.00');
    await fillField(page, 'Statement closes on day', '25');
    await fillField(page, 'Payment due on day', '15');
    await tap(page, 'Save');

    const screen = page.locator(Screen.accounts);
    await expect(screen.getByRole('heading', { name: 'Visa' })).toBeVisible();
    await expect(screen).toContainText('$3,760.00 available');
    await expect(screen).toContainText('due');

    // Moving it out of the cards group takes the terms with it.
    await screen.getByRole('heading', { name: 'Visa' }).click();
    await chooseOption(page, 'Group', 'My everyday');
    await tap(page, 'Save');

    await expect(screen).not.toContainText('available');
  });

  test('the terms survive a lock and unlock', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');

    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    await fillField(page, 'Name', 'Visa');
    await chooseOption(page, 'Group', 'My cards');
    await fillField(page, 'Opening balance', '-100.00');
    await fillField(page, 'Credit limit', '1000.00');
    await tap(page, 'Save');
    // The editor closes only once its write has resolved, so this is what makes
    // the reload below safe: reloading mid-write can cut the write off.
    await waitForEditorClosed(page);
    await expect(page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' })).toBeVisible();

    await page.reload();
    await waitForScreen(page, Screen.vault);
    await fillField(page, 'Passphrase', 'correct horse battery staple', Screen.vault);
    await tap(page, 'Unlock', Screen.vault);
    await waitForScreen(page, Screen.dashboard);
    await goToTab(page, 'Accounts', Screen.accounts);

    await expect(page.locator(Screen.accounts)).toContainText('$900.00 available');
  });

  test('a card bill is paid from a current account', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');

    await addFiledAccount(page, 'Visa', '-1240.00', 'My cards');
    await addAccount(page, 'Joint account', '4100.00');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('$1,240.00');

    // Pay the whole balance.
    // `exact`: the row is itself a button, and its accessible name ends up
    // containing the words of the Pay button nested inside it.
    // No scrolling dance: the content leaves room for the floating add button,
    // so the last row is reachable rather than sitting underneath it.
    await screen.getByRole('button', { name: 'Pay Visa bill', exact: true }).click();
    const sheet = page.locator('ion-modal.show-modal');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Full balance');
    // `exact` again: the "Pay from" select is also a button whose name starts
    // with the same word.
    await sheet.getByRole('button', { name: 'Pay', exact: true }).click();
    await waitForEditorClosed(page);

    // The card is clear and the money came out of the current account.
    await expect(screen).toContainText('$2,860.00');
    await expect(
      screen.getByRole('button', { name: 'Pay Visa bill', exact: true }),
    ).toHaveCount(0);

    // Net worth is unchanged by a payment: it moved, it did not vanish.
    await expect(screen).toContainText('$2,860.00');

    // And it is an ordinary transfer in the register.
    await goToTab(page, 'Activity', Screen.transactions);
    await expect(page.locator(Screen.transactions)).toContainText('Visa');
  });

  test('a card with nothing owing offers no payment', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');
    await addFiledAccount(page, 'Visa', '0', 'My cards');

    await expect(
      page.locator(Screen.accounts).getByRole('button', { name: 'Pay Visa bill', exact: true }),
    ).toHaveCount(0);
  });

  test('credit and loans show as liabilities, cash as assets', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');
    await addGroup(page, 'My loans', 'Loan');

    await addFiledAccount(page, 'Visa', '-1240.00', 'My cards');
    await addFiledAccount(page, 'Car loan', '-5000.00', 'My loans');
    await addAccount(page, 'Joint account', '10000.00');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('Assets');
    await expect(screen).toContainText('Liabilities');

    // Both debts read as owed, and add up as one liability figure.
    await expect(screen).toContainText('$6,240.00');
    await expect(screen).toContainText('$10,000.00');

    // Net worth is assets less liabilities, and is not restated by any of this.
    await expect(screen).toContainText('$3,760.00');

    // A loan is not a negative asset: it never shows as a minus.
    await expect(screen).not.toContainText('\u2212$5,000.00');
    await expect(screen).not.toContainText('-$5,000.00');

    // Pay is a credit card flow; a loan repayment is recorded as a transfer.
    await expect(screen.getByRole('button', { name: 'Pay Visa bill', exact: true })).toBeVisible();
    await expect(
      screen.getByRole('button', { name: 'Pay Car loan bill', exact: true }),
    ).toHaveCount(0);
  });

  test('a loan is not offered as a way to pay a card', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'My cards', 'Credit card');
    await addGroup(page, 'My loans', 'Loan');

    await addFiledAccount(page, 'Visa', '-100.00', 'My cards');
    await addFiledAccount(page, 'Car loan', '-5000.00', 'My loans');
    await addAccount(page, 'Joint account', '1000.00');

    await page
      .locator(Screen.accounts)
      .getByRole('button', { name: 'Pay Visa bill', exact: true })
      .click();
    const sheet = page.locator('ion-modal.show-modal');
    await expect(sheet).toBeVisible();

    // Open the funding picker and see what it offers.
    await sheet.locator('ion-select').click();
    const options = page.locator('ion-alert');
    await expect(options).toBeVisible();
    await expect(options).toContainText('Joint account');
    await expect(options).not.toContainText('Car loan');
  });

  test('a new vault arrives with a group of each kind, each holding accounts', async ({ page }) => {
    await goToTab(page, 'Accounts', Screen.accounts);
    const screen = page.locator(Screen.accounts);

    // Both halves of the balance sheet are there from the first launch.
    await expect(screen).toContainText('Assets');
    await expect(screen).toContainText('Liabilities');

    // Uppercased by CSS, so the DOM still holds the names as written.
    for (const group of ['Everyday', 'Savings', 'Credit cards', 'Debit cards', 'Loans']) {
      await expect(screen).toContainText(group);
    }
    for (const account of ['Cash', 'Current account', 'Savings', 'Credit card', 'Debit card', 'Loan']) {
      await expect(screen.getByRole('heading', { name: account, exact: true })).toBeVisible();
    }

    // Nothing was invented: every starter account is empty, so a fresh vault is
    // worth nothing rather than worth something made up.
    await expect(screen).toContainText('Net worth');
    await expect(screen).not.toContainText('Not in a group');
    // And a cleared card reads as nothing owed, not as minus nothing.
    await expect(screen).not.toContainText('-$0.00');
    await expect(screen).not.toContainText('\u2212$0.00');

    await openGroups(page);
    await expect(page.locator(GROUPS)).not.toContainText('0 accounts');
  });

  test('a seeded vault is ordinary data, not something special', async ({ page }) => {
    // Renaming and deleting the starters has to work like anything else.
    await openGroups(page);
    await page.locator(GROUPS).getByRole('heading', { name: 'Loans' }).click();
    await fillField(page, 'Name', 'Mortgages');
    await tap(page, 'Save');
    await waitForEditorClosed(page);

    await expect(page.locator(GROUPS).getByRole('heading', { name: 'Mortgages' })).toBeVisible();
  });
});
