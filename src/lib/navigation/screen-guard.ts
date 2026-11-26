import 'server-only';

import { io } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { recordDatabaseActivity } from '@/lib/quotas';

import type { Session } from '@/lib/auth';
import type { Route } from 'next';

/**
 * Records the minute's database activity of an authenticated page for the compute
 * estimate (TRV-03, TRV-04, operations.md section 1.17), through the connection that the
 * session check just woke, so that the record costs no wake-up (TRV-08). A record that
 * fails is logged and leaves the screen to read its own data; the errors through which
 * Next.js controls the request go on to it.
 */
async function recordPageActivity(): Promise<void> {
  try {
    const database = await getDb();
    if (database.ok) {
      await recordDatabaseActivity(database.db);
    }
  } catch (error) {
    unstable_rethrow(error);
    logger.error("The minute's database activity of the page could not be recorded.", {
      error,
    });
  }
}

/**
 * The session check that every screen runs first, with its own path (module map section 7):
 * the open session of the device, once the page's minute of database activity is recorded
 * (TRV-03, TRV-04); otherwise the login page, which returns to `path` once the owner has
 * logged in (IHM-10, IHM-11), or the "Choose your password" screen while the account uses
 * its initial password (TRV-57). A server that cannot check sessions, without a database
 * or an initial password, is a deployment fault, which the error screen shows. The check
 * reads the clock, so it runs at request time only, never in a prerender.
 */
export async function guardScreen(path: string): Promise<Session> {
  await io();
  const session = await requireSession(path);
  if (session.ok) {
    await recordPageActivity();
    return session.value;
  }
  const refusal = session.error;
  if (refusal.kind === 'log-in' || refusal.kind === 'choose-password') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth writes the target, a login or choose-password address, as a string, and those (auth) routes do not exist until F-access, so typed routes cannot check it
    redirect(refusal.redirect as Route);
  }
  throw new Error(`The server cannot check sessions: ${refusal.kind}.`);
}
