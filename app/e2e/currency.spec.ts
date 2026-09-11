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
} from './helpers';

const RATES = 'app-rates';

async function openRates(page: import('@playwright/test').Page) {
  await goToTab(page, 'Settings', Screen.settings);
  await page.locator(Screen.settings).getByRole('heading', { name: 'Currencies and rates' }).click();
  await expect(page.locator(RATES)).toBeVisible();
}

async function addRate(
  page: import('@playwright/test').Page,
  base: string,
  quote: string,
  rate: string,
) {
  await tapAdd(page, RATES);
  await fillField(page, 'From', base);
  await fillField(page, 'To', quote);
  await fillField(page, 'Rate', rate);
  await tap(page, 'Save');

  // Confirm it landed: a silent failure here would make the next assertion
  // blame the wrong thing.
  await expect(page.locator(RATES).getByRole('heading', { name: `${base} → ${quote}` })).toBeVisible();
}

/** An account in a currency other than the reporting one. */
async function addEuroAccount(page: import('@playwright/test').Page) {
  await goToTab(page, 'Accounts', Screen.accounts);
  await tapAdd(page, Screen.accounts);
  await fillField(page, 'Name', 'Euro account');
  await chooseOption(page, 'Currency', 'EUR');
  await fillField(page, 'Opening balance', '0.00');
  await tap(page, 'Save');
  await expect(page.locator(Screen.accounts).getByRole('heading', { name: 'Euro account' })).toBeVisible();
}

test.describe('currencies', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '1000.00');
  });

  test('reports in the default currency until told otherwise', async ({ page }) => {
    await openRates(page);
    await expect(page.locator(RATES).getByText('No rates yet')).toBeVisible();
  });

  test('records a rate and states it in words', async ({ page }) => {
    await openRates(page);
    await tapAdd(page, RATES);

    await fillField(page, 'From', 'EUR');
    await fillField(page, 'To', 'USD');
    await fillField(page, 'Rate', '1.1');

    // Saying the quote back is how a mistyped direction is caught.
    await expect(page.locator('ion-modal.show-modal').getByText('1 EUR = 1.1 USD')).toBeVisible();

    await tap(page, 'Save');
    await expect(page.locator(RATES).getByRole('heading', { name: 'EUR → USD' })).toBeVisible();
  });

  test('refuses a currency against itself', async ({ page }) => {
    await openRates(page);
    await tapAdd(page, RATES);

    await fillField(page, 'From', 'USD');
    await fillField(page, 'To', 'USD');
    await fillField(page, 'Rate', '1');
    await tap(page, 'Save');

    await expect(page.getByText(/worth one of itself/)).toBeVisible();
  });

  test('asks for a rate only when the account is in another currency', async ({ page }) => {
    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);

    // The only account so far is in the reporting currency.
    await expect(page.locator('ion-modal.show-modal').getByText(/Rate to/)).toHaveCount(0);
  });

  test('asks for a rate for a foreign account, and shows what it converts to', async ({ page }) => {
    await addEuroAccount(page);

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await fillField(page, 'Amount', '45.00');
    await chooseOption(page, 'Account', 'Euro account');

    const modal = page.locator('ion-modal.show-modal');
    await expect(modal.getByText('Rate to USD')).toBeVisible();

    await fillField(page, 'Rate to USD', '1.1');
    // A mistyped rate should be obvious here, not months later.
    await expect(modal.getByText('Worth $49.50')).toBeVisible();
  });

  test('prefills the last known rate', async ({ page }) => {
    await openRates(page);
    await addRate(page, 'EUR', 'USD', '1.25');
    await addEuroAccount(page);

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await fillField(page, 'Amount', '40.00');
    await chooseOption(page, 'Account', 'Euro account');

    const modal = page.locator('ion-modal.show-modal');
    await expect(modal.getByText('Worth $50.00')).toBeVisible();
  });

  test('keeps the rate on the transaction it was entered for', async ({ page }) => {
    await addEuroAccount(page);

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await fillField(page, 'Amount', '45.00');
    await chooseOption(page, 'Account', 'Euro account');
    await fillField(page, 'Rate to USD', '1.1');
    await fillField(page, 'Payee', 'Paris café');
    await tap(page, 'Save');

    // Reopen it: the rate recorded at the time is still there.
    await page.locator(Screen.transactions).getByRole('heading', { name: 'Paris café' }).click();
    await expect(page.locator('ion-modal.show-modal').getByText('Worth $49.50')).toBeVisible();
  });
});
