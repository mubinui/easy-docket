import { expect, Locator, Page } from '@playwright/test';

/**
 * Interaction helpers for Ionic's web components.
 *
 * Two things make a plain `page.getByLabel(...)` unreliable here. Ionic keeps
 * previous pages in the DOM and hides them, so an unscoped selector can match a
 * control on a screen the user left minutes ago; and `ion-select` opens its
 * options in an overlay attached to the document root rather than inline.
 *
 * Both are handled once, here, so the specs read like descriptions of what a
 * person does rather than like DOM archaeology.
 */
export const PASSPHRASE = 'correct horse battery staple';

/** Component selectors, which are the most stable handle on "which screen". */
export const Screen = {
  vault: 'app-vault',
  dashboard: 'app-dashboard',
  accounts: 'app-accounts',
  transactions: 'app-transactions',
  budgets: 'app-budgets',
  settings: 'app-settings',
} as const;

/** The open modal if there is one, else the named screen. */
export async function surface(page: Page, screen?: string): Promise<Locator> {
  const modal = page.locator('ion-modal.show-modal');
  // `.last()` — the topmost sheet. Ionic appends each overlay after the one it
  // opened over, so with a sheet on a sheet (the category manager over the
  // picker over the transaction editor) the first match is the one furthest
  // underneath, and typing into it would reach a form nobody can see.
  if ((await modal.count()) > 0) return modal.last();
  return screen ? page.locator(screen) : page.locator('.ion-page:not(.ion-page-hidden)').last();
}

/** Wait until a screen is the one on top. */
export async function waitForScreen(page: Page, screen: string): Promise<void> {
  await expect(page.locator(screen)).toBeVisible();
}

/**
 * Type into a field by its label.
 *
 * Tries the `label` attribute first, then the rendered accessible name. Where a
 * template interpolates the label — "Rate to {{ currency }}" — Angular sets a
 * property and no attribute exists to match on, which is the same trap the
 * select helper below works around.
 */
export async function fillField(
  page: Page,
  label: string,
  value: string,
  screen?: string,
): Promise<void> {
  const root = await surface(page, screen);

  const byAttribute = root.locator(`ion-input[label="${label}"] input`);
  const field = (await byAttribute.count())
    ? byAttribute
    : root.getByRole('textbox', { name: label, exact: true }).or(
        root.getByRole('spinbutton', { name: label, exact: true }),
      );

  await field.first().waitFor({ state: 'visible' });
  await field.first().fill(value);
}

/**
 * Choose an option from an `ion-select`, driving the overlay it opens.
 *
 * Selects are found by their rendered label rather than a `label` attribute:
 * where the template interpolates the label (the transaction editor's account
 * field, which reads "Account" or "From account" depending on the kind) Angular
 * sets a property and no attribute exists to match on.
 */
export async function chooseOption(
  page: Page,
  label: string,
  option: string,
  screen?: string,
): Promise<void> {
  // Ionic renders the label inside the select's shadow DOM, where a text filter
  // cannot reach it, but it does surface an inner button whose accessible name
  // starts with the label. The host is clicked rather than that button: the
  // host sits above its own shadow content and would intercept the click.
  const select = (await surface(page, screen))
    .locator('ion-select')
    .filter({
      has: page.getByRole('button', { name: new RegExp(`^${escapeForRegExp(label)}\\b`) }),
    })
    .first();

  await select.waitFor({ state: 'visible' });
  await select.click();

  const overlay = page.locator('ion-alert');
  await overlay.waitFor({ state: 'visible' });
  await overlay
    .getByRole('radio', { name: option })
    .or(overlay.getByRole('checkbox', { name: option }))
    .click();
  await overlay.getByRole('button', { name: 'OK' }).click();
  await overlay.waitFor({ state: 'hidden' });
}

/**
 * Choose one of an `ion-segment`'s options.
 *
 * The host element is clicked rather than the `role="tab"` button inside it:
 * the host sits above its own shadow content, so a click aimed at the inner
 * button is intercepted by the very element that contains it.
 */
export async function chooseSegment(page: Page, label: string): Promise<void> {
  await (await surface(page))
    .locator('ion-segment-button')
    .filter({ hasText: label })
    .click();
}

export async function tap(page: Page, text: string, screen?: string): Promise<void> {
  await (await surface(page, screen)).getByRole('button', { name: text }).first().click();
}

export async function goToTab(page: Page, name: string, screen: string): Promise<void> {
  // Screens pushed above the tabs — budgets, sync settings — hide the tab bar.
  // Coming back first is what a person does, and it keeps the specs from having
  // to know which screen they happen to be on.
  const bar = page.locator('ion-tab-bar');
  // Wait for the shell to exist before asking where we are: straight after an
  // unlock the tabs are still being created, and a premature check would send
  // us hunting for a back button that is not there either.
  await page.locator('ion-tab-bar, ion-back-button').first().waitFor({ state: 'attached' });

  if (!(await bar.isVisible())) {
    await page.locator('ion-back-button').first().click();
    await expect(bar).toBeVisible();
  }

  await bar.locator('ion-tab-button').filter({ hasText: name }).click();
  await waitForScreen(page, screen);
}

/**
 * Wait for an open editor modal to finish closing.
 *
 * Needed before asserting that something is *gone*, and before any reload.
 *
 * An editor closes only once its write has resolved, so a closed modal is the
 * signal that the change actually reached IndexedDB. Reloading before that can
 * cut the write off — a delete that looked done comes back.
 *
 * And while a modal is open, Ionic takes the page behind it out of the
 * accessibility tree, so `getByRole` scoped to that page matches nothing at
 * all. An assertion that a row has disappeared will pass the instant the modal
 * opens, for entirely the wrong reason, while the row is still in the DOM and
 * still in the database.
 */
export async function waitForEditorClosed(page: Page): Promise<void> {
  await expect(page.locator('ion-modal.show-modal')).toHaveCount(0);
}

export async function tapAdd(page: Page, screen: string): Promise<void> {
  await page.locator(`${screen} ion-fab-button`).click();
  // `.last()`: the sheet this just opened, which may be a sheet on a sheet —
  // the category manager opens over the picker, which is itself over the
  // transaction editor.
  await expect(page.locator('ion-modal.show-modal').last()).toBeVisible();
}

/** Create a vault and land on the summary screen. */
export async function createVault(
  page: Page,
  passphrase = PASSPHRASE,
  currency?: string,
): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Set up your vault')).toBeVisible();

  await fillField(page, 'Passphrase', passphrase, Screen.vault);
  await fillField(page, 'Confirm passphrase', passphrase, Screen.vault);
  if (currency) await chooseOption(page, 'Currency', currency, Screen.vault);
  await tap(page, 'Create vault', Screen.vault);

  await expect(page).toHaveURL(/\/tabs\/dashboard/);
  await waitForScreen(page, Screen.dashboard);
}

/** Enter a passphrase and submit. Does not assume the unlock succeeds. */
export async function unlock(page: Page, passphrase = PASSPHRASE): Promise<void> {
  await fillField(page, 'Passphrase', passphrase, Screen.vault);
  await tap(page, 'Unlock', Screen.vault);
}

/** Unlock and wait for the ledger to be on screen. */
export async function unlockToLedger(page: Page, passphrase = PASSPHRASE): Promise<void> {
  await unlock(page, passphrase);
  await expect(page).toHaveURL(/\/tabs\/dashboard/);
  await waitForScreen(page, Screen.dashboard);
}

export async function addAccount(page: Page, name: string, opening: string): Promise<void> {
  await goToTab(page, 'Accounts', Screen.accounts);
  await tapAdd(page, Screen.accounts);

  await fillField(page, 'Name', name);
  await fillField(page, 'Opening balance', opening);
  await tap(page, 'Save');

  // `exact`: a new vault is seeded with starter accounts, and "Current" would
  // otherwise also match "Current account".
  await expect(
    page.locator(Screen.accounts).getByRole('heading', { name, exact: true }),
  ).toBeVisible();
}

/**
 * Choose a category through the picker the transaction editor opens.
 *
 * Takes either a top-level name ("Groceries") or a path ("Groceries › Corner
 * shop"). Tapping a parent that has subcategories selects it and opens them
 * rather than closing, so where no subcategory was asked for the sheet is
 * closed explicitly.
 */
export async function chooseCategory(page: Page, path: string): Promise<void> {
  const [parent, child] = path.split('›').map((part) => part.trim());

  await (await surface(page)).locator('ion-item').filter({ hasText: 'Category' }).first().click();

  const picker = page.locator('app-category-picker');
  await picker.waitFor({ state: 'visible' });
  await picker.getByRole('button', { name: parent, exact: true }).click();

  if (child) {
    await picker.getByRole('button', { name: child, exact: true }).click();
  } else {
    // A category with no subcategories closes the sheet by itself; one with
    // subcategories opens them and waits. Rather than ask which it was — the
    // answer changes as a vault grows — give it a moment to close and only
    // press Close if it is still there.
    await picker
      .waitFor({ state: 'detached', timeout: 2_000 })
      .catch(() => picker.getByRole('button', { name: 'Close' }).click());
  }

  await expect(picker).toHaveCount(0);
}

export async function addExpense(
  page: Page,
  amount: string,
  payee: string,
  category?: string,
): Promise<void> {
  await goToTab(page, 'Activity', Screen.transactions);
  await tapAdd(page, Screen.transactions);

  await fillField(page, 'Amount', amount);
  if (category) await chooseCategory(page, category);
  await fillField(page, 'Payee', payee);
  await tap(page, 'Save');

  // `.first()`: the same payee may legitimately appear several times in a list.
  await expect(
    page.locator(Screen.transactions).getByRole('heading', { name: payee }).first(),
  ).toBeVisible();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A named card on the summary screen. */
export function summaryCard(page: Page, title: string): Locator {
  return page
    .locator(`${Screen.dashboard} ion-card`)
    .filter({ has: page.getByRole('heading', { name: title }) });
}
