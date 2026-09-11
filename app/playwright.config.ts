import { defineConfig, devices } from '@playwright/test';
import { prepareStorage } from './e2e/prepare-storage';

/**
 * End-to-end tests against the built PWA in a real browser.
 *
 * These exist because the unit suites cannot see the things that actually broke
 * during development: a signal bound with `[(ngModel)]`, a Dexie query against
 * an unindexed field, a server with no CORS headers. Every one of those built,
 * linted and unit-tested cleanly, and every one of them made the app unusable.
 *
 * Two servers are started: the static PWA, and the Go sync server it replicates
 * to. Running the real server rather than a mock is the point — the sync spec
 * inspects what lands on its disk to prove the zero-knowledge guarantee end to
 * end, which no amount of mocking could establish.
 */
const PWA_PORT = 4599;
const API_PORT = 8099;

export const config = {
  pwaOrigin: `http://localhost:${PWA_PORT}`,
  apiOrigin: `http://localhost:${API_PORT}`,
  /** Fixed so the tokens file can be written ahead of time; see global-setup.ts. */
  apiToken: 'e2e-test-token-not-a-secret',
  dataDir: '.e2e-data',
};

// Runs before the webServer processes below, which is the point: the sync
// server will not start without a tokens file.
prepareStorage(config.dataDir, config.apiToken);

export default defineConfig({
  testDir: './e2e',
  // Ionic's page transitions and Dexie's liveQuery are both asynchronous;
  // web-first assertions retry, but they need room to do it.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: config.pwaOrigin,
    // The app refuses to run without WebCrypto, which needs a secure origin.
    // localhost qualifies, so no certificate juggling is required.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chrome',
      // The installed Chrome rather than a downloaded Chromium: it is what the
      // PWA will actually be used in, and it keeps CI from fetching a browser
      // build on every run.
      use: { ...devices['Pixel 7'], channel: 'chrome' },
    },
  ],

  webServer: [
    {
      command: `npx http-server www -p ${PWA_PORT} --silent -c-1`,
      url: config.pwaOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'go run ./cmd/docket-sync serve',
      cwd: '../server',
      url: `${config.apiOrigin}/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DOCKET_ADDR: `:${API_PORT}`,
        DOCKET_DATA_DIR: `${process.cwd()}/${config.dataDir}/objects`,
        DOCKET_TOKENS_FILE: `${process.cwd()}/${config.dataDir}/tokens`,
        DOCKET_ALLOWED_ORIGINS: config.pwaOrigin,
        DOCKET_LOG_LEVEL: 'warn',
      },
    },
  ],
});
