import { act, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { usePathname, useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { DeviceShell } from './device-shell';

import type { Mock } from 'vitest';

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const NEW_VERSION = 'New version available';
const WITHOUT_COPY = 'Offline — this screen is not available offline.';

/** Runs `call` once the current turn ends, as an answer of the browser does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** The browser's service workers, where a new version of the app waits beside the running one. */
function browserWorkers(): Mock<(url: string, options: unknown) => Promise<unknown>> {
  const waiting = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), {
    active: new EventTarget(),
    installing: null,
    waiting,
    update: async () => later(() => undefined),
  });
  const register = vi
    .fn<(url: string, options: unknown) => Promise<unknown>>()
    .mockResolvedValue(registration);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: null, register },
  });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
  return register;
}

describe('DeviceShell', () => {
  let health: Mock<typeof fetch>;

  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/players');
    vi.mocked(useRouter).mockReturnValue({
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
      push: vi.fn(),
      refresh: vi.fn(),
      replace: vi.fn(),
    });
    health = vi.fn<typeof fetch>(async () =>
      later(() => Response.json({ status: 'ok', version: 'dpl_build1' })),
    );
    vi.stubGlobal('fetch', health);
    vi.stubGlobal('caches', {
      open: async () => later(() => ({ match: async () => later(() => undefined) })),
    });
    // The document that the browser loaded at the screen shown.
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ name: location.href, type: 'navigate' }],
    });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    Reflect.deleteProperty(performance, 'getEntriesByType');
  });

  it('[TRV-21] [IHM-03] [IHM-04] registers the worker over the whole app, contacts the server, and offers the new version on a screen other than Home', async () => {
    const register = browserWorkers();

    render(<DeviceShell timeZone="Europe/Paris" />);

    expect(await screen.findByRole('status')).toHaveTextContent(NEW_VERSION);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(health).toHaveBeenCalledExactlyOnceWith('/api/health', { cache: 'no-store' });
  });

  it('[IHM-03] leaves the new version to the system banners of Home', async () => {
    vi.mocked(usePathname).mockReturnValue('/');
    const register = browserWorkers();

    render(<DeviceShell timeZone="Europe/Paris" />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText(NEW_VERSION)).not.toBeInTheDocument();
  });

  it('[IHM-57] [CA-TRV-38] shows the offline banner as the device loses its connection', async () => {
    render(<DeviceShell timeZone="Europe/Paris" />);

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });

    expect(await screen.findByRole('status')).toHaveTextContent(WITHOUT_COPY);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules with both banners', async () => {
    browserWorkers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const view = render(<DeviceShell timeZone="Europe/Paris" />);

    await screen.findByText(NEW_VERSION);
    await screen.findByText(WITHOUT_COPY);

    await expect(axe.run(view.container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
