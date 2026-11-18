import { watchAccessibility } from './accessibility';
import {
  addressOf,
  append,
  IMAGE_WITHOUT_ALT,
  onStream,
  OTHER,
  pageWith,
  rulesOf,
  servedPage,
  streamIn,
} from './probe-pages';
import { expect, test } from './test';

import type { Page } from '@playwright/test';

/** A color scheme that a page can follow. */
type Scheme = 'light' | 'dark';

/** The color scheme other than `scheme`, the one that a project emulates from the start. */
const otherThan = (scheme: string | null): Scheme => (scheme === 'dark' ? 'light' : 'dark');

/**
 * The changes to the DOM, one of each kind that a mutation observer reports, that
 * break WCAG 2.2 AA once a page has loaded: what the page holds, which streams in
 * a change, and the rule that the change breaks.
 */
const MUTATIONS: readonly Readonly<{ kind: string; body: string; rule: string }>[] = [
  {
    kind: 'a node that it adds, in its child list',
    body: onStream(append(IMAGE_WITHOUT_ALT)),
    rule: 'image-alt',
  },
  {
    kind: 'an attribute',
    body: `<img hidden src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">${onStream("document.querySelector('img').removeAttribute('hidden');")}`,
    rule: 'image-alt',
  },
  {
    kind: 'a text, in its character data',
    body: `<p><a href="/probe/other">Another page</a></p>${onStream("document.querySelector('a').firstChild.data = '';")}`,
    rule: 'link-name',
  },
];

/**
 * The emulations that a test can make, which change what a page shows while its
 * DOM stays as it was: the media under which a page shows its image without a
 * text alternative, and the emulation that makes them match. `other` is the
 * color scheme that the test's project does not emulate from the start.
 */
const EMULATIONS: readonly Readonly<{
  name: string;
  media: (other: Scheme) => string;
  emulate: (page: Page, other: Scheme) => Promise<void>;
}>[] = [
  {
    name: 'a new viewport size',
    media: () => '(min-width: 700px) and (max-width: 800px)',
    emulate: async (page) => page.setViewportSize({ width: 750, height: 700 }),
  },
  {
    name: 'the other color scheme',
    media: (other) => `(prefers-color-scheme: ${other})`,
    emulate: async (page, other) => page.emulateMedia({ colorScheme: other }),
  },
  {
    name: 'reduced motion',
    media: () => '(prefers-reduced-motion: reduce)',
    emulate: async (page) => page.emulateMedia({ reducedMotion: 'reduce' }),
  },
  {
    name: 'forced colors',
    media: () => '(forced-colors: active)',
    emulate: async (page) => page.emulateMedia({ forcedColors: 'active' }),
  },
];

// Once a change of state that leaves the DOM as it was has made a text fall below
// the AA contrast ratio: a button that has the focus, a checkbox that is ticked.
const PALE_WHEN_FOCUSED = pageWith(
  '<style>button { min-width: 44px; min-height: 44px; color: #000; background: #fff; } button:focus { color: #bbb; }</style><button type="button">Pale when focused</button>',
);
const PALE_WHEN_TICKED = pageWith(
  '<style>input:checked + label { color: #bbb; }</style><input type="checkbox" id="pale" style="width:24px;height:24px"><label for="pale">Pale once ticked</label>',
);
// A menu in the top layer, which its button opens without a change to any attribute,
// and which shows an image without a text alternative.
const MENU = pageWith(
  `<button type="button" popovertarget="menu" style="min-width:44px;min-height:44px">Open the menu</button><div id="menu" popover>${IMAGE_WITHOUT_ALT}<p><a href="/probe/other">Another page</a></p></div>`,
);
// A page that breaks WCAG 2.2 AA and moves to another address of its own, without
// a change to its DOM.
const MOVING = pageWith(
  `${IMAGE_WITHOUT_ALT}${onStream("history.pushState(null, '', '/probe/moved');")}`,
);

test.describe('the changes that the watch sees', () => {
  for (const { kind, body, rule } of MUTATIONS) {
    test(`checks a page again once its DOM changed: ${kind}`, async ({ context, baseURL }) => {
      const probe = await servedPage(context, {
        '/probe/changing': [pageWith(body)],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/changing');
      await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
      await streamIn(probe);
      await probe.goto('/probe/other');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(rulesOf(await watch.finish())).toStrictEqual([
        { address: addressOf('/probe/changing', baseURL), rules: [rule] },
      ]);
    });
  }

  test('checks a page again once a form control changed, which leaves the DOM as it was', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/ticked': [PALE_WHEN_TICKED],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);
    const checkbox = probe.getByRole('checkbox', { name: 'Pale once ticked' });

    await probe.goto('/probe/ticked');
    // The focus moves first, so that the control then changes alone.
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    await checkbox.check();
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/ticked', baseURL), rules: ['color-contrast'] },
    ]);
  });

  test('checks a page again once a popover opened, which changes no attribute', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/menu': [MENU], '/probe/other': [OTHER] });
    const watch = await watchAccessibility(probe);
    const opener = probe.getByRole('button', { name: 'Open the menu' });

    await probe.goto('/probe/menu');
    // The focus moves first, so that the popover then opens alone.
    await opener.focus();
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await expect(probe.getByRole('img')).toBeVisible();
    await probe.getByRole('link', { name: 'Another page' }).click();
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/menu', baseURL), rules: ['image-alt'] },
    ]);
  });

  test('checks a page again once the focus moved, which changes no DOM', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/focused': [PALE_WHEN_FOCUSED],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/focused');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await probe.getByRole('button', { name: 'Pale when focused' }).focus();
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/focused', baseURL), rules: ['color-contrast'] },
    ]);
  });

  test('checks a page again once it moved to another address, though nothing else changed', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, { '/probe/moving': [MOVING], '/probe/other': [OTHER] });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/moving');
    await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
    await streamIn(probe);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/moving', baseURL), rules: ['image-alt'] },
      { address: addressOf('/probe/moved', baseURL), rules: ['image-alt'] },
    ]);
  });

  for (const { name, media, emulate } of EMULATIONS) {
    test(`checks a page again once the test emulated ${name}, which changes no DOM`, async ({
      context,
      baseURL,
      colorScheme,
    }) => {
      const other = otherThan(colorScheme);
      const probe = await servedPage(context, {
        '/probe/emulated': [
          pageWith(
            `<style>img { display: none; } @media ${media(other)} { img { display: inline; } }</style>${IMAGE_WITHOUT_ALT}`,
          ),
        ],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/emulated');
      await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
      await emulate(probe, other);
      await expect(probe.getByRole('img')).toBeVisible();
      await probe.goto('/probe/other');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(rulesOf(await watch.finish())).toStrictEqual([
        { address: addressOf('/probe/emulated', baseURL), rules: ['image-alt'] },
      ]);
    });
  }
});
