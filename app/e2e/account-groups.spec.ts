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
});
