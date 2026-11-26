import { NavigationBar, navigationEntries } from '@/lib/navigation';

import { readTodoCount } from './actions';
import { signedInCountOrNone } from './signed-in-count';

import type { ReactNode } from 'react';

/**
 * The navigation bar of a signed-in owner, whose Home entry carries the number of items to
 * do (IHM-16, IHM-20), which the bar reads again at each move to another screen, since the
 * layout is not rendered again then; the bar alone, without a count, for any other request
 * and when the session check or the count fails.
 */
export async function SignedInNavigation(): Promise<ReactNode> {
  return (
    <NavigationBar
      entries={navigationEntries()}
      todoCount={await signedInCountOrNone()}
      readTodoCount={readTodoCount}
    />
  );
}
