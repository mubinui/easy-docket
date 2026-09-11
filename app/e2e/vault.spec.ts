import { expect, test } from './fixtures';
import { PASSPHRASE, Screen, createVault, fillField, tap, unlock } from './helpers';

/**
 * The vault is the one screen every user meets, and the one place where being
 * wrong means losing a ledger. These tests hold the promises the unlock screen
 * makes in words.
 */
test.describe('vault', () => {
  test('a new install offers to create a vault', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/vault/);
    await expect(page.getByText('Set up your vault')).toBeVisible();
    // The web build is honest about where the key lives; that copy is a promise.
    await expect(page.getByText(/held in memory for this session only/)).toBeVisible();
  });

  test('creating a vault opens the ledger', async ({ page }) => {
    await createVault(page);
    await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
  });

  test('refuses a passphrase too short to be worth anything', async ({ page }) => {
    await page.goto('/');
    await fillField(page, 'Passphrase', 'short', Screen.vault);
    await fillField(page, 'Confirm passphrase', 'short', Screen.vault);
    await tap(page, 'Create vault', Screen.vault);

    await expect(page.getByText(/at least 8 characters/)).toBeVisible();
    await expect(page).toHaveURL(/\/vault/);
  });

  test('refuses mismatched passphrases', async ({ page }) => {
    await page.goto('/');
    await fillField(page, 'Passphrase', PASSPHRASE, Screen.vault);
    await fillField(page, 'Confirm passphrase', 'something else entirely', Screen.vault);
    await tap(page, 'Create vault', Screen.vault);

    await expect(page.getByText(/do not match/)).toBeVisible();
  });

  test('locks on reload, because the web has nowhere to keep the key', async ({ page }) => {
    await createVault(page);
    await page.reload();

    await expect(page).toHaveURL(/\/vault/);
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('unlocks with the right passphrase and not the wrong one', async ({ page }) => {
    await createVault(page);
    await page.reload();

    await unlock(page, 'not the passphrase');
    await expect(page.getByText(/Incorrect passphrase/)).toBeVisible();
    await expect(page).toHaveURL(/\/vault/);

    await unlock(page);
    await expect(page).toHaveURL(/\/tabs\/dashboard/);
  });

  test('keeps the ledger across a lock and unlock', async ({ page }) => {
    await createVault(page);
    await page.reload();
    await unlock(page);

    await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
  });
});
