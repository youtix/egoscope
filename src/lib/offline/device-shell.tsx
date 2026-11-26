'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { useLastScreen } from './last-screen';
import { OfflineBanner } from './offline-banner';
import { useRefreshOnReturn } from './refresh-on-return';
import { registerServiceWorker } from './register';
import { UpdateBanner } from './update-banner';

import type { ReactNode } from 'react';

// Home shows the update banner itself, in its system banners, in IHM-19's place.
const HOME = '/';

export type DeviceShellProps = Readonly<{
  /** The `display.timeZone` setting, in which the offline banner writes the date of a copy. */
  timeZone: string;
}>;

/**
 * The app-wide device pieces, mounted once in the authenticated layout (module map
 * section 2.1): the service worker's registration (TRV-21), the offline banner (IHM-57)
 * and the update banner (IHM-03), Home's excepted, the refresh on opening and on return
 * (IHM-04) and the return to the last screen (IHM-41). The banners stay at the bottom of
 * the screen, above the navigation bar, and take their place at its end.
 */
export function DeviceShell({ timeZone }: DeviceShellProps): ReactNode {
  const pathname = usePathname();
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  useRefreshOnReturn();
  useLastScreen();
  return (
    <div className="sticky bottom-28 z-10 mx-auto mb-28 flex w-full max-w-3xl min-w-0 flex-col gap-3 px-4 empty:hidden sm:px-6 lg:bottom-4 lg:mb-4">
      <OfflineBanner timeZone={timeZone} />
      {pathname !== HOME && <UpdateBanner />}
    </div>
  );
}
