// Proves what the end-to-end run is: the production build in the hermetic mode, one
// server per lot with its lot set explicitly, on a port that the system picks when the
// server starts, and two projects, a desktop and a phone, that run the Lot 1 specs
// against the Lot 1 server; beside them, a second start of that build for the journeys
// that change the account, in a project of their own; then the Lot 2 server, from a
// build of its own, and two projects that run the specs of e2e/lot2/ alone against it.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_ACCOUNT_INITIAL } from './e2e/fixtures/hermetic-server';

import type { SessionOptions } from './e2e/fixtures/test';
import type { PlaywrightTestConfig } from '@playwright/test';

// Where Next.js says it listens, as `next start --hostname 127.0.0.1 --port 0` prints it.
const LISTENING = '- Local:         http://127.0.0.1:43123';
// The schema of the server's environment, which a test outside src/ reads as text: the
// schema is server-only, and a tool imports a module only through its barrel.
const SCHEMA_FILE = path.join(import.meta.dirname, 'src/lib/env/server-env.ts');
const SHAPE_START = 'const serverEnvShape = {\n';
const SHAPE_END = '\n};\n';
// A variable of the schema, at the indent of its shape: "  LOG_LEVEL: z.enum(…)".
const DECLARED = /^ {2}(?<name>[A-Z][A-Z\d_]*):/gmu;
// The two variables that the servers set beside those of the schema: Next.js's own, and
// the harness's, which gives the Lot 2 build its folder.
const BESIDE_THE_SCHEMA: ReadonlySet<string> = new Set([
  'NEXT_TELEMETRY_DISABLED',
  'EGOSCOPE_E2E_LOT2_BUILD',
]);

/** The variables that the schema of src/lib/env/server-env.ts declares, in its order. */
function schemaVariables(): readonly string[] {
  const source = readFileSync(SCHEMA_FILE, 'utf8');
  const start = source.indexOf(SHAPE_START);
  const shape = source.slice(start, source.indexOf(SHAPE_END, start));
  return Array.from(shape.matchAll(DECLARED), (match) => match.groups?.['name'] ?? '');
}
// The environment of every hermetic server: every variable of the schema pinned empty, all
// the fakes, the account's dummy initial password, and no credential.
const HERMETIC_ENV = {
  ...Object.fromEntries(schemaVariables().map((name) => [name, ''])),
  EGOSCOPE_FAKES: 'all',
  EGOSCOPE_LOT: '1',
  EGOSCOPE_E2E_LOT2_BUILD: 'false',
  INITIAL_PASSWORD: TEST_ACCOUNT_INITIAL,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
};
// The same for the Lot 2 server, whose build goes to a folder of its own.
const LOT_2_ENV = { ...HERMETIC_ENV, EGOSCOPE_LOT: '2', EGOSCOPE_E2E_LOT2_BUILD: 'true' };

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
    vi.stubEnv('EGOSCOPE_E2E_LOT2_PORT', '');
  });

  it('builds and starts the hermetic server of Lot 1, with EGOSCOPE_LOT=1 set explicitly and no credential, then starts that build again for the account journeys, then builds and starts the one of Lot 2, with EGOSCOPE_LOT=2, into a folder of its own', async () => {
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
      {
        name: 'lot 2',
        command: 'next build && next start --hostname 127.0.0.1 --port 0',
        env: LOT_2_ENV,
        stdout: 'pipe',
        timeout: 300_000,
      },
    ]);
  });

  it('[TRV-64] pins every variable of the schema, so that no value of the shell or of .env.local reaches a hermetic server', async () => {
    const { webServer } = await loadConfig();
    const servers = Array.isArray(webServer) ? webServer : [];
    const pinned = servers.map(({ env = {} }) =>
      Object.keys(env).filter((name) => !BESIDE_THE_SCHEMA.has(name)),
    );

    expect(pinned).toStrictEqual([schemaVariables(), schemaVariables(), schemaVariables()]);
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
      [['egoscope_e2e_lot2_port', '43123']],
    ]);
  });

  it('runs every spec but those of Lot 2 and of the account journeys on a desktop and on a phone, in Chromium, against the Lot 1 server, signed in, and those of Lot 2 alone on both against the Lot 2 server', async () => {
    vi.stubEnv('EGOSCOPE_E2E_LOT1_PORT', '43123');
    vi.stubEnv('EGOSCOPE_E2E_ACCOUNT_PORT', '43124');
    vi.stubEnv('EGOSCOPE_E2E_LOT2_PORT', '43125');
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
      {
        name: 'desktop-lot2',
        testMatch: 'lot2/**/*.spec.ts',
        testIgnore: undefined,
        signedIn: undefined,
        baseURL: 'http://127.0.0.1:43125',
        browser: 'chromium',
        isMobile: false,
        hasTouch: false,
        colorScheme: 'light',
      },
      {
        name: 'phone-lot2',
        testMatch: 'lot2/**/*.spec.ts',
        testIgnore: undefined,
        signedIn: undefined,
        baseURL: 'http://127.0.0.1:43125',
        browser: 'chromium',
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      },
    ]);
  });

  it('gives the phone projects of both lots a phone-sized viewport', async () => {
    const { projects = [] } = await loadConfig();
    const phones = projects.filter(({ name }) => name === 'phone' || name === 'phone-lot2');

    expect(phones.map(({ use }) => use?.viewport)).toStrictEqual([
      { width: 412, height: 839 },
      { width: 412, height: 839 },
    ]);
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
});
