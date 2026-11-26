// The registration of the service worker that next.config.ts builds from src/app/sw.ts
// (module map section 3.1). It runs in the browser only, once, from the app-wide device
// pieces that F-offline mounts in the authenticated layout.

// Where the worker answers, and the pages it controls: the whole app.
const SERVICE_WORKER_URL = '/sw.js';
const SERVICE_WORKER_SCOPE = '/';

/**
 * Why the worker is not registered: the browser has no service workers, as on a page
 * that is not served over HTTPS, or it refused the script, as when the script does not
 * answer, the device having lost its connection, or does not run.
 */
export type RegistrationError = 'unsupported' | 'refused';

/** The registration of the worker, or why there is none. */
export type RegistrationResult =
  | Readonly<{ ok: true; registration: ServiceWorkerRegistration }>
  | Readonly<{ ok: false; error: RegistrationError }>;

/**
 * Registers the service worker of the installable app over the whole app, which makes it
 * installable and lets it answer a screen with the offline page when the device has no
 * connection and no copy of the screen (TRV-21, TRV-22, CA-TRV-06). Registering again
 * returns the registration that exists.
 */
export async function registerServiceWorker(): Promise<RegistrationResult> {
  if (!('serviceWorker' in navigator)) {
    return { ok: false, error: 'unsupported' };
  }
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
    });
    return { ok: true, registration };
  } catch {
    return { ok: false, error: 'refused' };
  }
}
