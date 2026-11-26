import { Suspense } from 'react';

import { NavigationBar, navigationEntries } from '@/lib/navigation';

import { DevicePieces } from './device-pieces';
import { SignedInNavigation } from './signed-in-navigation';

import type { ReactNode } from 'react';

/**
 * The shell of every authenticated screen (module map section 1.4): the navigation bar, at
 * the bottom on a phone and on the side on a large screen, its count streamed in once the
 * session is checked, then the screen in one column that never scrolls sideways (IHM-01,
 * IHM-16). Each screen checks the session first, with its own path.
 */
export default function AppLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <div className="lg:pl-56">
      <Suspense fallback={<NavigationBar entries={navigationEntries()} todoCount={null} />}>
        <SignedInNavigation />
      </Suspense>
      <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 pt-6 pb-28 sm:px-6 lg:pb-10">
        {children}
      </main>
      {/* --- Slot: the run check at app opening, which F-tasks fills (TRV-25, TRV-31) --- */}

      {/* The app-wide device pieces (module map §2.1), once the session is checked */}
      <Suspense fallback={null}>
        <DevicePieces />
      </Suspense>
    </div>
  );
}
