import { expect, test } from './fixtures/test';

import type { Page } from '@playwright/test';

// A page that answers without a session, with the request proxy or without it.
const LOG_IN = '/log-in';
// A screen that no cache of the device holds.
const SCREEN = '/players';
const ICONS = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];
const OFFLINE_PAGE_MESSAGE =
  'This screen has not been loaded on this device yet: connect to the internet to open it.';

/**
 * Registers the worker from `page` and waits until it is active, which F-offline replaces
 * by the registration that the app-wide device pieces mount in the authenticated layout
 * (module map section 2.1, offline). Returns the path of the pages that it controls.
 */
async function installWorker(page: Page): Promise<string> {
  const scope = await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  return new URL(scope).pathname;
}

/** The path of every response that the device's caches hold. */
async function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await globalThis.caches.keys();
    const stores = await Promise.all(names.map(async (name) => globalThis.caches.open(name)));
    const requests = await Promise.all(stores.map(async (store) => store.keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
}

test.describe('the installable app', () => {
  test('[TRV-21] [CA-TRV-06] [CL-TRV-13] answers its manifest, its icons and its worker without a session', async ({
    request,
  }) => {
    const manifest = await request.get('/manifest.webmanifest', { maxRedirects: 0 });

    await expect(manifest).toBeOK();
    const members: unknown = await manifest.json();
    expect(members).toHaveProperty('name', 'Egoscope');
    expect(members).toHaveProperty('start_url', '/');
    expect(members).toHaveProperty('display', 'standalone');
    expect(members).toHaveProperty(
      'icons',
      ICONS.map((src) => expect.objectContaining({ src })),
    );
    for (const icon of ICONS) {
      const image = await request.get(icon, { maxRedirects: 0 });
      await expect(image).toBeOK();
      expect(image.headers()['content-type']).toBe('image/png');
    }
    const worker = await request.get('/sw.js', { maxRedirects: 0 });
    await expect(worker).toBeOK();
    expect(worker.headers()['content-type']).toMatch(/^(?:application|text)\/javascript/u);
  });

  test('[TRV-21] [CA-TRV-06] [CL-TRV-13] links its manifest from its pages and installs its worker over the whole app, caching no data', async ({
    page,
  }) => {
    const response = await page.goto(LOG_IN);

    expect(await response?.text()).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/u);
    expect(await installWorker(page)).toBe('/');
    const cached = await cachedPaths(page);
    expect(cached.filter((cachedPath) => !cachedPath.startsWith('/_next/static/'))).toStrictEqual([
      '/offline-page',
    ]);
  });

  test('[TRV-22] shows the offline page, not an error, when the owner opens a screen that no cache holds without connection', async ({
    page,
  }) => {
    await page.goto(LOG_IN);
    await installWorker(page);
    await page.context().setOffline(true);

    await page.goto(SCREEN);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline');
    await expect(page.getByText(OFFLINE_PAGE_MESSAGE)).toBeVisible();
    await expect(page).toHaveTitle('Offline · Egoscope');
    await expect(page).toHaveURL(SCREEN);
  });
});
