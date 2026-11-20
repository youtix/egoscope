import {
  accessibilityViolations,
  BODY_WITHOUT_BOX,
  watchAccessibility,
  watchPages,
} from './accessibility';
import {
  addressOf,
  append,
  BROKEN,
  IMAGE_WITHOUT_ALT,
  onStream,
  OTHER,
  pageWith,
  PLAIN,
  rulesOf,
  servedPage,
  streamIn,
} from './probe-pages';
import { expect, test } from './test';

import type { Page } from '@playwright/test';

// Two buttons of 16 by 16 CSS pixels, side by side: under the 24 by 24 of WCAG 2.2.
const SMALL_TARGETS =
  '<button type="button" style="width:16px;height:16px;padding:0;margin:0">A</button><button type="button" style="width:16px;height:16px;padding:0;margin:0">B</button>';

// A page that breaks WCAG 2.2 AA once its button has shown an image without a text
// alternative.
const REVEALING = pageWith(
  `<button type="button" style="min-width:44px;min-height:44px" onclick="const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; this.after(image);">Show the image</button>`,
);
// One that breaks it later: once an image without a text alternative streams in
// after the page has loaded, until a button hides it again.
const LATE = pageWith(
  `<button type="button" style="min-width:44px;min-height:44px" onclick="document.querySelector('img').remove()">Hide the image</button>${onStream(append(IMAGE_WITHOUT_ALT))}`,
);
// Once a link has opened its page as a link of Next.js does: at another address,
// without a new document, the page's shell at once, then what streams in.
const LOADED = `<h2>Loaded</h2>${IMAGE_WITHOUT_ALT}`;
const LINKING = pageWith(
  `<p><a href="/probe/streamed">Open the streamed page</a></p><script>document.querySelector('a').addEventListener('click', (event) => { event.preventDefault(); history.pushState(null, '', '/probe/streamed'); document.querySelector('main').innerHTML = '<h1>Streamed page</h1>'; document.addEventListener('stream', () => { ${append(LOADED)} }); });</script>`,
  'Linking page',
);
// While the pointer is on its button, which is a state that CSS alone shows: a text
// below the AA contrast ratio.
const PALE_WHEN_HOVERED = pageWith(
  '<style>button { min-width: 44px; min-height: 44px; color: #000; background: #fff; } button:hover { color: #bbb; }</style><button type="button">Pale when hovered</button>',
);
// Until its animation has ended, a text that a button shows and that fades in,
// held at a tenth of its opacity, below the AA contrast ratio, for 900 ms.
const FADING_IN = pageWith(
  `<style>@keyframes appear { from { opacity: 0.1; } } p { animation: appear 900ms steps(1, end); }</style><button type="button" style="min-width:44px;min-height:44px">Show the text</button><script>document.querySelector('button').addEventListener('click', () => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Faded in</p>'));</script>`,
);
// A page whose button shows a message, then leaves for another page `delayMs`
// later, as an app does once it has saved something.
const saving = (delayMs: number): string =>
  pageWith(
    `<button type="button" style="min-width:44px;min-height:44px" onclick="this.insertAdjacentHTML('afterend', '<p>Saved.</p>'); setTimeout(() => location.assign('/probe/other'), ${String(delayMs)});">Save</button>`,
  );

/**
 * A script that gives the axe that a check injects into the page a `run` of its
 * own, `wrap(run)`: a page that does something while the watch checks it, at the
 * point of the check that `wrap` picks.
 */
const whileChecked = (wrap: string): string =>
  `<script>let axe; Object.defineProperty(globalThis, 'axe', { configurable: true, set: (value) => { axe = value; }, get: () => axe && new Proxy(axe, { get: (target, key) => key === 'run' ? (${wrap})(target.run.bind(target)) : Reflect.get(target, key) }) });</script>`;
// A page that shows an image without a text alternative once the first check has
// read it, before the check ends.
const CHANGING_WHILE_CHECKED = pageWith(
  whileChecked(
    `(run) => async (...args) => { const results = await run(...args); if (document.querySelector('img') === null) { ${append(IMAGE_WITHOUT_ALT)} } return results; }`,
  ),
);
// A page that leaves for the broken one while the first check reads it, which
// never ends: the page's new document interrupts it.
const LEAVING_WHILE_CHECKED = pageWith(
  whileChecked(`() => () => { location.assign('/probe/broken'); return new Promise(() => {}); }`),
);
// A page whose content is all out of flow, which leaves its body without a box.
const OUT_OF_FLOW = pageWith(
  '<style>main { position: fixed; inset: 0; }</style><p>Every case counts.</p>',
);
// A page whose link opens another page beside it, which shows an image without a
// text alternative once it has loaded.
const OPENING = pageWith('<p><a href="/probe/opened" target="_blank">Open a page beside</a></p>');
const OPENED = pageWith(
  `<p>Opened beside.</p>${onStream(append(IMAGE_WITHOUT_ALT))}`,
  'Opened page',
);

/**
 * The navigations that a test starts, and the closes of the page and of its
 * browser context, each with the steps that bring a test to the page whose button
 * shows an image without a text alternative, and from which the call then leaves.
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
  {
    name: 'context().close',
    arrive: async (page) => page.goto('/probe/revealing'),
    leave: async (page) => page.context().close(),
  },
];

// The delays, from the click, after which a page that the reviews probed leaves by
// itself: from before a check has injected axe to after it has run.
const LEAVING_DELAYS_MS = [50, 100, 150, 200, 250];

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
      { address: addressOf('/probe/broken', baseURL), rules: ['image-alt'] },
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
      { address: addressOf('/probe/late', baseURL), rules: ['image-alt'] },
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
      { address: addressOf('/probe/streamed', baseURL), rules: ['image-alt'] },
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
        { address: addressOf('/probe/revealing', baseURL), rules: ['image-alt'] },
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
      { address: addressOf('/probe/broken', baseURL), rules: ['image-alt'] },
    ]);
  });

  test('checks a page again when the test reloads it, which gives it a new document', async ({
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
    await probe.reload();
    await expect(probe.getByRole('img')).toHaveCount(1);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/plain', baseURL), rules: ['image-alt'] },
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
      { address: addressOf('/probe/plain', baseURL), rules: ['image-alt'] },
    ]);
  });

  test('checks the page that a test ends on, in the state it ends in, though nothing that the watch sees changed since its last check', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/hovered': [PALE_WHEN_HOVERED] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/hovered');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await probe.getByRole('button', { name: 'Pale when hovered' }).hover();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/hovered', baseURL), rules: ['color-contrast'] },
    ]);
  });

  test('checks a state that shows by CSS alone, such as a hover style, when the test asks for it', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/hovered': [PALE_WHEN_HOVERED],
      '/probe/other': [OTHER],
    });
    const watches = watchPages();
    await watches.watch(probe);

    await probe.goto('/probe/hovered');
    await probe.getByRole('button', { name: 'Pale when hovered' }).hover();
    await watches.check(probe);
    await probe.getByRole('heading', { name: 'Probe' }).hover();
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watches.finish())).toStrictEqual([
      { address: addressOf('/probe/hovered', baseURL), rules: ['color-contrast'] },
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

  test('checks a page again when it changed during a check, which clears the mark of a change before axe reads the page', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/changing': [CHANGING_WHILE_CHECKED],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/changing');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/changing', baseURL), rules: ['image-alt'] },
    ]);
  });

  test('drops a check that a new document interrupts, and checks the new document in its turn', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/leaving': [LEAVING_WHILE_CHECKED],
      '/probe/broken': [BROKEN],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/leaving');
    await expect(probe).toHaveURL(/\/probe\/broken$/u);
    await expect(probe.getByRole('img')).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/broken', baseURL), rules: ['image-alt'] },
    ]);
  });

  for (const delayMs of LEAVING_DELAYS_MS) {
    test(`finds nothing on pages that meet WCAG 2.2 AA, though the app leaves the first ${String(delayMs)} ms after a click, during a check or not`, async ({
      context,
    }) => {
      const probe = await servedPage(context, {
        '/probe/saving': [saving(delayMs)],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/saving');
      await probe.getByRole('button', { name: 'Save' }).click();
      await expect(probe).toHaveURL(/\/probe\/other$/u);
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(await watch.finish()).toStrictEqual([]);
    });
  }

  test('watches a page that a test opens beside its own once the test passes it to watch()', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/opening': [OPENING],
      '/probe/opened': [OPENED],
    });
    const watches = watchPages();
    await watches.watch(probe);

    await probe.goto('/probe/opening');
    const popup = probe.waitForEvent('popup');
    await probe.getByRole('link', { name: 'Open a page beside' }).click();
    const opened = await popup;
    await opened.waitForLoadState();
    await watches.watch(opened);
    await expect(opened.getByRole('heading', { name: 'Opened page' })).toBeVisible();
    await streamIn(opened);
    await opened.close();

    expect(rulesOf(await watches.finish())).toStrictEqual([
      { address: addressOf('/probe/opened', baseURL), rules: ['image-alt'] },
    ]);
  });

  test('reports a page whose body has no box, which hides the page from the checks before the steps of a test', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/fixed': [OUT_OF_FLOW] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/fixed');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();

    expect(await watch.finish()).toStrictEqual([
      { address: addressOf('/probe/fixed', baseURL), error: BODY_WITHOUT_BOX },
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
