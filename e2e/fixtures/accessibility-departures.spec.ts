import { LEFT_UNCHECKED, watchAccessibility } from './accessibility';
import { addressOf, onStream, OTHER, pageWith, PLAIN, servedPage, streamIn } from './probe-pages';
import { expect, test } from './test';

import type { Page } from '@playwright/test';

// A field that raw input reaches: as the first element that takes the focus, by
// Tab, or at FIELD_POINT, by a click or a tap.
const FIELD =
  '<label for="name">Name</label><input id="name" name="name" style="position:absolute;left:16px;top:160px;width:240px;height:48px">';
const FIELD_POINT = { x: 40, y: 184 } as const;

// How long the test holds a key down while the app leaves by itself: the
// departure then begins while the raw input of the test runs.
const HELD_MS = 300;

/**
 * A page whose handler of the event that its address names (`?on=keydown`) leaves
 * at once, and whose form submits nothing by itself.
 */
const LEAVING_ON = pageWith(
  `<form onsubmit="return false">${FIELD}</form><script>document.addEventListener(new URLSearchParams(location.search).get('on'), () => location.assign('/probe/other'), { once: true });</script>`,
);

/** The raw input that presses `keys` in turn. */
const pressing =
  (...keys: readonly string[]) =>
  async (page: Page): Promise<void> => {
    for (const key of keys) {
      // Each key is pressed once the one before it has been.
      await page.keyboard.press(key);
    }
  };

/**
 * The events of raw keyboard, mouse and touch input, and those that the browser
 * fires in response to them, each with the raw input that fires it on LEAVING_ON.
 */
const INPUT_EVENTS: readonly Readonly<{ type: string; input: (page: Page) => Promise<void> }>[] = [
  { type: 'keydown', input: pressing('Tab') },
  { type: 'keypress', input: pressing('a') },
  { type: 'keyup', input: pressing('Tab') },
  { type: 'beforeinput', input: pressing('Tab', 'a') },
  { type: 'input', input: pressing('Tab', 'a') },
  { type: 'change', input: pressing('Tab', 'a', 'Enter') },
  { type: 'submit', input: pressing('Tab', 'Enter') },
  { type: 'pointerdown', input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y) },
  { type: 'pointerup', input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y) },
  { type: 'mousedown', input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y) },
  { type: 'mouseup', input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y) },
  { type: 'click', input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y) },
  { type: 'dblclick', input: async (page) => page.mouse.dblclick(FIELD_POINT.x, FIELD_POINT.y) },
  {
    type: 'contextmenu',
    input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y, { button: 'right' }),
  },
  {
    type: 'auxclick',
    input: async (page) => page.mouse.click(FIELD_POINT.x, FIELD_POINT.y, { button: 'middle' }),
  },
  { type: 'touchstart', input: async (page) => page.touchscreen.tap(FIELD_POINT.x, FIELD_POINT.y) },
  { type: 'touchend', input: async (page) => page.touchscreen.tap(FIELD_POINT.x, FIELD_POINT.y) },
];

// A form that the browser submits to the other page, with the button `submitter`
// and the attributes `attributes`, a handler among them.
const formWith = (submitter: string, attributes = ''): string =>
  `<form action="/probe/other"${attributes}><label for="name">Name</label><input id="name" name="name" style="height:32px">${submitter}</form>`;

/** A button, the first element that takes the focus, whose handler runs `onclick`. */
const sendButton = (onclick: string): string =>
  `<button type="button" style="min-width:44px;min-height:44px" onclick="${onclick}">Send</button>`;

/**
 * The pages that a test leaves by raw keyboard input, Tab then Enter unless `keys`
 * say otherwise, which the browser itself leaves in response: one whose link it
 * follows; one whose form it submits, which the browser leaves a task after the key
 * press; and those whose form a handler of the input submits, which the browser
 * leaves a task later: through the form's `requestSubmit()` or `submit()`, which
 * fires no submit event, even when a handler of the form stops its formdata event,
 * or through its submit button.
 */
const RAW_DEPARTURES: readonly Readonly<{
  name: string;
  body: string;
  keys?: readonly string[];
}>[] = [
  { name: 'follows a link', body: PLAIN },
  { name: 'submits a form', body: pageWith(formWith('')) },
  {
    name: 'presses a button whose handler submits a form',
    body: pageWith(
      `${sendButton("document.querySelector('form').requestSubmit()")}${formWith('')}`,
    ),
  },
  {
    name: 'presses a button whose handler submits a form by its submit method, which fires no submit event',
    body: pageWith(`${sendButton("document.querySelector('form').submit()")}${formWith('')}`),
  },
  {
    name: 'presses a button whose handler submits a form by its submit method, whose formdata event a handler of the form stops',
    body: pageWith(
      `${sendButton("document.querySelector('form').submit()")}${formWith('')}<script>document.querySelector('form').addEventListener('formdata', (event) => event.stopPropagation());</script>`,
    ),
  },
  {
    name: 'presses a button whose handler clicks the submit button of a form',
    body: pageWith(
      `${sendButton("document.querySelector('#submit').click()")}${formWith('<button id="submit" style="min-width:44px;min-height:44px">Submit</button>')}`,
    ),
  },
  {
    name: 'submits a form whose submit handler cancels the submission, then submits the form by its submit method',
    body: pageWith(formWith('', ' onsubmit="event.preventDefault(); this.submit();"')),
  },
  {
    name: 'changes the value of a list whose change handler submits its form by its submit method',
    body: pageWith(
      '<form action="/probe/other"><label for="sort">Sort by</label><select id="sort" name="sort" style="height:32px" onchange="this.form.submit()"><option>Name</option><option>Date</option></select></form>',
    ),
    keys: ['Tab', 'ArrowDown'],
  },
];

/**
 * Holds `key` down on `page` until `pressed` has seen what the key did, then has
 * the app leave by itself, while the key is still down.
 */
const leavingWhileHeld = async (
  page: Page,
  key: string,
  pressed: () => Promise<unknown>,
): Promise<void> => {
  const held = page.keyboard.press(key, { delay: HELD_MS });
  await pressed();
  await streamIn(page);
  await held;
};

/** A page whose app leaves by itself once `streamIn` says so, as it does once a timer or a request ends. */
const leavingByItself = (body: string): string =>
  pageWith(`${body}${onStream("location.assign('/probe/other');")}`);

/**
 * The pages that the app leaves by itself while the raw input of a test runs, or
 * once it has run, each with that input.
 */
const APP_DEPARTURES: readonly Readonly<{
  name: string;
  body: string;
  input: (page: Page) => Promise<void>;
}>[] = [
  {
    name: 'while the test holds a key down there',
    body: leavingByItself('<p><a href="/probe/other">Another page</a></p>'),
    input: async (page) =>
      leavingWhileHeld(page, 'Tab', async () =>
        page.waitForFunction(() => globalThis.document.activeElement?.tagName === 'A'),
      ),
  },
  {
    name: 'from a script that submits its form, whose handler leaves at once, while the test holds a key down there',
    body: pageWith(
      `<form>${FIELD}</form><script>const form = document.querySelector('form'); form.addEventListener('submit', (event) => { event.preventDefault(); location.assign('/probe/other'); }); document.addEventListener('stream', () => form.requestSubmit());</script>`,
    ),
    input: async (page) =>
      leavingWhileHeld(page, 'Tab', async () =>
        page.waitForFunction(() => globalThis.document.activeElement?.tagName === 'INPUT'),
      ),
  },
  {
    name: 'after a key press of the test moved it to one of its fragments, while the key is still down',
    body: leavingByItself('<p><a href="#more">More</a></p><p id="more">More.</p>'),
    input: async (page) => {
      await page.keyboard.press('Tab');
      await leavingWhileHeld(page, 'Enter', async () => page.waitForURL('**/probe/leaving#more'));
    },
  },
  {
    name: 'after a key press of the test began a download there, while the key is still down',
    body: leavingByItself('<p><a href="/probe/file" download>Download the file</a></p>'),
    input: async (page) => {
      await page.keyboard.press('Tab');
      await leavingWhileHeld(page, 'Enter', async () => page.waitForEvent('download'));
    },
  },
  {
    name: 'a task after a key press, by a timer that a handler of the key started',
    body: pageWith(
      `<p><a href="/probe/other">Another page</a></p><script>document.addEventListener('keydown', () => setTimeout(() => location.assign('/probe/other'), 0), { once: true });</script>`,
    ),
    input: pressing('Tab'),
  },
  {
    name: 'once it submits again, after a timer that a key press started, a form whose submission by an earlier key press it canceled',
    body: pageWith(
      `${sendButton("document.querySelector('form').requestSubmit()")}${formWith('')}<script>const form = document.querySelector('form'); let canceled = false; form.addEventListener('submit', (event) => { if (!canceled) { canceled = true; event.preventDefault(); } }); document.addEventListener('keydown', (event) => { if (event.key === 'a') { setTimeout(() => form.requestSubmit(), 0); } });</script>`,
    ),
    input: pressing('Tab', 'Enter', 'a'),
  },
  {
    name: 'once a request that a key press of the test began is answered',
    body: pageWith(
      `<form>${FIELD}</form><script>document.querySelector('form').addEventListener('submit', async (event) => { event.preventDefault(); await fetch('/probe/session', { method: 'POST' }); location.assign('/probe/other'); });</script>`,
    ),
    input: async (page) => {
      await page.keyboard.press('Tab');
      await page.keyboard.type('Ada');
      await page.keyboard.press('Enter');
    },
  },
  {
    name: 'once it submits, after sending its data by a request, a form whose submission by a key press it canceled, while the key is still down',
    body: pageWith(
      `${sendButton("document.querySelector('form').requestSubmit()")}${formWith('')}<script>const form = document.querySelector('form'); form.addEventListener('submit', async (event) => { event.preventDefault(); await fetch('/probe/session', { method: 'POST', body: new FormData(form) }); form.submit(); });</script>`,
    ),
    input: async (page) => {
      await page.keyboard.press('Tab');
      // The key stays down until the app has left, so that the departure begins
      // while the raw input of the test runs.
      const held = page.keyboard.press('Enter', { delay: HELD_MS });
      await page.waitForURL('**/probe/other**');
      await held;
    },
  },
  {
    name: 'after the test pressed a key there',
    body: leavingByItself('<p><a href="/probe/other">Another page</a></p>'),
    input: async (page) => {
      await page.keyboard.press('Tab');
      await streamIn(page);
    },
  },
];

test.describe('the departures that the watch reports', () => {
  // A desktop has no touchscreen of its own.
  test.use({ hasTouch: true });

  for (const { type, input } of INPUT_EVENTS) {
    test(`reports a document that the test leaves by raw input before any check, as a handler of its ${type} event leaves at once`, async ({
      context,
      baseURL,
    }) => {
      const probe = await servedPage(context, {
        '/probe/left': [LEAVING_ON],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto(`/probe/left?on=${type}`);
      await input(probe);
      await probe.waitForURL('**/probe/other');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(await watch.finish()).toStrictEqual([
        { address: addressOf(`/probe/left?on=${type}`, baseURL), error: LEFT_UNCHECKED },
      ]);
    });
  }

  for (const { name, body, keys = ['Tab', 'Enter'] } of RAW_DEPARTURES) {
    test(`reports a document that the test leaves by raw keyboard input before any check, as it ${name}, though an earlier document at its address was checked`, async ({
      context,
      baseURL,
    }) => {
      const probe = await servedPage(context, { '/probe/left': [body], '/probe/other': [OTHER] });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/left');
      await expect(probe.getByRole('heading', { name: 'Probe' })).toBeVisible();
      await probe.reload();
      await pressing(...keys)(probe);
      await probe.waitForURL('**/probe/other**');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(await watch.finish()).toStrictEqual([
        { address: addressOf('/probe/left', baseURL), error: LEFT_UNCHECKED },
      ]);
    });
  }

  for (const { name, body, input } of APP_DEPARTURES) {
    test(`reports no document that the app leaves by itself before any check, ${name}`, async ({
      context,
    }) => {
      const probe = await servedPage(context, {
        '/probe/leaving': [body],
        '/probe/other': [OTHER],
      });
      const watch = await watchAccessibility(probe);

      await probe.goto('/probe/leaving');
      await input(probe);
      await probe.waitForURL('**/probe/other**');
      await expect(probe.getByRole('heading', { name: 'Another page' })).toBeVisible();

      expect(await watch.finish()).toStrictEqual([]);
    });
  }
});
