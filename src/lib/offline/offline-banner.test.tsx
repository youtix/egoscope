import { act, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { usePathname } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OfflineBanner } from './offline-banner';

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePathname: vi.fn(),
}));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const SCREENS = 'egoscope-screens';
const COPIED_AT = 'x-egoscope-copied-at';
// Thursday 26 November 2026 at 13:03 UTC: 14:03 in Paris, 08:03 in New York.
const COPIED_ON_THURSDAY = Date.UTC(2026, 10, 26, 13, 3);
const COPIED_ON_FRIDAY = Date.UTC(2026, 10, 27, 7, 45);
const WITHOUT_COPY = 'Offline — this screen is not available offline.';

/** Runs `call` once the current turn ends, as the cache storage of the browser does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** A read of the cache storage that nothing holds back. */
async function readAtOnce(): Promise<void> {
  await Promise.resolve();
}

/** The device's cache storage, whose copies of the screens answer once `reading` lets them. */
function deviceCaches(reading: (url: string) => Promise<void> = readAtOnce) {
  const stores = new Map<string, Map<string, Response>>([[SCREENS, new Map()]]);
  vi.stubGlobal('caches', {
    open: async (name: string) =>
      later(() => ({
        match: async (url: string) => {
          await reading(url);
          return stores.get(name)?.get(url)?.clone();
        },
      })),
  });
  return {
    /** Keeps a copy of `path`, taken at `copiedAt`. */
    keep: (path: string, copiedAt: number) => {
      stores
        .get(SCREENS)
        ?.set(
          new URL(path, location.origin).href,
          new Response('<main>The copy</main>', { headers: { [COPIED_AT]: String(copiedAt) } }),
        );
    },
  };
}

/** The device losing or finding its connection, as the browser says it. */
function connection(isOnline: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(isOnline);
  act(() => {
    globalThis.dispatchEvent(new Event(isOnline ? 'online' : 'offline'));
  });
}

/** The owner opening `path` in the app. */
function visit(path: string): void {
  vi.mocked(usePathname).mockReturnValue(path);
  history.pushState(null, '', path);
}

describe('the offline banner', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    visit('/players');
  });

  afterEach(() => {
    visit('/');
  });

  it('[IHM-57] [CA-TRV-38] offline, writes over a kept screen the date of its copy, in the owner zone', async () => {
    deviceCaches().keep('/players', COPIED_ON_THURSDAY);
    const { unmount } = render(<OfflineBanner timeZone="Europe/Paris" />);
    connection(false);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Offline — data from Thu 26 Nov 2026 at 14:03',
    );

    unmount();
    render(<OfflineBanner timeZone="America/New_York" />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Offline — data from Thu 26 Nov 2026 at 08:03',
    );
  });

  it('[IHM-57] offline, says that a screen of which the device keeps no copy is not available offline', async () => {
    deviceCaches().keep('/more', COPIED_ON_THURSDAY);
    render(<OfflineBanner timeZone="Europe/Paris" />);
    connection(false);

    expect(await screen.findByRole('status')).toHaveTextContent(WITHOUT_COPY);
  });

  it('[IHM-57] shows nothing online, and goes once the connection returns', async () => {
    deviceCaches().keep('/players', COPIED_ON_THURSDAY);
    render(<OfflineBanner timeZone="Europe/Paris" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    connection(false);
    expect(await screen.findByRole('status')).toBeInTheDocument();

    connection(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('[IHM-57] dates each screen by its own copy, never by that of the screen left', async () => {
    const device = deviceCaches();
    device.keep('/players', COPIED_ON_THURSDAY);
    device.keep('/more', COPIED_ON_FRIDAY);
    const view = render(<OfflineBanner timeZone="Europe/Paris" />);
    connection(false);
    expect(await screen.findByRole('status')).toHaveTextContent('Thu 26 Nov 2026 at 14:03');

    visit('/cases/7');
    view.rerender(<OfflineBanner timeZone="Europe/Paris" />);

    expect(screen.queryByText(/Thu 26 Nov 2026/u)).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(WITHOUT_COPY);

    visit('/more');
    view.rerender(<OfflineBanner timeZone="Europe/Paris" />);

    expect(await screen.findByText(/Fri 27 Nov 2026 at 08:45/u)).toBeInTheDocument();
  });

  it('[IHM-57] keeps the date of the screen shown when the copy of the screen left is read after it', async () => {
    const pending = new Map<string, () => void>();
    const device = deviceCaches(
      async (url) =>
        new Promise<void>((resolve) => {
          pending.set(new URL(url).pathname, resolve);
        }),
    );
    device.keep('/players', COPIED_ON_THURSDAY);
    device.keep('/more', COPIED_ON_FRIDAY);
    const view = render(<OfflineBanner timeZone="Europe/Paris" />);
    connection(false);
    visit('/more');
    view.rerender(<OfflineBanner timeZone="Europe/Paris" />);
    await waitFor(() => {
      expect(Array.from(pending, ([path]) => path)).toStrictEqual(['/players', '/more']);
    });

    await act(async () => {
      pending.get('/more')?.();
      await Promise.resolve();
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Fri 27 Nov 2026 at 08:45');

    await act(async () => {
      pending.get('/players')?.();
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('Fri 27 Nov 2026 at 08:45');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules with a copy and without one', async () => {
    deviceCaches().keep('/players', COPIED_ON_THURSDAY);
    const view = render(<OfflineBanner timeZone="Europe/Paris" />);
    connection(false);
    await screen.findByText(/Thu 26 Nov 2026/u);

    await expect(axe.run(view.container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);

    visit('/more');
    view.rerender(<OfflineBanner timeZone="Europe/Paris" />);
    await screen.findByText(WITHOUT_COPY);

    await expect(axe.run(view.container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
