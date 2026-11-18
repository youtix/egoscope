import { accessibilityViolations, LEFT_UNCHECKED, watchAccessibility } from './accessibility';
import { expect, test } from './test';

import type { Finding } from './accessibility';
import type { BrowserContext, Page } from '@playwright/test';

/** A page that meets WCAG 2.2 AA, with `body` as the content of its main landmark. */
const pageWith = (body: string, heading = 'Probe'): string =>
  `<!doctype html><html lang="en"><head><title>Probe</title></head><body><main><h1>${heading}</h1>${body}</main></body></html>`;

// Two buttons of 16 by 16 CSS pixels, side by side: under the 24 by 24 of WCAG 2.2.
const SMALL_TARGETS =
  '<button type="button" style="width:16px;height:16px;padding:0;margin:0">A</button><button type="button" style="width:16px;height:16px;padding:0;margin:0">B</button>';

const IMAGE_WITHOUT_ALT = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';

// Pages that meet WCAG 2.2 AA, one linking to the other, and two that break it: one
// at once, one once its button has shown an image without a text alternative.
const PLAIN = pageWith('<p><a href="/probe/other">Another page</a></p>');
const OTHER = pageWith('<p>Every case counts.</p>', 'Another page');
const BROKEN = pageWith(IMAGE_WITHOUT_ALT);
const REVEALING = pageWith(
  `<button type="button" style="min-width:44px;min-height:44px" onclick="const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; this.after(image);">Show the image</button>`,
);

/**
 * A page of its own in the test's browser context, which the watch of the test's
 * `page` does not see, where each address of `pages` answers with its bodies in
 * turn, then with its last body again.
 */
async function servedPage(
  context: BrowserContext,
  pages: Readonly<Record<string, readonly string[]>>,
): Promise<Page> {
  const page = await context.newPage();
  const served = new Map<string, number>();
  await page.route('**/probe/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const bodies = pages[pathname] ?? [];
    const count = served.get(pathname) ?? 0;
    served.set(pathname, count + 1);
    await route.fulfill({
      contentType: 'text/html',
      body: bodies[Math.min(count, bodies.length - 1)] ?? '',
    });
  });
  return page;
}

/** The findings, each with the ids of the rules it breaks instead of the whole violations. */
const rulesOf = (findings: readonly Finding[]): readonly unknown[] =>
  findings.map((finding) =>
    'violations' in finding
      ? { address: finding.address, rules: finding.violations.map(({ rule }) => rule) }
      : finding,
  );

test.describe('the accessibility check', () => {
  test('passes a page that meets WCAG 2.2 AA', async ({ page }) => {
    await page.setContent(pageWith('<p>Every case counts.</p>'));

    expect(await accessibilityViolations(page)).toStrictEqual([]);
  });

  test('reports an image without a text alternative', async ({ page }) => {
    await page.setContent(pageWith(IMAGE_WITHOUT_ALT));

    const violations = await accessibilityViolations(page);

    expect(violations.map((violation) => violation.rule)).toStrictEqual(['image-alt']);
  });

  test('reports text below the contrast ratio of level AA', async ({ page }) => {
    await page.setContent(pageWith('<p style="color:#bbb;background:#fff">Pale text</p>'));

    const violations = await accessibilityViolations(page);

    expect(violations.map((violation) => violation.rule)).toStrictEqual(['color-contrast']);
  });

  test('reports touch targets smaller than 24 by 24 CSS pixels, a rule of WCAG 2.2', async ({
    page,
  }) => {
    await page.setContent(pageWith(SMALL_TARGETS));

    const violations = await accessibilityViolations(page);

    expect(violations.map((violation) => violation.rule)).toStrictEqual(['target-size']);
  });
});

test.describe('the watch of every page a test visits', () => {
  test('finds nothing on pages that meet WCAG 2.2 AA, from the first visit to the state a test ends in', async ({
    context,
  }) => {
    const probe = await servedPage(context, { '/probe/plain': [PLAIN], '/probe/other': [OTHER] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/plain');
    await probe.getByRole('link', { name: 'Another page' }).click();
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(await watch.finish()).toStrictEqual([]);
  });

  test('reports the violations of the page a test ends on, in the state it ends in', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/revealing': [REVEALING] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/revealing');
    await probe.getByRole('button', { name: 'Show the image' }).click();
    await expect(probe.getByRole('img')).toHaveCount(1);

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/revealing', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('reports a page that a test leaves before any action or web-first assertion on it', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/broken': [BROKEN], '/probe/plain': [PLAIN] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/broken');
    await probe.goto('/probe/plain');
    await expect(probe).toHaveTitle('Probe');

    expect(await watch.finish()).toStrictEqual([
      { address: new URL('/probe/broken', baseURL).href, error: LEFT_UNCHECKED },
    ]);
  });

  test('checks a page before the first action or web-first assertion of a visit, and reports each violation once', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/broken': [BROKEN] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/broken');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await expect(probe.getByRole('img')).toHaveCount(1);

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/broken', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks a page again each time a test comes back to it', async ({ context, baseURL }) => {
    const probe = await servedPage(context, {
      '/probe/plain': [PLAIN, BROKEN],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/plain');
    await probe.getByRole('link', { name: 'Another page' }).click();
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();
    await probe.goto('/probe/plain');
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/plain', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks no page that the app does not serve, such as one that a test writes itself', async ({
    context,
  }) => {
    const probe = await servedPage(context, {});
    const watch = await watchAccessibility(probe);

    await probe.setContent(BROKEN);
    await expect(probe.getByRole('img')).toHaveCount(1);

    expect(await watch.finish()).toStrictEqual([]);
  });
});
