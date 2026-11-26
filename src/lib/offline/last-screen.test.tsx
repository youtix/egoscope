import { act, renderHook } from '@testing-library/react';
import { usePathname, useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { useLastScreen } from './last-screen';

import type { Mock } from 'vitest';

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}));

const LAST_SCREEN_KEY = 'egoscope.last-screen';
const PLAYER = '/players/7?view=season';
const SCROLLED_Y = 640;

/** The owner showing `path` in the app, as the router of Next.js moves to it. */
function show(path: string): void {
  history.replaceState(null, '', path);
  vi.mocked(usePathname).mockReturnValue(new URL(path, location.origin).pathname);
}

/**
 * The way the browser loaded the document, at `loaded`: a navigation, a reload, a move back,
 * or none that it tells.
 */
function opened(type: 'navigate' | 'reload' | 'back_forward' | 'none', loaded = '/'): void {
  const entry = { name: new URL(loaded, location.origin).href, type };
  Object.defineProperty(performance, 'getEntriesByType', {
    configurable: true,
    value: (kind: string) => (kind === 'navigation' && type !== 'none' ? [entry] : []),
  });
  onTestFinished(() => {
    Reflect.deleteProperty(performance, 'getEntriesByType');
  });
}

/** The page going to the background, as the owner switches to another app, or back. */
function visibility(state: 'hidden' | 'visible'): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function kept(): unknown {
  return JSON.parse(localStorage.getItem(LAST_SCREEN_KEY) ?? 'null');
}

describe('useLastScreen', () => {
  let replace: Mock<(path: string, options: unknown) => void>;
  let scrollTo: Mock<(x: number, y: number) => void>;

  beforeEach(() => {
    replace = vi.fn<(path: string, options: unknown) => void>();
    // One router for the life of the page, as Next.js gives it.
    const router = {
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
      push: vi.fn(),
      refresh: vi.fn(),
      replace,
    };
    vi.mocked(useRouter).mockReturnValue(router);
    scrollTo = vi.fn<(x: number, y: number) => void>();
    vi.stubGlobal('scrollTo', scrollTo);
    localStorage.clear();
    show('/');
  });

  afterEach(() => {
    show('/');
  });

  it('[IHM-41] [CA-IHM-06] [CL-IHM-06] keeps the screen shown and its scroll position each time the app leaves the foreground', () => {
    opened('navigate');
    show(PLAYER);
    vi.stubGlobal('scrollY', SCROLLED_Y + 0.4);
    renderHook(() => {
      useLastScreen();
    });

    visibility('hidden');

    expect(kept()).toStrictEqual({ path: PLAYER, scrollY: SCROLLED_Y });

    vi.stubGlobal('scrollY', 0);
    visibility('visible');

    expect(kept()).toStrictEqual({ path: PLAYER, scrollY: SCROLLED_Y });
  });

  it('[IHM-41] [CL-IHM-06] keeps the screen as the phone closes the page', () => {
    opened('navigate');
    show('/more');
    vi.stubGlobal('scrollY', 120);
    renderHook(() => {
      useLastScreen();
    });

    act(() => {
      globalThis.dispatchEvent(new Event('pagehide'));
    });

    expect(kept()).toStrictEqual({ path: '/more', scrollY: 120 });
  });

  it('[IHM-41] [CA-IHM-06] [CL-IHM-06] reopened on Home, shows the last screen at its scroll position', () => {
    localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify({ path: PLAYER, scrollY: SCROLLED_Y }));
    opened('navigate');
    const view = renderHook(() => {
      useLastScreen();
    });

    expect(replace).toHaveBeenCalledExactlyOnceWith(PLAYER, { scroll: false });
    expect(scrollTo).not.toHaveBeenCalled();

    show(PLAYER);
    view.rerender();

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, SCROLLED_Y);

    show('/players');
    view.rerender();
    show(PLAYER);
    view.rerender();

    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('[IHM-41] [CL-IHM-06] reopened on Home that it left, scrolls Home back where it was', () => {
    localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify({ path: '/', scrollY: 300 }));
    opened('navigate');

    renderHook(() => {
      useLastScreen();
    });

    expect(replace).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 300);
  });

  it.each(['reload', 'back_forward', 'none'] as const)(
    '[IHM-41] [IHM-11] leaves the page where the browser put it, which it opened by a %s',
    (type) => {
      localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify({ path: PLAYER, scrollY: SCROLLED_Y }));
      opened(type);

      renderHook(() => {
        useLastScreen();
      });

      expect(replace).not.toHaveBeenCalled();
      expect(scrollTo).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a link that names a screen', '/alerts/3', '/alerts/3'],
    ['a login, which opens the screen asked for', '/log-in?next=%2F', '/'],
  ])(
    '[IHM-41] [IHM-11] opens the screen that the owner asked for after %s, never the last one',
    (_case, loaded, shown) => {
      localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify({ path: PLAYER, scrollY: SCROLLED_Y }));
      opened('navigate', loaded);
      show(shown);

      renderHook(() => {
        useLastScreen();
      });

      expect(replace).not.toHaveBeenCalled();
      expect(scrollTo).not.toHaveBeenCalled();
    },
  );

  it('[IHM-41] [IHM-08] stays on Home when the device keeps no screen, after installation or a logout', () => {
    opened('navigate');

    renderHook(() => {
      useLastScreen();
    });

    expect(replace).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each([
    ['an address of another site', JSON.stringify({ path: '//elsewhere.example/', scrollY: 0 })],
    ['an absolute address', JSON.stringify({ path: 'https://elsewhere.example/', scrollY: 0 })],
    ['a position that is no number', JSON.stringify({ path: PLAYER, scrollY: '640' })],
    ['a path that is no text', JSON.stringify({ path: 7, scrollY: 0 })],
    ['a record without a position', JSON.stringify({ path: PLAYER })],
    ['a record without a path', JSON.stringify({ scrollY: 0 })],
    ['a value that is no record', JSON.stringify(PLAYER)],
    ['a broken record', '{"path":'],
  ])('[IHM-41] stays on Home when the device keeps %s', (_case, value) => {
    localStorage.setItem(LAST_SCREEN_KEY, value);
    opened('navigate');

    renderHook(() => {
      useLastScreen();
    });

    expect(replace).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('stops keeping the screen once the page no longer shows the app', () => {
    opened('navigate');
    show('/more');
    const view = renderHook(() => {
      useLastScreen();
    });
    view.unmount();

    visibility('hidden');
    globalThis.dispatchEvent(new Event('pagehide'));

    expect(kept()).toBeNull();
  });
});
