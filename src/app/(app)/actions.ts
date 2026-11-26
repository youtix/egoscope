'use server';

import { signedInCountOrNone } from './signed-in-count';

/**
 * The number of items to do now, which the navigation bar asks for once each time the owner
 * moves to another screen, never on a timer (IHM-16, module map section 3.1): it checks the
 * session, as every Server Action does (module map section 1.5), and gives none without an
 * open session or when the count fails.
 */
export async function readTodoCount(): Promise<number | null> {
  return signedInCountOrNone();
}
