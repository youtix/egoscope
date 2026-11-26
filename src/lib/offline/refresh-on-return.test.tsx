import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { usePathname, useRouter } from 'next/navigation';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { useRefreshOnReturn } from './refresh-on-return';

import type { Mock } from 'vitest';

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}));

const SCREENS = 'egoscope-screens';
const OPEN = { status: 200, body: { status: 'ok', version: 'dpl_build1' } };
const LAST_SCREEN = '{"path":"/players/7","scrollY":640}';
const DAY_MS = 86_400_000;

type Answer = Readonly<{ status: number; body: unknown }>;

/** Runs `call` once the current turn ends, as the cache storage of the browser does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** The server, which answers /api/health with `answer`, or never when the device is offline. */
function server(answer: Answer | 'offline'): Mock<typeof fetch> {
  const health = vi.fn<typeof fetch>(async () =>
    answer === 'offline'
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Response.json(answer.body, { status: answer.status }),
  );
  vi.stubGlobal('fetch', health);
  return health;
}

/** The worker that controls the page, which receives the page's messages, or none. */
function worker(controller: 'none' | 'not yet' | 'running'): Mock<(message: unknown) => void> {
  const postMessage = vi.fn<(message: unknown) => void>();
  if (controller !== 'none') {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: controller === 'running' ? { postMessage } : null },
    });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    });
  }
  return postMessage;
}

/** The owner leaving the app for another one, then coming back. */
function leaveAndReturn(): void {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  visibility.mockReturnValue('visible');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Lets the contact in flight settle: its answer, then what the page does of it. */
async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

describe('useRefreshOnReturn', () => {
  let refresh: Mock<() => void>;

  beforeEach(() => {
    refresh = vi.fn<() => void>();
    vi.mocked(useRouter).mockReturnValue({
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
      push: vi.fn(),
      refresh,
      replace: vi.fn(),
    });
    vi.mocked(usePathname).mockReturnValue('/players');
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
  });

  it('[IHM-04] [CL-IHM-15] as the app opens, reloads every copy, and leaves a screen that the server has just drawn', async () => {
    const health = server(OPEN);
    const postMessage = worker('running');

    renderHook(() => {
      useRefreshOnReturn();
    });

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledExactlyOnceWith('refresh-copies');
    });
    expect(health).toHaveBeenCalledExactlyOnceWith('/api/health', { cache: 'no-store' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('[IHM-04] [CL-IHM-06] as the app opens on Home, which the worker answered from its copy, refreshes it', async () => {
    vi.mocked(usePathname).mockReturnValue('/');
    server(OPEN);
    const postMessage = worker('running');

    renderHook(() => {
      useRefreshOnReturn();
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith('refresh-copies');
  });

  it('[IHM-04] as the owner returns from another app, refreshes the screen and leaves the copies', async () => {
    const health = server(OPEN);
    const postMessage = worker('running');
    renderHook(() => {
      useRefreshOnReturn();
    });
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledOnce();
    });

    leaveAndReturn();

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(health).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('[IHM-04] [CL-IHM-15] as the network returns, refreshes the screen and reloads every copy', async () => {
    server(OPEN);
    const postMessage = worker('running');
    renderHook(() => {
      useRefreshOnReturn();
    });
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledOnce();
    });

    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('[IHM-04] contacts the server at no other moment, never on a timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const health = server(OPEN);
    renderHook(() => {
      useRefreshOnReturn();
    });
    await vi.waitFor(() => {
      expect(health).toHaveBeenCalledOnce();
    });

    await vi.advanceTimersByTimeAsync(DAY_MS);

    expect(health).toHaveBeenCalledOnce();
  });

  it('[IHM-08] [DSN-33] [CL-IHM-10] erases the data of the device after a session that the owner ended elsewhere, then leads to the login page', async () => {
    server({ status: 401, body: { status: 'unauthorized', ended: 'password_changed' } });
    const postMessage = worker('running');
    const names = new Set([SCREENS, 'egoscope-shell-dpl_build1']);
    vi.stubGlobal('caches', { delete: async (name: string) => later(() => names.delete(name)) });
    localStorage.setItem('egoscope.last-screen', LAST_SCREEN);
    let wasErasedFirst = false;
    refresh.mockImplementation(() => {
      wasErasedFirst = localStorage.length === 0 && !names.has(SCREENS);
    });

    renderHook(() => {
      useRefreshOnReturn();
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(wasErasedFirst).toBe(true);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('[IHM-08] [IHM-42] leads an expired session to the login page and erases nothing', async () => {
    server({ status: 401, body: { status: 'unauthorized', ended: 'expired' } });
    const postMessage = worker('running');
    localStorage.setItem('egoscope.last-screen', LAST_SCREEN);

    renderHook(() => {
      useRefreshOnReturn();
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    expect(localStorage.getItem('egoscope.last-screen')).toBe(LAST_SCREEN);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('[IHM-57] without an answer, leaves the screen and the copies as they are', async () => {
    const health = server('offline');
    const postMessage = worker('running');
    renderHook(() => {
      useRefreshOnReturn();
    });

    leaveAndReturn();
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    await settled();

    expect(health).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each(['none', 'not yet'] as const)(
    '[IHM-04] refreshes Home as the app opens in a browser whose page no worker controls: %s',
    async (controller) => {
      vi.mocked(usePathname).mockReturnValue('/');
      server(OPEN);
      worker(controller);

      renderHook(() => {
        useRefreshOnReturn();
      });

      await waitFor(() => {
        expect(refresh).toHaveBeenCalledOnce();
      });
    },
  );

  it('stops contacting the server once the page no longer shows the app', async () => {
    const health = server(OPEN);
    const view = renderHook(() => {
      useRefreshOnReturn();
    });
    await waitFor(() => {
      expect(health).toHaveBeenCalledOnce();
    });
    view.unmount();

    leaveAndReturn();
    globalThis.dispatchEvent(new Event('online'));
    await settled();

    expect(health).toHaveBeenCalledOnce();
  });
});
