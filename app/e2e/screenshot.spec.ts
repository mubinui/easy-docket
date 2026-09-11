import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  addExpense,
  chooseSegment,
  createVault,
  fillField,
  goToTab,
  summaryCard,
  tap,
  tapAdd,
} from './helpers';

/**
 * Not an assertion — a way to look at the reports screen on real data, in both
 * themes. Runs only when REPORT_SHOTS names a directory.
 */
const OUT = process.env['REPORT_SHOTS'];

test.describe('report screenshots', () => {
  test.skip(!OUT, 'REPORT_SHOTS not set');

  test('captures the reports screen', async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '2400.00');

    for (const [amount, payee, category] of [
      ['240.00', 'Supermarket', 'Groceries'],
      ['86.50', 'Supermarket', 'Groceries'],
      ['54.00', 'Corner Bistro', 'Eating out'],
      ['38.20', 'Metro card', 'Transport'],
      ['119.00', 'Electricity', 'Utilities'],
      ['12.99', 'Streaming', 'Entertainment'],
    ] as const) {
      await addExpense(page, amount, payee, category);
    }

    await goToTab(page, 'Activity', Screen.transactions);
    await tapAdd(page, Screen.transactions);
    await chooseSegment(page, 'Income');
    await fillField(page, 'Amount', '3200.00');
    await fillField(page, 'Payee', 'Salary');
    await tap(page, 'Save');

    await goToTab(page, 'Summary', Screen.dashboard);
    await summaryCard(page, 'Where it went').getByRole('heading', { name: 'Reports' }).click();
    await expect(page.locator('app-reports')).toBeVisible();
    await page.waitForTimeout(500);

    // ion-content scrolls internally, so a full-page capture stops at the
    // viewport; scroll its own container to reach the lower cards.
    const scrollTo = async (offset: number) => {
      await page.evaluate(async (top) => {
        const content = document.querySelector('app-reports ion-content') as HTMLIonContentElement;
        await content.scrollToPoint(0, top, 0);
      }, offset);
      await page.waitForTimeout(250);
    };

    await page.screenshot({ path: `${OUT}/reports-light-top.png` });
    await scrollTo(1400);
    await page.screenshot({ path: `${OUT}/reports-light-bottom.png` });

    await page.evaluate(() => document.documentElement.classList.add('ion-palette-dark'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/reports-dark-bottom.png` });
    await scrollTo(0);
    await page.screenshot({ path: `${OUT}/reports-dark-top.png` });
  });
});
