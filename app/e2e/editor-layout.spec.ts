import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  createVault,
  goToTab,
  summaryCard,
  tapAdd,
  waitForScreen,
} from './helpers';

/**
 * Every editor is presented inside an `ion-modal`, and a modal lays its page
 * out as a column flex container. A component host is `display: inline` by
 * default, so an editor that wraps its own `ion-header` and `ion-content` does
 * not become a flex child, `ion-content` collapses to a stub, and everything
 * below the first rows is clipped into a scroll region that ends mid-screen.
 *
 * The transaction editor shipped like that: it rendered its segment and nothing
 * else — no amount, no category, no payee, no date. Every functional test still
 * passed, because `fill()` types into an element whether or not a human could
 * see it. So this suite asserts the geometry directly: the content box has to
 * fill the modal, and everything the editor contains has to be reachable.
 */
async function expectFillsModal(page: Page, label: string): Promise<void> {
  const geometry = await page.evaluate(() => {
    const modal = document.querySelector('ion-modal.show-modal') as HTMLElement;
    const content = modal.querySelector('ion-content') as HTMLElement;
    const scroll = content.shadowRoot?.querySelector('.inner-scroll') as HTMLElement;
    return {
      modalHeight: Math.round(modal.getBoundingClientRect().height),
      contentHeight: Math.round(content.getBoundingClientRect().height),
      visible: scroll.clientHeight,
      needed: scroll.scrollHeight,
    };
  });

  // The content fills what the header leaves it, rather than collapsing.
  expect(geometry.contentHeight, `${label}: content collapsed`).toBeGreaterThan(
    geometry.modalHeight * 0.6,
  );
  // Nothing is stranded outside the scroll region.
  expect(geometry.visible, `${label}: content clipped`).toBeGreaterThanOrEqual(
    Math.min(geometry.needed, geometry.contentHeight),
  );
}

test.describe('editor layout', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
  });

  test('the account editor fills its modal', async ({ page }) => {
    await goToTab(page, 'Accounts', Screen.accounts);
    await tapAdd(page, Screen.accounts);
    await expectFillsModal(page, 'account');

    // The note under the fields is the only thing that says what an opening
    // balance is, and it was the first casualty when the layout collapsed.
    await expect(
      page.locator('ion-modal.show-modal').getByText('The opening balance is what'),
    ).toBeInViewport();
  });

  test('the group editor fills its modal', async ({ page }) => {
    await goToTab(page, 'Accounts', Screen.accounts);
    await page.locator(Screen.accounts).getByRole('link', { name: 'Account groups' }).click();
    await waitForScreen(page, 'app-account-groups');
    await tapAdd(page, 'app-account-groups');
    await expectFillsModal(page, 'group');
  });

  test('the transaction editor fills its modal, fields and all', async ({ page }) => {
    await addAccount(page, 'Everyday', '100');
    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await expectFillsModal(page, 'transaction');

    // This screen rendered its segment and nothing else. Assert the fields a
    // person needs are actually on screen, not merely in the DOM.
    const modal = page.locator('ion-modal.show-modal');
    await expect(modal.locator('ion-input[label="Amount"]')).toBeInViewport();
    await expect(modal.locator('ion-input[label="Payee"]')).toBeInViewport();
  });

  test('the budget editor fills its modal', async ({ page }) => {
    // Navigated in-app rather than by URL: a reload locks the vault on the web,
    // because the key is only ever held in memory there.
    await goToTab(page, 'Summary', Screen.dashboard);
    await summaryCard(page, 'Budgets').locator('ion-item').last().click();
    await waitForScreen(page, Screen.budgets);
    await tapAdd(page, Screen.budgets);
    await expectFillsModal(page, 'budget');
  });

  test('the recurring rule editor fills its modal', async ({ page }) => {
    await addAccount(page, 'Everyday', '100');
    await goToTab(page, 'Activity', Screen.transactions);
    await page.locator(Screen.transactions).getByRole('link', { name: 'Recurring' }).click();
    await waitForScreen(page, 'app-rules');
    await tapAdd(page, 'app-rules');
    await expectFillsModal(page, 'rule');
  });
});
