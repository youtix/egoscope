import 'server-only';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';

import type { Session } from '@/lib/auth';
import type { Route } from 'next';

/**
 * The session check that every screen runs first, with its own path (module map section 7):
 * the open session of the device; otherwise the login page, which returns to `path` once
 * the owner has logged in (IHM-10, IHM-11), or the "Choose your password" screen while the
 * account uses its initial password (TRV-57). A server that cannot check sessions, without
 * a database or an initial password, is a deployment fault, which the error screen shows.
 */
export async function guardScreen(path: string): Promise<Session> {
  const session = await requireSession(path);
  if (session.ok) {
    return session.value;
  }
  const refusal = session.error;
  if (refusal.kind === 'log-in' || refusal.kind === 'choose-password') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth writes the target, a login or choose-password address, as a string, and those (auth) routes do not exist until F-access, so typed routes cannot check it
    redirect(refusal.redirect as Route);
  }
  throw new Error(`The server cannot check sessions: ${refusal.kind}.`);
}
