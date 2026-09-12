import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  createVault,
  fillField,
  goToTab,
  tap,
  tapAdd,
  waitForEditorClosed,
  waitForScreen,
} from './helpers';

const LIST = 'app-categories';
const PICKER = 'app-category-picker';

async function openCategories(page: Page, kind: 'Income' | 'Expense'): Promise<void> {
  await goToTab(page, 'Settings', Screen.settings);
  await page.locator(Screen.settings).getByText(`${kind} categories`).click();
  await waitForScreen(page, LIST);
}

/** Add subcategories to an existing category through its editor. */
async function addSubcategories(page: Page, parent: string, names: string[]): Promise<void> {
  await page.locator(LIST).getByText(parent, { exact: false }).first().click();
  const modal = page.locator('ion-modal.show-modal');
  await expect(modal).toBeVisible();

  for (const name of names) {
    await fillField(page, 'Add a subcategory', name);
    await modal.getByRole('button', { name: 'Add subcategory' }).click();
    await expect(modal.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  }

  await tap(page, 'Save');
  await waitForEditorClosed(page);
}

test.describe('categories', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
  });

  test('income and expense are managed apart', async ({ page }) => {
    await openCategories(page, 'Income');
    await expect(page.locator(LIST)).toContainText('Salary');
    await expect(page.locator(LIST)).not.toContainText('Groceries');

    await openCategories(page, 'Expense');
    await expect(page.locator(LIST)).toContainText('Groceries');
    await expect(page.locator(LIST)).not.toContainText('Salary');
  });

  test('a category can be added and shows up straight away', async ({ page }) => {
    await openCategories(page, 'Expense');
    await tapAdd(page, LIST);
    await fillField(page, 'Name', 'Childcare');
    await tap(page, 'Save');
    await waitForEditorClosed(page);

    await expect(page.locator(LIST).getByText('Childcare')).toBeVisible();
  });

  test('subcategories are added under their parent and previewed in the list', async ({ page }) => {
    await openCategories(page, 'Expense');
    await addSubcategories(page, 'Groceries', ['Supermarket', 'Corner shop']);

    const list = page.locator(LIST);
    await expect(list).toContainText('Groceries (2)');
    await expect(list).toContainText('Corner shop, Supermarket');
  });

  test('the switch hides subcategories without deleting them', async ({ page }) => {
    await openCategories(page, 'Expense');
    await addSubcategories(page, 'Groceries', ['Supermarket']);
    await expect(page.locator(LIST)).toContainText('Groceries (1)');

    await page.locator(LIST).locator('ion-toggle').first().click();
    await expect(page.locator(LIST)).not.toContainText('Groceries (1)');
    await expect(page.locator(LIST)).toContainText('hidden, not deleted');

    // Back on, and it is still there — nothing was destroyed.
    await page.locator(LIST).locator('ion-toggle').first().click();
    await expect(page.locator(LIST)).toContainText('Groceries (1)');
  });

  test('a transaction is filed under a subcategory', async ({ page }) => {
    await addAccount(page, 'Everyday', '1000.00');
    await openCategories(page, 'Expense');
    await addSubcategories(page, 'Groceries', ['Supermarket', 'Corner shop']);

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await fillField(page, 'Amount', '25.00');

    // The picker: tapping the parent opens its subcategories in place.
    await page.locator('ion-modal.show-modal').getByText('Choose a category').click();
    await expect(page.locator(PICKER)).toBeVisible();
    await page.locator(PICKER).getByRole('button', { name: /^Groceries/ }).click();
    await expect(page.locator(PICKER).getByRole('button', { name: 'Corner shop' })).toBeVisible();
    await page.locator(PICKER).getByRole('button', { name: 'Corner shop' }).click();

    // Scoped to the editor rather than "the open modal": the picker is still
    // closing at this point, so two modals are momentarily open.
    await expect(page.locator(PICKER)).toHaveCount(0);
    await expect(page.locator('app-transaction-editor')).toContainText('Groceries › Corner shop');
    await fillField(page, 'Payee', 'Corner Shop');
    await tap(page, 'Save');
    await waitForEditorClosed(page);

    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Corner Shop' }),
    ).toBeVisible();
  });

  test('subcategory spending still counts towards the parent in reports', async ({ page }) => {
    // The guarantee the whole roll-up exists for, seen from outside.
    await addAccount(page, 'Everyday', '1000.00');
    await openCategories(page, 'Expense');
    await addSubcategories(page, 'Groceries', ['Supermarket']);

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await fillField(page, 'Amount', '30.00');
    await page.locator('ion-modal.show-modal').getByText('Choose a category').click();
    await page.locator(PICKER).getByRole('button', { name: /^Groceries/ }).click();
    await page.locator(PICKER).getByRole('button', { name: 'Supermarket' }).click();
    await fillField(page, 'Payee', 'Tesco');
    await tap(page, 'Save');
    await waitForEditorClosed(page);

    // The summary card rolls it up: Groceries, not Supermarket.
    await goToTab(page, 'Summary', Screen.dashboard);
    const whereItWent = page
      .locator(`${Screen.dashboard} ion-card`)
      .filter({ has: page.getByRole('heading', { name: 'Where it went' }) });
    await expect(whereItWent).toContainText('Groceries');
    await expect(whereItWent).not.toContainText('Supermarket');
  });

  test('deleting a category says what it takes with it', async ({ page }) => {
    await openCategories(page, 'Expense');
    await addSubcategories(page, 'Groceries', ['Supermarket', 'Corner shop']);

    await page
      .locator(LIST)
      .getByRole('button', { name: 'Delete Groceries', exact: true })
      .click();

    const alert = page.locator('ion-alert');
    await expect(alert).toContainText('2 subcategories go too');
    await alert.getByRole('button', { name: 'Delete' }).click();
    await expect(alert).toBeHidden();

    await expect(page.locator(LIST)).not.toContainText('Groceries');
  });

  test('categories are managed from the picker without losing the transaction', async ({ page }) => {
    /**
     * The reported break: the picker's pencil was a link to the settings
     * screen. Navigating unmounted the transaction editor that owns the
     * overlay, so the URL changed while the picker stayed on top of it — a dead
     * sheet over a page nobody could reach, and the half-written transaction
     * gone with it.
     */
    await addAccount(page, 'Everyday', '1000.00');
    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await fillField(page, 'Amount', '42.00');

    const before = page.url();
    await page.locator('ion-modal.show-modal').getByText('Choose a category').click();
    await expect(page.locator(PICKER)).toBeVisible();
    await page.locator(PICKER).getByRole('button', { name: 'Manage categories' }).click();

    // The manager arrives over the picker; nothing navigated.
    await expect(page.locator(LIST)).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(page.locator(LIST).getByRole('button', { name: 'Done' })).toBeVisible();

    // Add a category from here.
    await tapAdd(page, LIST);
    await fillField(page, 'Name', 'Childcare');
    await tap(page, 'Save');
    await expect(page.locator(LIST).getByText('Childcare')).toBeVisible();

    // Back to the picker, which is offering it straight away.
    await page.locator(LIST).getByRole('button', { name: 'Done' }).click();
    await expect(page.locator(LIST)).toHaveCount(0);
    await page.locator(PICKER).getByRole('button', { name: 'Childcare', exact: true }).click();
    await expect(page.locator(PICKER)).toHaveCount(0);

    // The transaction survived all of it.
    const editor = page.locator('app-transaction-editor');
    await expect(editor).toContainText('Childcare');
    await expect(editor.locator('ion-input[label="Amount"] input')).toHaveValue('42.00');

    await fillField(page, 'Payee', 'Nursery');
    await tap(page, 'Save');
    await waitForEditorClosed(page);
    await expect(
      page.locator(Screen.transactions).getByRole('heading', { name: 'Nursery' }),
    ).toBeVisible();
  });
});
