import { defineConfig, devices } from '@playwright/test';

import { hermeticServer, serverUrl } from './e2e/fixtures/hermetic-server';

// Several agents share one small machine: locally, the tests use at most half the
// cores. CI runners are dedicated, so CI keeps Playwright's default.
const isCi = process.env['CI'] === 'true';

// Each spec runs on the server of its own lot only.
const LOT_2_SPECS = 'lot2/**';
// The guard spec starts servers of its own and opens no page: one project runs it.
const GUARD_SPEC = 'hermetic-guard.spec.ts';

// The two themes that the app follows (IHM-63), one per device: every page that a
// spec visits is checked in both.
const DESKTOP = { ...devices['Desktop Chrome'], colorScheme: 'light' } as const;
const PHONE = { ...devices['Pixel 7'], colorScheme: 'dark' } as const;

/**
 * The end-to-end tests: the production build of the app, in the hermetic mode, in
 * Chromium on a desktop and on a phone, with one server per lot. `bun run e2e`
 * runs them; CLAUDE.md, "End-to-end tests", gives the conventions.
 */
export default defineConfig({
  testDir: 'e2e',
  // Vitest owns the .test.ts suffix.
  testMatch: '**/*.spec.ts',
  forbidOnly: true,
  retries: 0,
  ...(!isCi && { workers: '50%' }),
  reporter: [[isCi ? 'github' : 'list'], ['html', { open: 'never' }]],
  use: {
    // The device's language and time zone, the app's defaults, on every machine.
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    hermeticServer(1),
    // --- Slot: the Lot 2 server, which the Lot 2 task fills ---------------------------
    // A second hermetic server, with EGOSCOPE_LOT=2, on a port of its own. Its build
    // needs a folder of its own beside .next/, which next.config.ts does not offer yet.
    // hermeticServer(2),
  ],
  projects: [
    {
      name: 'desktop',
      testIgnore: [LOT_2_SPECS],
      use: { ...DESKTOP, baseURL: serverUrl(1) },
    },
    {
      name: 'phone',
      testIgnore: [LOT_2_SPECS, GUARD_SPEC],
      use: { ...PHONE, baseURL: serverUrl(1) },
    },
    // --- Slot: the Lot 2 projects, which the Lot 2 task fills -------------------------
    // The specs under e2e/lot2/, and only those, on the desktop and on the phone, against
    // the Lot 2 server:
    // { name: 'desktop-lot2', testMatch: `${LOT_2_SPECS}/*.spec.ts`, use: { ...DESKTOP, baseURL: serverUrl(2) } },
    // { name: 'phone-lot2', testMatch: `${LOT_2_SPECS}/*.spec.ts`, use: { ...PHONE, baseURL: serverUrl(2) } },
  ],
});
