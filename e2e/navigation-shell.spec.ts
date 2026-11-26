import { expect, test } from './fixtures/test';

import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';

// Every Lot 1 screen of module map section 3.3 outside the two access screens, with an
// invented player, the slug of a candidate type and integer identifiers.
const PLAYER = '/players/3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const LOT_1_SCREENS = [
  '/',
  '/players',
  '/players/new',
  PLAYER,
  `${PLAYER}/edit`,
  `${PLAYER}/delete`,
  `${PLAYER}/profiles/media-storm`,
  '/profiles',
  '/cases/7',
  '/events/12',
  '/events/12/edit',
  '/events/12/withdraw',
  '/backtests',
  '/backtests/31',
  '/backtests/31/import',
  '/types',
  '/types/media-storm',
  '/types/media-storm/edit',
  '/types/media-storm/validate',
  '/types/media-storm/split',
  '/types/media-storm/review-events',
  '/types/media-storm/trend',
  '/types/merge',
  '/types/explore',
  '/more',
  '/settings',
  '/settings/account',
  '/settings/display',
  '/settings/parameters',
  '/journal',
  '/journal?entry=8',
  '/status',
  '/method',
  '/help',
] as const;

// A Lot 2 screen, which the Lot 1 server of these tests does not serve.
const LOT_2_SCREEN = '/alerts';
// An address that no route of the app matches, as a typo or an outdated link gives.
const NO_ROUTE = '/no-screen-has-this-address';
const OK = 200;
const NOT_FOUND = 404;

// The hermetic control that opens and closes to-do items named by the spec.
const TO_DO = '/api/test/to-do';
// The items that the count journey opens. The journey of the other project runs on the same
// server at the same time and holds one item at most, so with two of its own the count that
// a journey reads after opening them is above the one it read before, whatever the other does.
const JOURNEY_ITEMS = [1, 2] as const;
// The number in the accessible name of the Home entry, "Home 5 to do".
const HOME_COUNT = /Home (?<count>\d+) to do/u;

// The two widths of IHM-01: a phone, and a large screen, from 1024 pixels on.
const PHONE = { width: 390, height: 844 } as const;
const LARGE_SCREEN = { width: 1280, height: 800 } as const;
// An hour of the page's own clock, during which no screen asks the server anything.
const AN_HOUR = '01:00:00';

/** Where the navigation bar sits in the window, and whether the page scrolls sideways. */
async function layoutOf(page: Page, navigation: Locator) {
  const box = await navigation.evaluate((element) => {
    const { top, right, bottom, left } = element.getBoundingClientRect();
    return { top, right, bottom, left };
  });
  const doesScrollSideways = await page.evaluate(() => {
    const root = globalThis.document.documentElement;
    return root.scrollWidth > root.clientWidth;
  });
  return { ...box, doesScrollSideways };
}

// The headers that mark the router's prefetch of a linked screen, and of one of its segments.
// Every other request of the router, a navigation, a refresh or a Server Action, carries
// `next-router-state-tree` alone, and counts.
const PREFETCH_HEADERS = ['next-router-prefetch', 'next-router-segment-prefetch'] as const;

/** Whether `request` is the router's prefetch of a linked screen, which no timer starts. */
const isPrefetch = (request: Request): boolean => {
  const names = new Set(Object.keys(request.headers()));
  return PREFETCH_HEADERS.some((name) => names.has(name));
};

/** The names of the to-do items of the count journey of `project`. */
const journeyItems = (project: string): readonly string[] =>
  JOURNEY_ITEMS.map((item) => `Item ${String(item)} of the ${project} count journey`);

/** Opens or closes, with `method`, each to-do item named in `names`. */
async function changeItems(
  request: APIRequestContext,
  method: 'post' | 'delete',
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    const response = await request[method](TO_DO, { data: { name } });
    expect(response.status()).toBe(OK);
  }
}

/** The number of items to do that `home`, the Home entry of the bar, says to screen readers. */
async function countOn(home: Locator): Promise<number> {
  const snapshot = await home.ariaSnapshot();
  return Number(HOME_COUNT.exec(snapshot)?.groups?.['count']);
}

test.describe('the navigation shell', () => {
  test.describe('without a session', () => {
    test.use({ signedIn: false });

    for (const path of LOT_1_SCREENS) {
      test(`[IHM-16] [IHM-10] sends ${path} to the login page without a session, to come back to it`, async ({
        page,
      }) => {
        await page.goto(path);

        await expect(page).toHaveURL(`/log-in?${new URLSearchParams({ next: path }).toString()}`);
      });
    }
  });

  test('[IHM-16] answers not found for a Lot 2 screen while the lot is 1, inside the Lot 1 navigation', async ({
    page,
  }) => {
    const response = await page.goto(LOT_2_SCREEN);

    expect(response?.status()).toBe(NOT_FOUND);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This item no longer exists');
    await expect(page.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    // Signed in, the Home entry also carries the number of items to do (IHM-20).
    await expect(page.getByRole('navigation').getByRole('link')).toHaveText([
      /^Home\b/,
      'Players',
      'Types',
      'More',
    ]);
  });

  test('[IHM-01] [IHM-16] keeps the navigation bar at the bottom of a phone, in one column', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(LOT_2_SCREEN);
    const navigation = page.getByRole('navigation');
    await expect(navigation).toBeVisible();

    const layout = await layoutOf(page, navigation);

    expect(layout).toMatchObject({ left: 0, right: PHONE.width, doesScrollSideways: false });
    expect(Math.round(layout.bottom)).toBe(PHONE.height);
  });

  test('[IHM-01] [IHM-16] puts the navigation bar on the side of a large screen', async ({
    page,
  }) => {
    await page.setViewportSize(LARGE_SCREEN);
    await page.goto(LOT_2_SCREEN);
    const navigation = page.getByRole('navigation');
    await expect(navigation).toBeVisible();

    const layout = await layoutOf(page, navigation);

    expect(layout).toMatchObject({ top: 0, left: 0, doesScrollSideways: false });
    expect(Math.round(layout.bottom)).toBe(LARGE_SCREEN.height);
    expect(layout.right).toBeLessThan(LARGE_SCREEN.width / 2);
  });

  test('[IHM-16] [CL-IHM-19] answers an address that matches no route with a page of its own, outside the shell', async ({
    page,
  }) => {
    const response = await page.goto(NO_ROUTE);

    expect(response?.status()).toBe(NOT_FOUND);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This address leads to no screen',
    );
    await expect(page.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test.describe('the number of items to do', () => {
    test.afterEach(async ({ request }, testInfo) => {
      await changeItems(request, 'delete', journeyItems(testInfo.project.name));
    });

    test('[IHM-16] [IHM-20] shows on the Home entry the number of the screen the owner moves to, with no reload', async ({
      page,
      request,
    }, testInfo) => {
      await page.goto('/');
      const navigation = page.getByRole('navigation');
      const home = navigation.getByRole('link', { name: HOME_COUNT });
      await expect(home).toBeVisible();
      const before = await countOn(home);
      // A full load would lose it: it stays only while the router moves between screens.
      await page.evaluate(() => Object.assign(globalThis, { notReloaded: true }));

      await navigation.getByRole('link', { name: 'Players', exact: true }).click();
      await expect(page).toHaveURL('/players');
      await changeItems(request, 'post', journeyItems(testInfo.project.name));
      await navigation.getByRole('link', { name: 'Types', exact: true }).click();
      await expect(page).toHaveURL('/types');

      await expect.poll(async () => countOn(home)).toBeGreaterThan(before);
      expect(await page.evaluate(() => 'notReloaded' in globalThis)).toBe(true);
    });
  });

  test('asks the server nothing on a timer, however long the screen stays open', async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(LOT_2_SCREEN);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const asked: Request[] = [];
    page.on('request', (request) => {
      asked.push(request);
    });

    await page.clock.runFor(AN_HOUR);

    expect(
      asked.filter((request) => !isPrefetch(request)).map((request) => request.url()),
    ).toStrictEqual([]);
  });
});
