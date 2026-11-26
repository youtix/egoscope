/**
 * The hermetic servers of the end-to-end tests, one per lot, and the one of the
 * journeys that change the account: the production build, started on a port that
 * the system picks, with every outside service a fake and no real credential.
 * playwright.config.ts declares them.
 */
import type { PlaywrightTestConfig } from '@playwright/test';

/** A lot of the application: 1, or 2 for the specs under e2e/lot2/. */
export type Lot = 1 | 2;

type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]>;

// Five minutes: a cold production build on a busy machine, then the start.
const BUILD_AND_START_MS = 300_000;
// One minute: the start of a build that is already there.
const START_MS = 60_000;
// Where Next.js says it listens, the port in the group named after its variable.
const listening = (variable: string): RegExp =>
  new RegExp(String.raw`- Local:\s+http://127\.0\.0\.1:(?<${variable.toLowerCase()}>\d+)`, 'u');

/**
 * The initial password of the account of every hermetic server, a dummy that no
 * deployment holds: the session control and the account journeys log in with it.
 */
export const TEST_ACCOUNT_INITIAL = 'hermetic-initial-of-the-test-account';

// Every variable of the schema of src/lib/env/server-env.ts, in its order, which an e2e
// helper cannot import: the schema is server-only. playwright.config.test.ts fails when
// the schema declares a variable that this list lacks.
const SCHEMA_VARIABLES = [
  'LOG_LEVEL',
  'NODE_ENV',
  'VERCEL_ENV',
  'VERCEL_DEPLOYMENT_ID',
  'APP_BASE_URL',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'CRON_SECRET',
  'INITIAL_PASSWORD',
  'FINGERPRINT_KEY',
  'BACKUP_GITHUB_REPOSITORY',
  'BACKUP_GITHUB_TOKEN',
  'BACKUP_ENCRYPTION_KEY',
  'STATS_SOURCE_BASE_URL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_AI_API_TOKEN',
  'GROQ_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'EGOSCOPE_LOT',
  'EGOSCOPE_FAKES',
];

// The folder of each lot's build, since a build prerenders the screens of its own lot
// only (IHM-16): two folders, so that both servers run side by side, the Lot 2 one
// inside .next/, which git and every tool already skip.
const BUILD_DIRS: Readonly<Record<Lot, string>> = { 1: '.next', 2: '.next/lot2' };

/** The variable that holds the port of the server of `lot`, once it listens. */
const portVariable = (lot: Lot): string => `EGOSCOPE_E2E_LOT${String(lot)}_PORT`;
// The variable that holds the port of the server of the account journeys.
const ACCOUNT_PORT = 'EGOSCOPE_E2E_ACCOUNT_PORT';

/**
 * The environment of the hermetic server of `lot`, whatever the shell exports
 * or an env file says: every variable of the schema is set, since Next.js loads
 * no env file over a variable that is set, and the server reads an empty value
 * as unset. So no credential, no address and no key of a developer's .env.local
 * reaches it, and the fakes switch stands beside no real credential (TRV-64).
 */
export function hermeticEnvironment(lot: Lot): Readonly<Record<string, string>> {
  return {
    // No real credential, no Vercel deployment, the default log level.
    ...Object.fromEntries(SCHEMA_VARIABLES.map((name) => [name, ''])),
    // Every outside service is a fake, and without a database URL the database
    // is PGlite in memory: each start of the server is a fresh database.
    EGOSCOPE_FAKES: 'all',
    // Set explicitly, so that a change of the default lot changes nothing here.
    EGOSCOPE_LOT: String(lot),
    // The folder of the lot's build, which next.config.ts reads, `next build` and `next start` alike.
    EGOSCOPE_E2E_BUILD_DIR: BUILD_DIRS[lot],
    // The account starts from it, as a deployment's does from its own (TRV-57).
    INITIAL_PASSWORD: TEST_ACCOUNT_INITIAL,
    NODE_ENV: 'production',
    // Next.js reports its use to an outside service too, unless told not to.
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/** The address of the server of `lot`, known once the server listens. */
export function serverUrl(lot: Lot): string {
  return `http://127.0.0.1:${process.env[portVariable(lot)] ?? '0'}`;
}

/**
 * The web server of `lot`: `next build`, then `next start` on a port that the
 * system picks, so that runs in other worktrees never collide. Playwright reads
 * the port from the line where Next.js says where it listens, into the variable
 * that `serverUrl` reads in the workers it starts afterwards.
 */
export function hermeticServer(lot: Lot): WebServer {
  return {
    name: `lot ${String(lot)}`,
    command: 'next build && next start --hostname 127.0.0.1 --port 0',
    env: { ...hermeticEnvironment(lot) },
    wait: { stdout: listening(portVariable(lot)) },
    // What the build and the server print, so that a failure explains itself.
    stdout: 'pipe',
    timeout: BUILD_AND_START_MS,
  };
}

/** The address of the server of the account journeys, known once it listens. */
export function accountServerUrl(): string {
  return `http://127.0.0.1:${process.env[ACCOUNT_PORT] ?? '0'}`;
}

/**
 * The web server of the journeys that change the account (a lockout, the choice of
 * the password, the sessions that end): a second `next start` of the Lot 1 build,
 * which Playwright starts once the Lot 1 server listens, with an account of its own
 * in a database of its own, so that these journeys never end the sessions of the
 * other specs nor lock them out.
 */
export function accountServer(): WebServer {
  return {
    name: 'account journeys',
    command: 'next start --hostname 127.0.0.1 --port 0',
    env: { ...hermeticEnvironment(1) },
    wait: { stdout: listening(ACCOUNT_PORT) },
    stdout: 'pipe',
    timeout: START_MS,
  };
}
