import { expect, test } from './fixtures';
import { createVault, Screen } from './helpers';

test('desktop navigation leaves the workspace interactive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createVault(page);
  const sidebar = page.getByRole('complementary', { name: 'Main navigation' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Summary', exact: true })).toHaveAttribute('aria-current', 'page');
  const bounds = await page.locator(`${Screen.dashboard} ion-content`).boundingBox();
  expect(bounds?.x).toBe(232);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(1440);
  await sidebar.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator(Screen.accounts)).toBeVisible();
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await expect(page.locator('ion-modal.show-modal')).toBeVisible();
  await expect(page.locator('ion-modal.show-modal ion-input[label="Name"] input')).toBeInViewport();
});

test('mobile summary fits the viewport and retains tab navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createVault(page);
  await expect(page.locator('ion-tab-bar')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeHidden();
  const overflow = await page.locator(`${Screen.dashboard} .dashboard-layout`).evaluate(el => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(false);
  await page.locator('ion-tab-button').filter({ hasText: 'Activity' }).click();
  await expect(page.locator(Screen.transactions)).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await expect(page.locator('ion-modal.show-modal')).toBeVisible();
});
