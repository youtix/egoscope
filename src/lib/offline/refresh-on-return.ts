'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useEffectEvent } from 'react';

import { clearDeviceData } from './device-data';
import { REFRESH_COPIES_MESSAGE } from './screen-copies';
import { contactServer } from './server-contact';

// The one screen that the worker answers from its copy first, which the page then refreshes.
const HOME = '/';

/** Asks the worker that controls the page to reload every copy and replace each whole (CL-IHM-15). */
function refreshCopies(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  const { controller } = navigator.serviceWorker;
  if (controller !== null) {
    controller.postMessage(REFRESH_COPIES_MESSAGE);
  }
}

/**
 * Contacts the server as the app opens, each time the owner returns to it from another app
 * and when the network returns, never on a timer (IHM-04, CL-IHM-15): while the session is
 * open, the screen shown refreshes, Home as the app opens too since it showed its copy
 * first, and every copy is reloaded and replaced at each connection; a session that the
 * owner ended elsewhere has the device erase its data first (IHM-08, DSN-33), and a refused
 * session leads to the login page. Without an answer, the screen and the copies stay.
 */
export function useRefreshOnReturn(): void {
  const router = useRouter();
  const pathname = usePathname();

  // When the device contacts the server: as the app opens, as the owner returns to it, as
  // the network returns.
  const refresh = useEffectEvent(async (moment: 'open' | 'return' | 'reconnection') => {
    const contact = await contactServer();
    if (contact.kind === 'unavailable') {
      return;
    }
    if (contact.kind === 'refused') {
      if (contact.endedByOwner) {
        await clearDeviceData();
      }
      router.refresh();
      return;
    }
    if (moment !== 'return') {
      refreshCopies();
    }
    if (moment !== 'open' || pathname === HOME) {
      router.refresh();
    }
  });

  useEffect(() => {
    const returned = () => {
      if (document.visibilityState === 'visible') {
        void refresh('return');
      }
    };
    const reconnected = () => {
      void refresh('reconnection');
    };
    void refresh('open');
    document.addEventListener('visibilitychange', returned);
    globalThis.addEventListener('online', reconnected);
    return () => {
      document.removeEventListener('visibilitychange', returned);
      globalThis.removeEventListener('online', reconnected);
    };
  }, []);
}
