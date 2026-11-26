import { expect, test } from './fixtures/test';

import type { Locator, Page, Request } from '@playwright/test';

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
const NOT_FOUND = 404;

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

test.describe('the navigation shell', () => {
  for (const path of LOT_1_SCREENS) {
    test(`[IHM-16] [IHM-10] sends ${path} to the login page without a session, to come back to it`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page).toHaveURL(`/log-in?${new URLSearchParams({ next: path }).toString()}`);
    });
  }

  test('[IHM-16] answers not found for a Lot 2 screen while the lot is 1, inside the Lot 1 navigation', async ({
    page,
  }) => {
    const response = await page.goto(LOT_2_SCREEN);

    expect(response?.status()).toBe(NOT_FOUND);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This item no longer exists');
    await expect(page.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('navigation').getByRole('link')).toHaveText([
      'Home',
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
