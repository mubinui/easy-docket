import { test as base } from '@playwright/test';

/**
 * The project's Playwright fixture.
 *
 * Ionic animates every page transition, which means a freshly-navigated screen
 * spends a few hundred milliseconds underneath the one it is replacing. That is
 * correct behaviour and miserable to test against: a click lands on the old
 * page's router outlet and Playwright retries until it times out.
 *
 * Setting `window.Ionic.config` before the bundle loads turns transitions off
 * for the test run only. Nothing in the app is changed to accommodate the
 * tests, which matters — a suite that needs production code bent towards it
 * stops being evidence about production.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as unknown as { Ionic: { config: Record<string, unknown> } }).Ionic = {
        config: { animated: false },
      };
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
