import 'server-only';

import { io } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { paths } from '@/lib/navigation';
import { todoCount } from '@/lib/todo';

/**
 * The number of items to do, for an open session only, through the connection that the
 * session check already woke. Without an open session there is no count: the screen itself
 * sends the device to the login page, with its own path to come back to (IHM-10), which the
 * bar does not know, so the path given here is never followed. The check reads the clock,
 * so the count is read at request time only, never in a prerender.
 */
async function signedInTodoCount(): Promise<number | null> {
  await io();
  const session = await requireSession(paths.home());
  if (!session.ok) {
    return null;
  }
  const database = await getDb();
  return database.ok ? todoCount(database.db) : null;
}

/**
 * The number of items to do that the Home entry of the bar carries (IHM-16, IHM-20), or
 * none when the session check or the count fails: the count is only a badge, so the bar
 * stays and the screen below it answers for itself, with the error screen of the group
 * when the server fails it (edge case « Erreur du serveur »). The errors through which
 * Next.js controls the request go on to it.
 */
export async function signedInCountOrNone(): Promise<number | null> {
  try {
    return await signedInTodoCount();
  } catch (error) {
    unstable_rethrow(error);
    logger.error(
      'The navigation bar is shown without the number of items to do: the session check or the count failed.',
      { error },
    );
    return null;
  }
}
