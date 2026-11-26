// The detection of a new version of the app. Each deployment builds a new service worker
// (next.config.ts), which the browser finds when it checks the worker's script, installs
// beside the running one and keeps waiting. The update banner of F-offline reads it here,
// and applies it once no draft is unsaved (IHM-03). It runs in the browser only.

/** The message that tells a waiting worker to take over, which src/app/sw.ts answers. */
export const APPLY_NEW_VERSION_MESSAGE = 'apply-new-version';

type VersionWorker = Pick<ServiceWorker, 'addEventListener' | 'postMessage' | 'state'>;

/** The parts of the worker's registration (`registerServiceWorker`) that the detection uses. */
export type VersionRegistration = Readonly<{
  active: VersionWorker | null;
  installing: VersionWorker | null;
  waiting: VersionWorker | null;
  addEventListener: ServiceWorkerRegistration['addEventListener'];
  update: () => Promise<unknown>;
}>;

/**
 * Whether a new version of the app is installed and waits for the running one to give
 * way: a worker that waits beside the active one (IHM-03). The first worker, which takes
 * over at once, is no new version.
 */
export function hasNewVersion(registration: VersionRegistration): boolean {
  return registration.waiting !== null && registration.active !== null;
}

/**
 * Asks the browser to check the worker's script, which installs a new version when the
 * script changed.
 */
async function checkForNewVersion(registration: VersionRegistration): Promise<void> {
  try {
    await registration.update();
  } catch {
    // Offline, the check fails; the next one runs when the owner returns to the app.
  }
}

/**
 * Checks for a new version now, as the app opens, and each time the owner returns to it,
 * never on a timer; calls `onChange` each time the answer of `hasNewVersion` may have
 * changed: a new version installed, applied or replaced (IHM-03). Returns the function
 * that stops watching.
 */
export function watchForNewVersion(
  registration: VersionRegistration,
  onChange: () => void,
): () => void {
  const watching = new AbortController();
  const { signal } = watching;
  registration.waiting?.addEventListener('statechange', onChange, { signal });
  registration.addEventListener(
    'updatefound',
    () => registration.installing?.addEventListener('statechange', onChange, { signal }),
    { signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') {
        void checkForNewVersion(registration);
      }
    },
    { signal },
  );
  void checkForNewVersion(registration);
  return () => watching.abort();
}

/**
 * Why a new version was not applied: none waits, or a newer one replaced it meanwhile,
 * which the browser then installs in its turn.
 */
export type ApplyError = 'no-new-version' | 'replaced';

/** The new version took over, or why it did not. */
export type ApplyResult = Readonly<{ ok: true }> | Readonly<{ ok: false; error: ApplyError }>;

/**
 * Applies the new version: the waiting worker takes over from the running one, and the
 * caller then reloads the app to run it (IHM-03).
 */
export async function applyNewVersion(registration: VersionRegistration): Promise<ApplyResult> {
  const worker = registration.waiting;
  if (worker === null) {
    return { ok: false, error: 'no-new-version' };
  }
  const tookOver = new Promise<ApplyResult>((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        resolve({ ok: true });
      } else if (worker.state === 'redundant') {
        resolve({ ok: false, error: 'replaced' });
      }
    });
  });
  worker.postMessage(APPLY_NEW_VERSION_MESSAGE);
  return tookOver;
}
