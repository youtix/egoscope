import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { hasUnsentDeviceDrafts, usePasteDraft } from '@/lib/device-drafts';

import type * as ServerContact from './server-contact';
import type * as Banner from './update-banner';
import type { DraftServer, DraftTarget } from '@/lib/device-drafts';

const reloaded = vi.hoisted(() => vi.fn<() => void>());

vi.mock(import('./reload'), () => ({ reloadPage: reloaded }));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const NEW_VERSION = 'New version available';
const RELOAD = 'Reload the app';
const WAITS_FOR_DRAFT = 'The app reloads once your draft is saved.';
const DRAFT_CHECK_INTERVAL_MS = 1000;
const IMPORT: DraftTarget = { kind: 'research_result', requestId: 1 };
const PASTED = 'EVENT 1: the Redwater Foxes forward changes agents.';

/** Runs `call` once the current turn ends, as an answer of the network does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** The browser looking for a new script of the worker, which finds none here. */
async function checkScript(): Promise<void> {
  await Promise.resolve();
}

/** A service worker of the browser, which moves through its states as the browser says. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  readonly posted: unknown[] = [];

  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  moveTo(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

/** The registration of the app's worker, as the page sees it. */
class FakeRegistration extends EventTarget {
  active: FakeWorker | null = new FakeWorker('activated');
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null;
  readonly update = vi.fn(checkScript);

  constructor(waiting: FakeWorker | null) {
    super();
    this.waiting = waiting;
  }

  /** The browser found a new script, and installs its worker beside the running one. */
  installNewWorker(worker: FakeWorker): void {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    this.installing = null;
    this.waiting = worker;
    worker.moveTo('installed');
  }
}

/** The browser's service workers, which register the app's worker once `registered` settles. */
function browserWorkers(registration: FakeRegistration, registered = Promise.resolve()) {
  const register = vi.fn(async () => {
    await registered;
    return registration;
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
  return register;
}

/** The server of the drafts, which saves a draft once `accept` is called. */
function draftServer() {
  const accepting = Promise.withResolvers<undefined>();
  const server: DraftServer = {
    check: async () => later(() => ({ withdrawnEventCount: 0, retentionDays: 7, copies: [] })),
    load: async () => later(() => null),
    save: async (upload) => {
      await accepting.promise;
      return {
        ok: true,
        value: { withdrawnEventCount: 0, wasWritten: true, updatedAt: upload.updatedAt },
      };
    },
    discard: async () => {
      await Promise.resolve();
    },
  };
  return {
    server,
    accept: () => {
      accepting.resolve(undefined);
    },
  };
}

/** The owner pasting a text on the import screen, which the device sends at once. */
async function pasteDraftBeingSent(server: DraftServer): Promise<void> {
  const view = renderHook(() => usePasteDraft(IMPORT, server));
  await waitFor(() => {
    expect(view.result.current.ready).toBe(true);
  });
  act(() => {
    view.result.current.change(PASTED);
  });
  await waitFor(async () => {
    expect(await hasUnsentDeviceDrafts()).toBe(true);
  });
}

/**
 * The checks of the banner coming at the pace that the test sets, from the next one on:
 * Testing Library waits by the DOM alone meanwhile, and Vitest's `vi.waitFor` moves the
 * checks on as it waits.
 */
function pacedDraftChecks(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

/** The draft reaching the server, which the device then marks as sent. */
async function draftSaved(accept: () => void): Promise<void> {
  accept();
  await vi.waitFor(async () => {
    expect(await hasUnsentDeviceDrafts()).toBe(false);
  });
}

/** The banner looking on the device, at its next check, whether the draft is saved. */
async function nextDraftCheck(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DRAFT_CHECK_INTERVAL_MS);
  });
}

describe('UpdateBanner', () => {
  let UpdateBanner: typeof Banner.UpdateBanner;
  let contactServer: typeof ServerContact.contactServer;

  beforeEach(async () => {
    // A fresh page: the builds that the page saw live as long as it does.
    vi.resetModules();
    ({ UpdateBanner } = await import('./update-banner'));
    ({ contactServer } = await import('./server-contact'));
    reloaded.mockClear();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  it('[IHM-03] offers to reload once a new version waits beside the running one', async () => {
    browserWorkers(new FakeRegistration(new FakeWorker('installed')));

    render(<UpdateBanner />);

    expect(await screen.findByRole('status')).toHaveTextContent(NEW_VERSION);
    expect(screen.getByRole('button', { name: RELOAD })).toBeEnabled();
  });

  it('[IHM-03] shows nothing while no new version waits, and offers it once the browser installs one', async () => {
    const registration = new FakeRegistration(null);
    const register = browserWorkers(registration);
    render(<UpdateBanner />);
    await waitFor(() => {
      expect(registration.update).toHaveBeenCalledOnce();
    });

    expect(register).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      registration.installNewWorker(new FakeWorker('installing'));
    });

    expect(await screen.findByRole('status')).toHaveTextContent(NEW_VERSION);
  });

  it('[IHM-03] reloads the app on the new version once the owner asks', async () => {
    const user = userEvent.setup();
    const waiting = new FakeWorker('installed');
    browserWorkers(new FakeRegistration(waiting));
    render(<UpdateBanner />);

    await user.click(await screen.findByRole('button', { name: RELOAD }));

    expect(waiting.posted).toStrictEqual(['apply-new-version']);
    expect(reloaded).not.toHaveBeenCalled();

    act(() => {
      waiting.moveTo('activated');
    });

    await waitFor(() => {
      expect(reloaded).toHaveBeenCalledOnce();
    });
  });

  it('[IHM-03] [CL-IHM-10] waits for a draft that has not reached the server, says so, and reloads by itself once it is saved', async () => {
    const user = userEvent.setup();
    const waiting = new FakeWorker('installed');
    browserWorkers(new FakeRegistration(waiting));
    const drafts = draftServer();
    await pasteDraftBeingSent(drafts.server);
    render(<UpdateBanner />);
    const reload = await screen.findByRole('button', { name: RELOAD });
    pacedDraftChecks();

    await user.click(reload);

    expect(await screen.findByText(WAITS_FOR_DRAFT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RELOAD })).toHaveAccessibleDescription(
      WAITS_FOR_DRAFT,
    );
    await nextDraftCheck();
    expect(waiting.posted).toStrictEqual([]);

    await draftSaved(drafts.accept);

    await vi.waitFor(() => {
      expect(waiting.posted).toStrictEqual(['apply-new-version']);
    });
  });

  it('[IHM-03] where no worker runs, offers to reload once the server runs another build, and reloads the page', async () => {
    const user = userEvent.setup();
    const builds = ['dpl_build1', 'dpl_build2'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => later(() => Response.json({ status: 'ok', version: builds.shift() }))),
    );
    render(<UpdateBanner />);
    await act(async () => {
      await contactServer();
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await act(async () => {
      await contactServer();
    });
    await user.click(await screen.findByRole('button', { name: RELOAD }));

    expect(reloaded).toHaveBeenCalledOnce();
  });

  it('[IHM-03] where no worker runs, waits for the network to reload by itself after the draft is saved', async () => {
    const user = userEvent.setup();
    const builds = ['dpl_build1', 'dpl_build2'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => later(() => Response.json({ status: 'ok', version: builds.shift() }))),
    );
    const drafts = draftServer();
    await pasteDraftBeingSent(drafts.server);
    render(<UpdateBanner />);
    await act(async () => {
      await contactServer();
      await contactServer();
    });
    const reload = await screen.findByRole('button', { name: RELOAD });
    pacedDraftChecks();
    await user.click(reload);
    await screen.findByText(WAITS_FOR_DRAFT);
    const isOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await draftSaved(drafts.accept);
    await nextDraftCheck();

    expect(reloaded).not.toHaveBeenCalled();

    isOnline.mockReturnValue(true);

    await vi.waitFor(() => {
      expect(reloaded).toHaveBeenCalledOnce();
    });
  });

  it('stops watching for a new version once the page no longer shows the banner, even before the worker is registered', async () => {
    const registered = Promise.withResolvers<undefined>();
    const registration = new FakeRegistration(null);
    const register = browserWorkers(registration, registered.promise);
    const view = render(<UpdateBanner />);
    await waitFor(() => {
      expect(register).toHaveBeenCalledOnce();
    });

    view.unmount();
    await act(async () => {
      registered.resolve(undefined);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('stops watching for a new version once the page no longer shows the banner', async () => {
    const registration = new FakeRegistration(null);
    browserWorkers(registration);
    const view = render(<UpdateBanner />);
    await waitFor(() => {
      expect(registration.update).toHaveBeenCalledOnce();
    });

    view.unmount();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(registration.update).toHaveBeenCalledOnce();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, as it offers to reload and as it waits for a draft', async () => {
    const user = userEvent.setup();
    browserWorkers(new FakeRegistration(new FakeWorker('installed')));
    await pasteDraftBeingSent(draftServer().server);
    const view = render(<UpdateBanner />);
    await screen.findByRole('status');

    await expect(axe.run(view.container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);

    await user.click(screen.getByRole('button', { name: RELOAD }));
    await screen.findByText(WAITS_FOR_DRAFT);

    await expect(axe.run(view.container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
