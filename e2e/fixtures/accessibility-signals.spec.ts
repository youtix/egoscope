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

import type { Locator, Page } from '@playwright/test';

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

/**
 * A page whose button can take the focus, with `onfocus` as the button's handler,
 * and an image without a text alternative that shows by CSS alone, under `shows`.
 */
const focusable = (shows: string, onfocus = ''): string =>
  pageWith(
    `<style>img { display: none; } ${shows} { display: inline; }</style><button type="button" style="min-width:44px;min-height:44px" onfocus="${onfocus}">Focus here</button>${IMAGE_WITHOUT_ALT}`,
  );

/**
 * The moves of the focus that change what a page shows by CSS alone, each with its
 * page and the steps that make it: to a button when no element has the focus,
 * which fires `focusin` alone, and from the button to no element, which fires
 * `focusout` alone. That button notes in a class that it had the focus, a change
 * to the DOM that comes before the last check.
 */
const FOCUS_MOVES: readonly Readonly<{
  name: string;
  body: string;
  move: (button: Locator) => Promise<void>;
}>[] = [
  {
    name: 'to an element, when no element had it',
    body: focusable('button:focus ~ img'),
    move: async (button) => button.focus(),
  },
  {
    name: 'to no element, from the element that had it',
    body: focusable('button.focused:not(:focus) ~ img', "this.classList.add('focused')"),
    move: async (button) => {
      await button.focus();
      await expect(button).toBeFocused();
      await button.blur();
    },
  },
];

// Once text is typed into its field, by CSS alone, as a floating label is styled:
// an image without a text alternative.
const TYPED_INTO = pageWith(
  `<style>img { display: none; } input:not(:placeholder-shown) ~ img { display: inline; }</style><label for="name">Name</label><input id="name" placeholder="A name" style="height:32px">${IMAGE_WITHOUT_ALT}`,
);
// Once the too short value of its field is committed, by CSS alone, as Tailwind's
// `user-invalid:` variant shows a hint: a text below the AA contrast ratio.
const COMMITTED = pageWith(
  '<style>#hint { display: none; color: #bbb; background: #fff; } #name:user-invalid ~ #hint { display: block; }</style><label for="name">Name</label><input id="name" required minlength="5" style="height:32px"><p id="hint">Five letters at least.</p>',
);
// A menu in the top layer, which its button opens without a change to any attribute,
// and which shows an image without a text alternative.
const MENU = pageWith(
  `<button type="button" popovertarget="menu" style="min-width:44px;min-height:44px">Open the menu</button><div id="menu" popover>${IMAGE_WITHOUT_ALT}<p><a href="/probe/other">Another page</a></p></div>`,
);
// A menu in the top layer that the page opens, then closes, without a change to any
// attribute as it closes, and, once it has closed, an image without a text alternative.
const CLOSING_MENU = pageWith(
  `<style>img { display: none; } body:has(#menu.opened:not(:popover-open)) img { display: inline; }</style><div id="menu" popover><p>A menu</p></div>${IMAGE_WITHOUT_ALT}${onStream("const menu = document.querySelector('#menu'); if (menu.matches(':popover-open')) { menu.hidePopover(); } else { menu.classList.add('opened'); menu.showPopover(); }")}`,
);
/**
 * The moves of a page to another address of its own, which change no DOM, each
 * with what the page holds and the paths at which the watch then finds its image
 * without a text alternative: a new path, by the history API, from a page that
 * shows the image from the start; and a new fragment, whose target the page's
 * style shows only once it is the target, at the address without its fragment.
 */
const MOVES: readonly Readonly<{ name: string; body: string; paths: readonly string[] }>[] = [
  {
    name: 'to another path',
    body: `${IMAGE_WITHOUT_ALT}${onStream("history.pushState(null, '', '/probe/moved');")}`,
    paths: ['/probe/moving', '/probe/moved'],
  },
  {
    name: 'to another fragment',
    body: `<style>#more:not(:target) { display: none; }</style><p id="more">${IMAGE_WITHOUT_ALT}</p>${onStream("location.hash = 'more';")}`,
    paths: ['/probe/moving'],
  },
];

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

  test('checks a page again once text is typed into the field that has the focus, which fires input alone', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/typed': [TYPED_INTO],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);
    const field = probe.getByLabel('Name');

    await probe.goto('/probe/typed');
    // The focus moves first, so that the text then changes the field alone.
    await field.focus();
    await expect(field).toBeFocused();
    await field.fill('Ada');
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/typed', baseURL), rules: ['image-alt'] },
    ]);
  });

  test('checks a page again once the value of a field is committed, which fires change alone', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/committed': [COMMITTED],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);
    const field = probe.getByLabel('Name');

    await probe.goto('/probe/committed');
    // The text is typed first, so that Enter then commits it alone.
    await field.fill('abc');
    await expect(field).toHaveValue('abc');
    await field.press('Enter');
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/committed', baseURL), rules: ['color-contrast'] },
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

  test('checks a page again once a popover closed, which changes no attribute', async ({
    context,
    baseURL,
  }) => {
    const probe = await servedPage(context, {
      '/probe/menu': [CLOSING_MENU],
      '/probe/other': [OTHER],
    });
    const watch = await watchAccessibility(probe);

    await probe.goto('/probe/menu');
    await streamIn(probe);
    await expect(probe.getByText('A menu')).toBeVisible();
    await streamIn(probe);
    await probe.goto('/probe/other');
    await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

    expect(rulesOf(await watch.finish())).toStrictEqual([
      { address: addressOf('/probe/menu', baseURL), rules: ['image-alt'] },
    ]);
  });

  for (const { name, body, move } of FOCUS_MOVES) {
    test(`checks a page again once the focus moved ${name}, which changes no DOM`, async ({
      context,
      baseURL,
    }) => {
      const probe = await servedPage(context, {
        '/probe/focused': [body],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/focused');
      await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
      await move(probe.getByRole('button', { name: 'Focus here' }));
      await probe.goto('/probe/other');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(rulesOf(await watch.finish())).toStrictEqual([
        { address: addressOf('/probe/focused', baseURL), rules: ['image-alt'] },
      ]);
    });
  }

  for (const { name, body, paths } of MOVES) {
    test(`checks a page again once it moved ${name}, though nothing else changed`, async ({
      context,
      baseURL,
    }) => {
      const probe = await servedPage(context, {
        '/probe/moving': [pageWith(body)],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/moving');
      await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
      await streamIn(probe);
      await probe.goto('/probe/other');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(rulesOf(await watch.finish())).toStrictEqual(
        paths.map((path) => ({ address: addressOf(path, baseURL), rules: ['image-alt'] })),
      );
    });
  }

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
