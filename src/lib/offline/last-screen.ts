'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

// The device's storage of the last screen shown and its scroll position (CL-IHM-06), which
// a logout erases with the rest (IHM-08).
const LAST_SCREEN_KEY = 'egoscope.last-screen';
// The address that the app opens on from its icon (src/app/manifest.ts) or its address.
const HOME = '/';

type LastScreen = Readonly<{ path: string; scrollY: number }>;

const currentPath = (): string => `${location.pathname}${location.search}`;

/** Keeps the screen shown and its scroll position, as the app leaves the foreground. */
function keepLastScreen(): void {
  const last: LastScreen = { path: currentPath(), scrollY: Math.round(globalThis.scrollY) };
  localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify(last));
}

/** Whether `path` is an address of this app, never of another site. */
const isAppPath = (path: string): boolean => path.startsWith(HOME) && !path.startsWith('//');

/** Whether `value` is a last screen as `keepLastScreen` keeps it. */
function isLastScreen(value: unknown): value is LastScreen {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    'scrollY' in value &&
    typeof value.path === 'string' &&
    isAppPath(value.path) &&
    typeof value.scrollY === 'number'
  );
}

/** The last screen that the device kept, or null when it holds none or something else. */
function keptLastScreen(): LastScreen | null {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(LAST_SCREEN_KEY) ?? 'null');
    return isLastScreen(kept) ? { path: kept.path, scrollY: kept.scrollY } : null;
  } catch {
    return null;
  }
}

/**
 * Whether this page opens the app: a document loaded at Home, from the app's icon or its
 * address, and still there; never a reload, a move back, a link to another screen, which
 * opens its target, nor the move to Home after a login, which opens the screen asked for
 * (IHM-11).
 */
function isOpeningTheApp(): boolean {
  const [entry] = performance.getEntriesByType('navigation');
  return (
    currentPath() === HOME &&
    entry?.name === location.href &&
    'type' in entry &&
    entry.type === 'navigate'
  );
}

/**
 * Brings the owner back where they were (IHM-41, CL-IHM-06): the app keeps the screen
 * shown and its scroll position each time it leaves the foreground, and when it opens on
 * Home again, even after the phone closed it in the background, it shows that screen at
 * that position. A device that holds none, after installation or a logout, stays on Home.
 */
export function useLastScreen(): void {
  const router = useRouter();
  const pathname = usePathname();
  const restoring = useRef<LastScreen | null>(null);

  useEffect(() => {
    const last = keptLastScreen();
    if (last !== null && isOpeningTheApp()) {
      restoring.current = last;
      if (last.path !== HOME) {
        router.replace(last.path, { scroll: false });
      }
    }
    const left = () => {
      if (document.visibilityState === 'hidden') {
        keepLastScreen();
      }
    };
    document.addEventListener('visibilitychange', left);
    globalThis.addEventListener('pagehide', keepLastScreen);
    return () => {
      document.removeEventListener('visibilitychange', left);
      globalThis.removeEventListener('pagehide', keepLastScreen);
    };
  }, [router]);

  useEffect(() => {
    const last = restoring.current;
    if (currentPath() !== last?.path) {
      return;
    }
    restoring.current = null;
    globalThis.scrollTo(0, last.scrollY);
  }, [pathname]);
}
