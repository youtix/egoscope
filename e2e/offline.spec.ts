import { expect, test } from './fixtures/test';

import type { Page } from '@playwright/test';

// The screen that the app opens on, for the signed-in owner of every test's browser context.
const HOME = '/';
// A main screen, which stays readable offline (module map section 3.3, "cached").
const PLAYERS = '/players';
// A screen that needs the network (module map section 3.3, "—").
const SETTINGS = '/settings';
// The banner over a copy, its date and time in the owner's zone: "Offline — data from Thu
// 26 Nov 2026 at 14:03".
const OFFLINE_COPY = /^Offline — data from \w{3} \d{1,2} \w{3} \d{4} at \d{2}:\d{2}$/u;
const NOT_KEPT_MESSAGE =
  'This screen is not available offline: connect to the internet to open it.';

/** Waits until the worker that the app registers by itself is active. */
async function appWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

/** The paths of the screens of which the device keeps a copy. */
async function keptCopies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const copies = await globalThis.caches.open('egoscope-screens');
    const requests = await copies.keys();
    return requests.map((request) => new URL(request.url).pathname);
  });
}

test.describe('the app offline', () => {
  test('[IHM-57] [CA-TRV-38] [TRV-22] keeps a main screen readable offline under the banner that dates its copy, and drops the banner once the network returns', async ({
    page,
  }) => {
    await page.goto(HOME);
    await appWorkerReady(page);
    await page.goto(PLAYERS);
    await expect(page.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
    await expect.poll(async () => keptCopies(page)).toContain(PLAYERS);

    await page.context().setOffline(true);
    await page.goto(PLAYERS);

    await expect(page.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^Offline/u })).toHaveText(
      OFFLINE_COPY,
    );

    await page.context().setOffline(false);

    await expect(page.getByText(OFFLINE_COPY)).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
  });

  test('[IHM-57] [TRV-22] says offline that a screen that needs the network is not available offline, even after a visit', async ({
    page,
  }) => {
    await page.goto(HOME);
    await appWorkerReady(page);
    await page.goto(SETTINGS);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await page.context().setOffline(true);
    await page.goto(SETTINGS);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline');
    await expect(page.getByText(NOT_KEPT_MESSAGE)).toBeVisible();
    await expect(page).toHaveURL(SETTINGS);
  });

  test('[IHM-41] [CA-IHM-06] [CL-IHM-06] reopened at its address, the app shows the last screen that the owner left', async ({
    page,
  }) => {
    await page.goto('/more');
    await expect(page.getByRole('heading', { level: 1, name: 'More' })).toBeVisible();

    await page.goto(HOME);

    await expect(page).toHaveURL('/more');
    await expect(page.getByRole('heading', { level: 1, name: 'More' })).toBeVisible();
  });
});
