import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasUnsentDeviceDrafts, usePasteDraft } from '@/lib/device-drafts';

import { clearDeviceData } from './device-data';

import type { DraftServer, DraftTarget } from '@/lib/device-drafts';

const SCREENS = 'egoscope-screens';
const SHELL = 'egoscope-shell-dpl_build1';
const IMPORT: DraftTarget = { kind: 'research_result', requestId: 1 };
const PASTED = 'EVENT 1: the Redwater Foxes forward changes agents.';

/** Runs `call` once the current turn ends, as the browser's storage answers. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** The device's cache storage, holding the copy of a screen and the files of the build. */
function deviceCaches() {
  const stores = new Map<string, Set<string>>([
    [SCREENS, new Set(['/players'])],
    [SHELL, new Set(['/offline'])],
  ]);
  vi.stubGlobal('caches', {
    delete: async (name: string) => later(() => stores.delete(name)),
  });
  return {
    names: () => Array.from(stores, ([name]) => name),
    holds: (name: string, url: string) => stores.get(name)?.has(url) ?? false,
  };
}

/** A call of a device offline, which never reaches the server. */
const offline = async () =>
  later(() => {
    throw new TypeError('Failed to fetch');
  });
const unreachable: DraftServer = { check: offline, load: offline, save: offline, discard: offline };

/** Opens the import screen's draft, and waits until the device has read it. */
async function openDraft() {
  const view = renderHook(() => usePasteDraft(IMPORT, unreachable));
  await waitFor(() => {
    expect(view.result.current.ready).toBe(true);
  });
  return view;
}

describe('clearDeviceData', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('[IHM-08] [IHM-59] [DSN-33] leaves on the device no copy of a screen, and keeps the files of the build, which hold no data, for the next login', async () => {
    const device = deviceCaches();

    await clearDeviceData();

    expect(device.names()).toStrictEqual([SHELL]);
    expect(device.holds(SCREENS, '/players')).toBe(false);
    expect(device.holds(SHELL, '/offline')).toBe(true);
  });

  it('[IHM-08] [DSN-33] [CL-IHM-10] leaves on the device no draft, even one that never reached the server', async () => {
    deviceCaches();
    const typed = await openDraft();
    act(() => {
      typed.result.current.change(PASTED);
    });
    await waitFor(async () => {
      expect(await hasUnsentDeviceDrafts()).toBe(true);
    });
    typed.unmount();

    await clearDeviceData();

    await expect(hasUnsentDeviceDrafts()).resolves.toBe(false);
    const reopened = await openDraft();
    expect(reopened.result.current.text).toBe('');
  });

  it('[IHM-08] [DSN-33] [CL-IHM-06] leaves nothing in the storage of the device, the last screen among it', async () => {
    deviceCaches();
    localStorage.setItem('egoscope.last-screen', '{"path":"/players/7","scrollY":640}');
    sessionStorage.setItem('egoscope.tab', 'stats');

    await clearDeviceData();

    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it('[IHM-08] erases a device that holds nothing yet without a fault', async () => {
    deviceCaches();
    await clearDeviceData();

    await expect(clearDeviceData()).resolves.toBeUndefined();
  });
});
