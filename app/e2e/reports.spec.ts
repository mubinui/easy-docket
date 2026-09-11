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

const REPORTS = 'app-reports';

async function openReports(page: import('@playwright/test').Page) {
  await goToTab(page, 'Summary', Screen.dashboard);
  await summaryCard(page, 'Where it went').getByRole('heading', { name: 'Reports' }).click();
  await expect(page.locator(REPORTS)).toBeVisible();
}

test.describe('reports', () => {
  test.beforeEach(async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Everyday', '1000.00');
  });

  test('says there is nothing to report before anything is recorded', async ({ page }) => {
    await openReports(page);

    await expect(page.getByText(/Record a few transactions/)).toBeVisible();
    // Charts are counted by their figure wrapper: Ionic renders every icon as
    // an <svg> too, so a bare svg count would never be zero.
    await expect(page.locator(`${REPORTS} figure`)).toHaveCount(0);
  });

  test('charts the ledger once there is one', async ({ page }) => {
    await addExpense(page, '40.00', 'Supermarket', 'Groceries');
    await openReports(page);

    // Scoped: the Summary screen behind this one has cards of the same name.
    const reports = page.locator(REPORTS);
    await expect(reports.getByRole('heading', { name: 'Where it went' })).toBeVisible();
    await expect(reports.getByRole('heading', { name: 'In and out' })).toBeVisible();
    await expect(reports.getByRole('heading', { name: 'Net worth' })).toBeVisible();

    // Two plots and a figure: with a single month of history net worth is a
    // number, not a trend, so that card shows the value rather than a lone dot
    // in an empty plot.
    await expect(page.locator(`${REPORTS} figure svg`)).toHaveCount(2);
    await expect(reports.getByText('not enough history for a trend yet')).toBeVisible();

    // The chart itself, not its table twin, which also carries the name.
    await expect(reports.locator('figure').getByText('Groceries')).toBeVisible();
  });

  test('totals the range, and names a shortfall as one', async ({ page }) => {
    await addExpense(page, '40.00', 'Supermarket', 'Groceries');
    await openReports(page);

    await expect(page.locator(REPORTS).getByText('$40.00').first()).toBeVisible();
    // Spending with no income is an overspend, and should say so.
    await expect(page.locator(REPORTS).getByText('overspent')).toBeVisible();
  });

  test('lists top payees', async ({ page }) => {
    await addExpense(page, '40.00', 'Supermarket', 'Groceries');
    await addExpense(page, '12.00', 'Supermarket', 'Groceries');
    await addExpense(page, '8.00', 'Bakery', 'Groceries');
    await openReports(page);

    const payees = page.locator(REPORTS).locator('ion-card').filter({
      has: page.getByRole('heading', { name: 'Top payees' }),
    });
    await expect(payees.getByText('Supermarket')).toBeVisible();
    await expect(payees.getByText('$52.00')).toBeVisible();
    await expect(payees.getByText('2 payments')).toBeVisible();
  });

  test('one filter row scopes every card', async ({ page }) => {
    await addExpense(page, '40.00', 'Supermarket', 'Groceries');
    await openReports(page);

    await chooseSegment(page, 'Last 12 months');

    await expect(page.locator(REPORTS).getByText('Last 12 months').first()).toBeVisible();
    // Twelve monthly buckets in the flow chart, not one.
    await expect(page.locator(REPORTS).getByText('$40.00').first()).toBeVisible();
  });

  test('reveals the table twins on request', async ({ page }) => {
    await addExpense(page, '40.00', 'Supermarket', 'Groceries');
    await openReports(page);

    // The table is in the DOM all along for assistive technology, clipped out
    // of sight until asked for — so the check is the clipping class, not
    // visibility: a 1px clipped element still has a box.
    const table = page.locator(`${REPORTS} table`).first();
    await expect(table).toHaveClass(/visually-hidden/);

    await tap(page, 'Show data');
    await expect(table).not.toHaveClass(/visually-hidden/);
    await expect(table.getByText('Groceries')).toBeVisible();
  });

  test('exports the current view as CSV', async ({ page }) => {
    await addExpense(page, '40.00', 'Supermarket', 'Groceries');
    await openReports(page);

    const download = page.waitForEvent('download');
    await tap(page, 'Export CSV');
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^easy-docket-report-\d{4}-\d{2}-\d{2}-to-/);

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');

    expect(csv).toContain('Section,Item,Amount (USD),Count');
    expect(csv).toContain('Category,Groceries,40.00,1');
    expect(csv).toContain('Payee,Supermarket,40.00,1');
  });
});
