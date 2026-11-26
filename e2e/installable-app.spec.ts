import { expect, test } from './fixtures/test';

import type { Page } from '@playwright/test';

// The screen that the app opens on, for the signed-in owner of every test's browser context.
const HOME = '/';
// A signed-in screen that stays readable offline, of which no cache holds a copy yet.
const SCREEN = '/players';
// A signed-in screen that needs the network.
const ONLINE_ONLY_SCREEN = '/settings';
const ICONS = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];
const OFFLINE_PAGE_MESSAGE =
  'This screen has not been loaded on this device yet: connect to the internet to open it.';

/**
 * Waits until the worker that the app-wide device pieces of the authenticated layout
 * register is active (module map section 2.1, offline), and returns the path of the pages
 * that it controls.
 */
async function appWorker(page: Page): Promise<string> {
  const scope = await page.evaluate(async () => {
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
    const response = await page.goto(HOME);

    expect(await response?.text()).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/u);
    expect(await appWorker(page)).toBe('/');
    const cached = await cachedPaths(page);
    expect(cached.filter((cachedPath) => !cachedPath.startsWith('/_next/static/'))).toStrictEqual([
      '/offline-page',
    ]);
  });

  test('[CL-TRV-13] [IHM-57] keeps, beside the files of its build, a copy of the screens that stay readable offline alone', async ({
    page,
  }) => {
    await page.goto(HOME);
    await appWorker(page);

    await page.goto(ONLINE_ONLY_SCREEN);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await page.goto(SCREEN);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Players');
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect
      .poll(async () => {
        const paths = await cachedPaths(page);
        return paths.filter((cachedPath) => !cachedPath.startsWith('/_next/static/'));
      })
      .toStrictEqual(['/offline-page', SCREEN]);
  });

  test('[TRV-22] shows the offline page, not an error, when the owner opens a screen that no cache holds without connection', async ({
    page,
  }) => {
    await page.goto(HOME);
    await appWorker(page);
    await page.context().setOffline(true);

    await page.goto(SCREEN);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline');
    await expect(page.getByText(OFFLINE_PAGE_MESSAGE)).toBeVisible();
    await expect(page).toHaveTitle('Offline · Egoscope');
    await expect(page).toHaveURL(SCREEN);
  });
});
