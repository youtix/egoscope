import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { applyNewVersion, hasNewVersion, watchForNewVersion } from './update';

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

/** A check of the worker's script that finds nothing new, answered after the current turn. */
async function checkScript(): Promise<void> {
  await Promise.resolve();
}

/** The registration of the app's worker, as the page sees it. */
class FakeRegistration extends EventTarget {
  active: FakeWorker | null;
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null;
  readonly update = vi.fn(checkScript);

  constructor(workers: Readonly<{ active: FakeWorker | null; waiting?: FakeWorker }>) {
    super();
    this.active = workers.active;
    this.waiting = workers.waiting ?? null;
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

/** The page, shown or hidden as the owner leaves the app and returns to it. */
function page() {
  const shown = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', shown);
  return (visibilityState: DocumentVisibilityState) => {
    shown.visibilityState = visibilityState;
    shown.dispatchEvent(new Event('visibilitychange'));
  };
}

describe('hasNewVersion', () => {
  it('[IHM-03] finds none while one worker runs, nor while the first one installs', () => {
    const running = new FakeRegistration({ active: new FakeWorker('activated') });
    const first = new FakeRegistration({ active: null, waiting: new FakeWorker('installed') });

    expect(hasNewVersion(running)).toBe(false);
    expect(hasNewVersion(first)).toBe(false);
  });

  it('[IHM-03] finds one when a new worker waits beside the running one', () => {
    const registration = new FakeRegistration({
      active: new FakeWorker('activated'),
      waiting: new FakeWorker('installed'),
    });

    expect(hasNewVersion(registration)).toBe(true);
  });
});

describe('watchForNewVersion', () => {
  it('[IHM-03] tells the banner once a new version is installed and waits', () => {
    page();
    const registration = new FakeRegistration({ active: new FakeWorker('activated') });
    const hasNewVersionNow = vi.fn(() => hasNewVersion(registration));
    watchForNewVersion(registration, hasNewVersionNow);

    registration.installNewWorker(new FakeWorker('installing'));

    expect(hasNewVersionNow.mock.results).toStrictEqual([{ type: 'return', value: true }]);
  });

  it('[IHM-03] tells the banner once a new version that was already installing as the watch began waits', () => {
    page();
    const installing = new FakeWorker('installing');
    const registration = new FakeRegistration({ active: new FakeWorker('activated') });
    registration.installing = installing;
    const hasNewVersionNow = vi.fn(() => hasNewVersion(registration));
    watchForNewVersion(registration, hasNewVersionNow);

    registration.installing = null;
    registration.waiting = installing;
    installing.moveTo('installed');

    expect(hasNewVersionNow.mock.results).toStrictEqual([{ type: 'return', value: true }]);
  });

  it('[IHM-03] tells the banner when the waiting version is applied from another tab', () => {
    page();
    const waiting = new FakeWorker('installed');
    const registration = new FakeRegistration({ active: new FakeWorker('activated'), waiting });
    const onChange = vi.fn();
    watchForNewVersion(registration, onChange);

    waiting.moveTo('activating');

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('[IHM-03] checks as the app opens and each time the owner returns to it, never while it is hidden', () => {
    const show = page();
    const registration = new FakeRegistration({ active: new FakeWorker('activated') });
    watchForNewVersion(registration, vi.fn());

    expect(registration.update).toHaveBeenCalledOnce();

    show('hidden');

    expect(registration.update).toHaveBeenCalledOnce();

    show('visible');

    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('[IHM-03] starts no timer', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    page();

    watchForNewVersion(new FakeRegistration({ active: new FakeWorker('activated') }), vi.fn());

    expect(vi.getTimerCount()).toBe(0);
  });

  // A rejection left unhandled fails the run.
  it('takes a check that fails without connection as no error', async () => {
    page();
    const registration = new FakeRegistration({ active: new FakeWorker('activated') });
    registration.update.mockRejectedValueOnce(new TypeError('Failed to update a ServiceWorker'));

    watchForNewVersion(registration, vi.fn());
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalledOnce());

    expect(hasNewVersion(registration)).toBe(false);
  });

  it('stops checking and telling once the banner stops watching', () => {
    const show = page();
    const waiting = new FakeWorker('installed');
    const registration = new FakeRegistration({ active: new FakeWorker('activated'), waiting });
    const onChange = vi.fn();
    const stop = watchForNewVersion(registration, onChange);

    stop();
    show('visible');
    waiting.moveTo('activating');
    registration.installNewWorker(new FakeWorker('installing'));

    expect(registration.update).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('applyNewVersion', () => {
  it('[IHM-03] tells the waiting worker to take over, and resolves once it did', async () => {
    const waiting = new FakeWorker('installed');
    const registration = new FakeRegistration({ active: new FakeWorker('activated'), waiting });

    const applied = applyNewVersion(registration);
    waiting.moveTo('activating');
    waiting.moveTo('activated');

    expect(await applied).toStrictEqual({ ok: true });
    expect(waiting.posted).toStrictEqual(['apply-new-version']);
  });

  it('says so when a newer version replaced the waiting one meanwhile', async () => {
    const waiting = new FakeWorker('installed');
    const registration = new FakeRegistration({ active: new FakeWorker('activated'), waiting });

    const applied = applyNewVersion(registration);
    waiting.moveTo('redundant');

    expect(await applied).toStrictEqual({ ok: false, error: 'replaced' });
  });

  it('says that no new version waits, and tells no worker anything', async () => {
    const active = new FakeWorker('activated');
    const registration = new FakeRegistration({ active });

    expect(await applyNewVersion(registration)).toStrictEqual({
      ok: false,
      error: 'no-new-version',
    });
    expect(active.posted).toStrictEqual([]);
  });
});
