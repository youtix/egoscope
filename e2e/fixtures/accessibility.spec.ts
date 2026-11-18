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

/**
 * A script that adds `html` to the main landmark once the page hears `stream`:
 * content that streams in after the page has rendered, when `streamIn` says so.
 */
const onStream = (html: string): string =>
  `document.addEventListener('stream', () => document.querySelector('main').insertAdjacentHTML('beforeend', '${html}'));`;

/**
 * Streams into `page` what it holds back, as a server does after the first
 * render, between two steps of the test and so after the check of the first.
 */
const streamIn = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    globalThis.document.dispatchEvent(new Event('stream'));
  });
};

// Pages that meet WCAG 2.2 AA, one linking to the other, and two that break it: one
// at once, one once its button has shown an image without a text alternative.
const PLAIN = pageWith('<p><a href="/probe/other">Another page</a></p>');
const OTHER = pageWith('<p>Every case counts.</p>', 'Another page');
const BROKEN = pageWith(IMAGE_WITHOUT_ALT);
const REVEALING = pageWith(
  `<button type="button" style="min-width:44px;min-height:44px" onclick="const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; this.after(image);">Show the image</button>`,
);
// Pages that break it later: once an image without a text alternative streams in
// after the page has loaded, until a button hides it again.
const LATE = pageWith(
  `<button type="button" style="min-width:44px;min-height:44px" onclick="document.querySelector('img').remove()">Hide the image</button><script>${onStream(IMAGE_WITHOUT_ALT)}</script>`,
);
// Once a link has opened its page as a link of Next.js does: at another address,
// without a new document, the page's shell at once, then what streams in.
const LOADED = `<h2>Loaded</h2>${IMAGE_WITHOUT_ALT}`;
const LINKING = pageWith(
  `<p><a href="/probe/streamed">Open the streamed page</a></p><script>document.querySelector('a').addEventListener('click', (event) => { event.preventDefault(); history.pushState(null, '', '/probe/streamed'); document.querySelector('main').innerHTML = '<h1>Streamed page</h1>'; ${onStream(LOADED)} });</script>`,
  'Linking page',
);
// Once a button has moved the page to another address of its own, without a new
// document, and what it shows there has streamed in.
const PUSHING = pageWith(
  `<button type="button" style="min-width:44px;min-height:44px">Show the results</button><script>document.querySelector('button').addEventListener('click', () => { history.pushState(null, '', '/probe/pushed'); ${onStream(IMAGE_WITHOUT_ALT)} });</script>`,
);
// Once a change of state that leaves the DOM as it was has made a text fall below
// the AA contrast ratio: a button that has the focus, a checkbox that is ticked.
const PALE_WHEN_FOCUSED = pageWith(
  '<style>button { min-width: 44px; min-height: 44px; color: #000; background: #fff; } button:focus { color: #bbb; }</style><button type="button">Pale when focused</button>',
);
const PALE_WHEN_TICKED = pageWith(
  '<style>input:checked + label { color: #bbb; }</style><input type="checkbox" id="pale" style="width:24px;height:24px"><label for="pale">Pale once ticked</label>',
);
// Until its animation has ended, a text that a button shows and that fades in,
// held at a tenth of its opacity, below the AA contrast ratio, for 900 ms.
const FADING_IN = pageWith(
  `<style>@keyframes appear { from { opacity: 0.1; } } p { animation: appear 900ms steps(1, end); }</style><button type="button" style="min-width:44px;min-height:44px">Show the text</button><script>document.querySelector('button').addEventListener('click', () => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Faded in</p>'));</script>`,
);

/**
 * The navigations that a test starts, each with the steps that bring a test to
 * the page whose button shows an image without a text alternative, and from
 * which the navigation then leaves.
 */
const NAVIGATIONS: readonly Readonly<{
  name: string;
  arrive: (page: Page) => Promise<unknown>;
  leave: (page: Page) => Promise<unknown>;
}>[] = [
  {
    name: 'goto',
    arrive: async (page) => page.goto('/probe/revealing'),
    leave: async (page) => page.goto('/probe/other'),
  },
  {
    name: 'reload',
    arrive: async (page) => page.goto('/probe/revealing'),
    leave: async (page) => page.reload(),
  },
  {
    name: 'goBack',
    arrive: async (page) => {
      await page.goto('/probe/other');
      await page.goto('/probe/revealing');
    },
    leave: async (page) => page.goBack(),
  },
  {
    name: 'goForward',
    arrive: async (page) => {
      await page.goto('/probe/revealing');
      await page.goto('/probe/other');
      await page.goBack();
    },
    leave: async (page) => page.goForward(),
  },
  {
    name: 'close',
    arrive: async (page) => page.goto('/probe/revealing'),
    leave: async (page) => page.close(),
  },
];

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

  test('checks the page that a test ends on, in the state it ends in, though only its focus changed since the last check', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/pale': [PALE_WHEN_FOCUSED] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/pale');
    await probe.getByRole('button', { name: 'Pale when focused' }).focus();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/pale', baseURL).href, rules: ['color-contrast'] },
    ]);
  });

  test('checks a page again once a test has changed a form control, which leaves the DOM as it was', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/ticked': [PALE_WHEN_TICKED] });
    const watch = await watchAccessibility(probe);
    const checkbox = probe.getByRole('checkbox', { name: 'Pale once ticked' });

    await probe.goto('/probe/ticked');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/ticked', baseURL).href, rules: ['color-contrast'] },
    ]);
  });

  test('lets the animations of a page end before it checks the page, so that a transition reports nothing', async ({
    context,
  }) => {
    const probe = await servedPage(context, { '/probe/fading': [FADING_IN] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/fading');
    await probe.getByRole('button', { name: 'Show the text' }).click();
    await expect(probe.getByText('Faded in')).toBeVisible();

    expect(await watch.finish()).toStrictEqual([]);
  });

  test('checks nothing more once the test has closed the page, though it closes the page again', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/revealing': [REVEALING] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/revealing');
    await probe.getByRole('button', { name: 'Show the image' }).click();
    await probe.close();
    await probe.close();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/revealing', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks what streams into a page that a link opens, which the test waits for, before it leaves the page', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/linking': [LINKING],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/linking');
    await probe.getByRole('link', { name: 'Open the streamed page' }).click();
    await expect(probe.getByRole('heading', { name: 'Streamed page' })).toBeVisible();
    await streamIn(probe);
    await expect(probe.getByRole('heading', { name: 'Loaded' })).toBeVisible();
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/streamed', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks what shows after a page has loaded, which the test waits for, before it leaves the page', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/late': [LATE], '/probe/other': [OTHER] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/late');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await streamIn(probe);
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/late', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks what shows after a page has loaded, which the test waits for, before it acts on the page', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/late': [LATE] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/late');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await streamIn(probe);
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.getByRole('button', { name: 'Hide the image' }).click();
    await expect(probe.getByRole('img')).toHaveCount(0);

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/late', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks what shows after a page moves to another address of its own, which the test waits for, before it leaves the page', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/pushing': [PUSHING],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/pushing');
    await probe.getByRole('button', { name: 'Show the results' }).click();
    await expect(probe).toHaveURL(/\/probe\/pushed$/u);
    await streamIn(probe);
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/pushed', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks a page again when the test reloads it', async ({ context, baseURL }) => {
    const probe = await servedPage(context, {
      '/probe/plain': [PLAIN, BROKEN],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/plain');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await probe.reload();
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/plain', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('checks a page again when the test goes to its address once more', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/plain': [PLAIN, BROKEN],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/plain');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await probe.goto('/probe/plain');
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/plain', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  for (const { name, arrive, leave } of NAVIGATIONS) {
    test(`checks the page that a test leaves with ${name}(), in the state it leaves it in`, async ({
      context,
      baseURL,
    }) => {
      const probe = await servedPage(context, {
        '/probe/revealing': [REVEALING],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await arrive(probe);
      await probe.getByRole('button', { name: 'Show the image' }).click();
      await leave(probe);

      expect(rulesOf(await watch.finish())).toStrictEqual([
        { address: new URL('/probe/revealing', baseURL).href, rules: ['image-alt'] },
      ]);
    });
  }

  test('checks a page that a test leaves with a navigation of its own, though it took no other step there', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/broken': [BROKEN], '/probe/plain': [PLAIN] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/broken');
    await probe.goto('/probe/plain');
    await expect(probe).toHaveTitle('Probe');

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: new URL('/probe/broken', baseURL).href, rules: ['image-alt'] },
    ]);
  });

  test('reports a page that raw keyboard input leaves before any check, since nothing of the test runs between them', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/plain': [PLAIN], '/probe/other': [OTHER] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/plain');
    await probe.keyboard.press('Tab');
    await probe.keyboard.press('Enter');
    await probe.waitForURL('**/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(await watch.finish()).toStrictEqual([
      { address: new URL('/probe/plain', baseURL).href, error: LEFT_UNCHECKED },
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
