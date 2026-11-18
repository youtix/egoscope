/**
 * The hermetic servers of the end-to-end tests, one per lot: the production
 * build, started on a port that the system picks, with every outside service a
 * fake and no real credential. playwright.config.ts declares them.
 */
import type { PlaywrightTestConfig } from '@playwright/test';

/** A lot of the application: 1, or 2 for the specs under e2e/lot2/. */
export type Lot = 1 | 2;

type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]>;

// Five minutes: a cold production build on a busy machine, then the start.
const BUILD_AND_START_MS = 300_000;

/** The variable that holds the port of the server of `lot`, once it listens. */
const portVariable = (lot: Lot): string => `EGOSCOPE_E2E_LOT${String(lot)}_PORT`;

/**
 * The environment of the hermetic server of `lot`, whatever the shell exports
 * or an env file says: Next.js loads no env file over a variable that is set,
 * and the server reads an empty value as unset.
 */
export function hermeticEnvironment(lot: Lot): Readonly<Record<string, string>> {
  return {
    // Every outside service is a fake, and without a database URL the database
    // is PGlite in memory: each start of the server is a fresh database.
    EGOSCOPE_FAKES: 'all',
    // Set explicitly, so that a change of the default lot changes nothing here.
    EGOSCOPE_LOT: String(lot),
    // No real credential, no Vercel deployment, the default log level.
    DATABASE_URL: '',
    DATABASE_URL_UNPOOLED: '',
    VERCEL_ENV: '',
    LOG_LEVEL: '',
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
  const port = portVariable(lot).toLowerCase();
  return {
    name: `lot ${String(lot)}`,
    command: 'next build && next start --hostname 127.0.0.1 --port 0',
    env: { ...hermeticEnvironment(lot) },
    wait: { stdout: new RegExp(String.raw`- Local:\s+http://127\.0\.0\.1:(?<${port}>\d+)`, 'u') },
    // What the build and the server print, so that a failure explains itself.
    stdout: 'pipe',
    timeout: BUILD_AND_START_MS,
  };
}
