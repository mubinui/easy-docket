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
  await expect(page.locator(GROUPS).getByRole('heading', { name })).toBeVisible();
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
  await expect(page.locator(Screen.accounts).getByRole('heading', { name })).toBeVisible();
}

test.describe('account groups', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
  });

  test('a new vault has no groups and says so', async ({ page }) => {
    await openGroups(page);
    await expect(page.locator(GROUPS)).toContainText('No groups yet');
  });

  test('a group can be created and named', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Cards', 'Credit card');

    await expect(page.locator(GROUPS)).toContainText('Credit card');
    await expect(page.locator(GROUPS)).toContainText('0 accounts');
  });

  test('an account can be filed into a group', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Cards', 'Credit card');

    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    await fillField(page, 'Name', 'Visa');
    await fillField(page, 'Opening balance', '0');
    await chooseOption(page, 'Group', 'Cards');
    await tap(page, 'Save');

    await expect(page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' })).toBeVisible();

    await openGroups(page);
    await expect(page.locator(GROUPS)).toContainText('1 account');
  });

  test('an account survives its group being deleted', async ({ page }) => {
    await addAccount(page, 'Visa', '0');
    await openGroups(page);
    await addGroup(page, 'Cards');

    // File the existing account into it.
    await goToTab(page, 'Accounts', Screen.accounts);
    await page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' }).click();
    await chooseOption(page, 'Group', 'Cards');
    await tap(page, 'Save');

    await openGroups(page);
    await expect(page.locator(GROUPS)).toContainText('1 account');

    // Delete the group and confirm.
    await page.locator(GROUPS).getByRole('heading', { name: 'Cards' }).click();
    await page.locator('ion-modal.show-modal').getByText('Delete group').click();
    const alert = page.locator('ion-alert');
    await expect(alert).toContainText('will be kept and left ungrouped');
    await alert.getByRole('button', { name: 'Delete' }).click();
    await expect(alert).toBeHidden();

    await expect(page.locator(GROUPS)).toContainText('No groups yet');

    // The account is still there, and still has its balance.
    await goToTab(page, 'Accounts', Screen.accounts);
    await expect(page.locator(Screen.accounts).getByRole('heading', { name: 'Visa' })).toBeVisible();
  });

  test('a group survives a lock and unlock', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Cards', 'Credit card');

    await page.reload();
    await waitForScreen(page, Screen.vault);
    await fillField(page, 'Passphrase', 'correct horse battery staple', Screen.vault);
    await tap(page, 'Unlock', Screen.vault);
    await waitForScreen(page, Screen.dashboard);

    await openGroups(page);
    await expect(page.locator(GROUPS).getByRole('heading', { name: 'Cards' })).toBeVisible();
  });

  test('the accounts screen groups accounts under their group', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Credit cards', 'Credit card');
    await addGroup(page, 'Everyday', 'Default');

    await addFiledAccount(page, 'Visa', '-1240.00', 'Credit cards');
    await addFiledAccount(page, 'Current', '4100.00', 'Everyday');
    await addAccount(page, 'Shoebox', '60.00');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('Credit cards');
    await expect(screen).toContainText('Everyday');
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
    await addGroup(page, 'Credit cards', 'Credit card');
    await addGroup(page, 'Everyday', 'Default');
    await addFiledAccount(page, 'Visa', '-100.00', 'Credit cards');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('owed');

    await screen.getByRole('heading', { name: 'Visa' }).click();
    await chooseOption(page, 'Group', 'Everyday');
    await tap(page, 'Save');

    // Now an ordinary account, so the balance reads the ordinary way again.
    await expect(screen).not.toContainText('owed');
    await expect(screen).toContainText('Everyday');
  });

  test('a card carries its terms, and only a card is asked for them', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Credit cards', 'Credit card');
    await addGroup(page, 'Everyday', 'Default');

    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    const modal = page.locator('ion-modal.show-modal');

    // Nothing about cards until the account is filed as one.
    await expect(modal.locator('ion-input[label="Credit limit"]')).toHaveCount(0);

    await fillField(page, 'Name', 'Visa');
    await chooseOption(page, 'Group', 'Credit cards');
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
    await chooseOption(page, 'Group', 'Everyday');
    await tap(page, 'Save');

    await expect(screen).not.toContainText('available');
  });

  test('the terms survive a lock and unlock', async ({ page }) => {
    await openGroups(page);
    await addGroup(page, 'Credit cards', 'Credit card');

    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    await fillField(page, 'Name', 'Visa');
    await chooseOption(page, 'Group', 'Credit cards');
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
    await addGroup(page, 'Credit cards', 'Credit card');

    await addFiledAccount(page, 'Visa', '-1240.00', 'Credit cards');
    await addAccount(page, 'Current account', '4100.00');

    const screen = page.locator(Screen.accounts);
    await expect(screen).toContainText('$1,240.00');

    // Pay the whole balance.
    // `exact`: the row is itself a button, and its accessible name ends up
    // containing the words of the Pay button nested inside it.
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
    await addGroup(page, 'Credit cards', 'Credit card');
    await addFiledAccount(page, 'Visa', '0', 'Credit cards');

    await expect(
      page.locator(Screen.accounts).getByRole('button', { name: 'Pay Visa bill', exact: true }),
    ).toHaveCount(0);
  });
});
