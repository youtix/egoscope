// Proves what the end-to-end run is: the production build in the hermetic mode, one
// server per lot with its lot set explicitly, on a port that the system picks when the
// server starts, and two projects, a desktop and a phone, that run the Lot 1 specs
// against the Lot 1 server; beside them, a second start of that build for the journeys
// that change the account, in a project of their own; with the slot of the Lot 2 server
// and projects kept.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_ACCOUNT_INITIAL } from './e2e/fixtures/hermetic-server';

import type { SessionOptions } from './e2e/fixtures/test';
import type { PlaywrightTestConfig } from '@playwright/test';

// Where Next.js says it listens, as `next start --hostname 127.0.0.1 --port 0` prints it.
const LISTENING = '- Local:         http://127.0.0.1:43123';
// The environment of every hermetic server: all the fakes, the account's dummy initial
// password, and no credential.
const HERMETIC_ENV = {
  EGOSCOPE_FAKES: 'all',
  EGOSCOPE_LOT: '1',
  INITIAL_PASSWORD: TEST_ACCOUNT_INITIAL,
  DATABASE_URL: '',
  DATABASE_URL_UNPOOLED: '',
  VERCEL_ENV: '',
  LOG_LEVEL: '',
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
};

/** The configuration, as Playwright loads it in a process whose environment is stubbed. */
async function loadConfig(): Promise<PlaywrightTestConfig<SessionOptions>> {
  vi.resetModules();
  const { default: config } = await import('./playwright.config');
  return config;
}

describe('playwright.config.ts', () => {
  beforeEach(() => {
    vi.stubEnv('CI', '');
    vi.stubEnv('EGOSCOPE_E2E_LOT1_PORT', '');
    vi.stubEnv('EGOSCOPE_E2E_ACCOUNT_PORT', '');
  });

  it('builds and starts the hermetic server of Lot 1, with EGOSCOPE_LOT=1 set explicitly and no credential, then starts that build again for the account journeys', async () => {
    const { webServer } = await loadConfig();
    const servers = Array.isArray(webServer) ? webServer : [];

    expect(
      servers.map(({ name, command, env, stdout, timeout }) => ({
        name,
        command,
        env,
        stdout,
        timeout,
      })),
    ).toStrictEqual([
      {
        name: 'lot 1',
        command: 'next build && next start --hostname 127.0.0.1 --port 0',
        env: HERMETIC_ENV,
        stdout: 'pipe',
        timeout: 300_000,
      },
      {
        name: 'account journeys',
        command: 'next start --hostname 127.0.0.1 --port 0',
        env: HERMETIC_ENV,
        stdout: 'pipe',
        timeout: 60_000,
      },
    ]);
  });

  it('reads the port that the system picked for each server from what Next.js prints, into the variable that the projects read', async () => {
    const { webServer } = await loadConfig();
    const servers = Array.isArray(webServer) ? webServer : [];

    // Playwright stores each named group in the variable of its name in capitals.
    expect(
      servers.map(({ wait }) => Object.entries(wait?.stdout?.exec(LISTENING)?.groups ?? {})),
    ).toStrictEqual([
      [['egoscope_e2e_lot1_port', '43123']],
      [['egoscope_e2e_account_port', '43123']],
    ]);
  });

  it('runs every spec but those of Lot 2 and of the account journeys on a desktop and on a phone, in Chromium, against the Lot 1 server, signed in', async () => {
    vi.stubEnv('EGOSCOPE_E2E_LOT1_PORT', '43123');
    vi.stubEnv('EGOSCOPE_E2E_ACCOUNT_PORT', '43124');
    const { projects = [] } = await loadConfig();

    expect(
      projects.map(({ name, testMatch, testIgnore, use = {} }) => ({
        name,
        testMatch,
        testIgnore,
        signedIn: use.signedIn,
        baseURL: use.baseURL,
        browser: use.defaultBrowserType,
        isMobile: use.isMobile,
        hasTouch: use.hasTouch,
        colorScheme: use.colorScheme,
      })),
    ).toStrictEqual([
      {
        name: 'desktop',
        testMatch: undefined,
        testIgnore: ['lot2/**', 'account/**'],
        signedIn: undefined,
        baseURL: 'http://127.0.0.1:43123',
        browser: 'chromium',
        isMobile: false,
        hasTouch: false,
        colorScheme: 'light',
      },
      {
        name: 'phone',
        testMatch: undefined,
        testIgnore: ['lot2/**', 'account/**', 'hermetic-guard.spec.ts'],
        signedIn: undefined,
        baseURL: 'http://127.0.0.1:43123',
        browser: 'chromium',
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      },
      {
        name: 'account',
        testMatch: 'account/**/*.spec.ts',
        testIgnore: undefined,
        signedIn: false,
        baseURL: 'http://127.0.0.1:43124',
        browser: 'chromium',
        isMobile: false,
        hasTouch: false,
        colorScheme: 'light',
      },
    ]);
  });

  it('gives the phone project a phone-sized viewport', async () => {
    const { projects = [] } = await loadConfig();
    const phone = projects.find(({ name }) => name === 'phone');

    expect(phone?.use?.viewport).toStrictEqual({ width: 412, height: 839 });
  });

  it('runs the production build of the specs of e2e/ only, never a focused test, and retries none', async () => {
    const config = await loadConfig();

    expect(config).toMatchObject({
      testDir: 'e2e',
      testMatch: '**/*.spec.ts',
      forbidOnly: true,
      retries: 0,
    });
  });

  it('writes the report and the results of the failed tests under reports/, which no tool reads', async () => {
    const { outputDir, reporter } = await loadConfig();

    expect({ outputDir, reporter }).toStrictEqual({
      outputDir: 'reports/e2e/results',
      reporter: [['list'], ['html', { open: 'never', outputFolder: 'reports/e2e/report' }]],
    });
  });

  it('keeps the commented slot of the Lot 2 server and of the projects that run e2e/lot2/ on it', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'playwright.config.ts'), 'utf8');

    expect(source).toContain('    // hermeticServer(2),\n');
    expect(source).toContain(
      "    // { name: 'desktop-lot2', testMatch: `${LOT_2_SPECS}/*.spec.ts`, use: { ...DESKTOP, baseURL: serverUrl(2) } },\n",
    );
    expect(source).toContain(
      "    // { name: 'phone-lot2', testMatch: `${LOT_2_SPECS}/*.spec.ts`, use: { ...PHONE, baseURL: serverUrl(2) } },\n",
    );
  });
});
