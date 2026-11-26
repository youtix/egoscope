/**
 * The accessibility watch of the end-to-end tests: axe's rules of WCAG 2.2 levels
 * A and AA, touch-target size included, which matters on a phone, run on the pages
 * of the app that a watched page shows, whenever they changed. `test.ts` watches
 * the test's page and every page that the test passes to it; CLAUDE.md, "The
 * accessibility watch", states the contract that this file keeps.
 */
import { isDeepStrictEqual } from 'node:util';

import { AxeBuilder } from '@axe-core/playwright';

import { CHANGED, markChanges, MARKING } from './changes';
import { STAMP, watchDepartures } from './departures';
import { watchTouches } from './touches';

import type { JSHandle, Keyboard, Mouse, Page, Touchscreen } from '@playwright/test';

// The rule set of WCAG 2.2 levels A and AA, as axe tags it.
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The app serves its pages over HTTP. The blank page that a test starts on keeps
// its address when a test writes a page of its own into it: neither is the app's.
const APP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
// The longest that a check waits for the animations of the page to end, so that
// axe sees the state they lead to rather than a frame on the way there.
const ANIMATIONS_MS = 1000;

/** What the watch reports of a document that the test left, by raw input, before any check. */
export const LEFT_UNCHECKED =
  'The test left the page by raw keyboard, mouse or touch input before any check: assert what the page shows before leaving it.';

/** What the watch reports of a page whose body has no box, which no locator handler sees. */
export const BODY_WITHOUT_BOX =
  'The body of the page has no box, so the watch cannot check the page before the steps of a test: give the body a height, as the root layout does.';

/** A rule that a page breaks: axe's id and help, and the elements that break it. */
export type Violation = Readonly<{ rule: string; help: string; elements: readonly string[] }>;

/** What the watch found on a page: the rules it breaks, or why it could not be checked. */
export type Finding =
  | Readonly<{ address: string; violations: readonly Violation[] }>
  | Readonly<{ address: string; error: string }>;

/** The watch of one page, as its tests drive it: a check now, and the check at the end. */
type Watch = Pick<PageWatch, 'check' | 'finish'>;

/** The watch of the pages of one test, each from the moment `watch` is given it. */
export type Watches = Readonly<{
  /** Watches `page` from now on: the test's own, a popup, the page of another context. */
  watch: (page: Page) => Promise<void>;
  /** Checks `page` now, whatever changed: a state that shows by CSS alone, or a chosen moment. */
  check: (page: Page) => Promise<void>;
  /** Checks each page in the state the test ends it in, then returns the findings, page by page. */
  finish: () => Promise<readonly Finding[]>;
}>;

/** What the watch runs a call of the test inside: a check or a note before it, or both sides of it. */
type Around = <Result>(call: () => Promise<Result>) => Promise<Result>;

/** What a check reads of a document once its animations have ended. */
type Settled = Readonly<{ url: string; loaded: boolean }>;

/** The WCAG 2.2 A and AA violations of `page` as it is now, in axe's order. */
export async function accessibilityViolations(page: Page): Promise<readonly Violation[]> {
  // axe runs inside the page itself: its default mode would open and close a page
  // of its own in the test's browser context at every check. The app embeds no
  // frame from another origin, which only that mode reaches.
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).setLegacyMode().analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    help: violation.help,
    elements: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

/**
 * The address of the page of the app at `url`, without its fragment, which only
 * points within the page; undefined for a page that the app does not serve.
 */
function appAddress(url: string): string | undefined {
  const address = new URL(url);
  if (!APP_PROTOCOLS.has(address.protocol)) {
    return undefined;
  }
  address.hash = '';
  return address.href;
}

/**
 * Adds `finding` to `findings` unless they hold it already: two checks of a page
 * that did not change find the same thing, which counts once.
 */
function report(findings: Finding[], finding: Finding): void {
  if (findings.every((known) => !isDeepStrictEqual(known, finding))) {
    findings.push(finding);
  }
}

/**
 * Says whether the document of `page` changed since its last check, or cannot
 * tell. A document on which no check began, a new one included, has changed.
 */
async function hasChanged(page: Page): Promise<boolean> {
  try {
    return await page.evaluate((key) => Reflect.get(globalThis, key) !== false, CHANGED);
  } catch {
    // A page that cannot tell is checked, and the check finds out why.
    return true;
  }
}

/**
 * The document that `page` shows, or undefined while it shows none: it closed, or
 * another is on its way.
 */
async function shownDocument(page: Page): Promise<JSHandle<Document> | undefined> {
  try {
    return await page.evaluateHandle(() => globalThis.document);
  } catch {
    return undefined;
  }
}

/**
 * Says whether `shown` is gone, since its page closed or shows a new document, and
 * lets go of it otherwise. A call into a page whose new document is on its way
 * waits until that document arrives, so a departure that has begun is seen through;
 * with `queued`, the page first runs the tasks already queued in it, such as the
 * departure of a form that a key press submitted, which begins a task later.
 */
async function isGone(shown: JSHandle<Document>, { queued = false } = {}): Promise<boolean> {
  try {
    if (queued) {
      await shown.evaluate(
        async () =>
          new Promise((resolve) => {
            setTimeout(resolve, 0);
          }),
      );
    }
    await shown.evaluate(() => true);
    await shown.dispose();
    return false;
  } catch {
    return true;
  }
}

/**
 * The document of the app that `page` shows, with its address, when raw input
 * could leave it unchecked, since no check has begun on it; the document then
 * holds `stamp`, which it names as it leaves.
 */
async function uncheckedDocument(
  page: Page,
  stamp: number,
): Promise<Readonly<{ shown: JSHandle<Document>; address: string }> | undefined> {
  const shown = await shownDocument(page);
  try {
    const url = await shown?.evaluate(
      (read, { key, stampKey, given }) => {
        const wasChecked = Reflect.has(globalThis, key);
        if (!wasChecked) {
          Reflect.set(globalThis, stampKey, given);
        }
        return wasChecked ? undefined : read.URL;
      },
      { key: CHANGED, stampKey: STAMP, given: stamp },
    );
    const address = url === undefined ? undefined : appAddress(url);
    if (shown !== undefined && address !== undefined) {
      return { shown, address };
    }
    await shown?.dispose();
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lets the finite animations of `shown` end, for ANIMATIONS_MS at most, then
 * clears its mark of a change, before axe reads it: what changes from then on,
 * during the check included, marks it again. Returns the document's address, and
 * whether it has loaded, its styles included.
 */
async function settle(shown: JSHandle<Document>): Promise<Settled> {
  return shown.evaluate(
    async (read, { key, limitMs }) => {
      const running = read
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
      const limit = new Promise((resolve) => {
        setTimeout(resolve, limitMs);
      });
      await Promise.race([
        Promise.allSettled(running.map(async ({ finished }) => finished)),
        limit,
      ]);
      Reflect.set(globalThis, key, false);
      return { url: read.URL, loaded: read.readyState === 'complete' };
    },
    { key: CHANGED, limitMs: ANIMATIONS_MS },
  );
}

/**
 * What a check of `shown`, the document of `page`, finds once its animations have
 * ended: the rules it breaks, why it could not be checked, a body that no locator
 * handler sees once the document has loaded, or nothing, as for a document that
 * the app does not serve.
 */
async function findIn(page: Page, shown: JSHandle<Document>): Promise<Finding | undefined> {
  try {
    const { url, loaded } = await settle(shown);
    const address = appAddress(url);
    if (address === undefined) {
      return undefined;
    }
    if (loaded && !(await page.locator('body').isVisible())) {
      return { address, error: BODY_WITHOUT_BOX };
    }
    const violations = await accessibilityViolations(page);
    return violations.length > 0 ? { address, violations } : undefined;
  } catch (error) {
    // What goes wrong is reported like a violation: a locator handler must not
    // throw, since Playwright would report the error outside the test.
    const message = error instanceof Error ? error.message : String(error);
    return { address: appAddress(page.url()) ?? page.url(), error: message };
  }
}

/**
 * What a check of the document that `page` shows finds. A check that a new
 * document interrupts finds nothing: the state that it was reading is gone, and
 * the new document gets a check of its own.
 */
async function checkPage(page: Page): Promise<Finding | undefined> {
  const shown = await shownDocument(page);
  if (shown === undefined) {
    return undefined;
  }
  const finding = await findIn(page, shown);
  return (await isGone(shown)) ? undefined : finding;
}

/** `method`, made to run inside `around`. */
function within<Args extends readonly unknown[], Result>(
  around: Around,
  method: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => around(async () => method(...args));
}

/** The watch of one page: what changed since its last check, and its findings. */
class PageWatch {
  readonly #page: Page;
  // The stamps of the documents whose departure raw input of the test began.
  readonly #leftByInput: ReadonlySet<number>;
  readonly #findings: Finding[] = [];
  // Whether the test emulated another viewport size or media since the last check.
  #emulated = false;
  // Whether the test has ended, after which nothing is checked any more.
  #finished = false;
  // The last stamp given to a document before raw input of the test acted on it.
  #stamps = 0;

  constructor(page: Page, leftByInput: ReadonlySet<number>) {
    this.#page = page;
    this.#leftByInput = leftByInput;
  }

  /** Runs `emulation`, of another viewport size or media, which changes what the page shows. */
  async emulate<Result>(emulation: () => Promise<Result>): Promise<Result> {
    this.#emulated = true;
    return emulation();
  }

  /**
   * Runs `input`, raw input of the test on the page, and reports the document of
   * the app that it leaves unchecked: one on which no check had begun, which is gone
   * once the input and the tasks that it queued have run, and which said as it left
   * that the input began its departure (departures.ts). Any other departure, after
   * a timer or a request say, is the app's own.
   */
  async rawInput<Result>(input: () => Promise<Result>): Promise<Result> {
    this.#stamps += 1;
    const stamp = this.#stamps;
    const unchecked = await uncheckedDocument(this.#page, stamp);
    const result = await input();
    if (
      unchecked !== undefined &&
      (await isGone(unchecked.shown, { queued: true })) &&
      this.#leftByInput.has(stamp)
    ) {
      report(this.#findings, { address: unchecked.address, error: LEFT_UNCHECKED });
    }
    return result;
  }

  /** Checks the page now, whatever changed. */
  async check(): Promise<void> {
    this.#emulated = false;
    const finding = await checkPage(this.#page);
    if (finding !== undefined) {
      report(this.#findings, finding);
    }
  }

  /** Checks the page when it changed since its last check, until the test has ended. */
  async checkIfChanged(): Promise<void> {
    if (!this.#finished && (this.#emulated || (await hasChanged(this.#page)))) {
      await this.check();
    }
  }

  /** Checks the page the test ends on, in the state it ends in, then returns every finding. */
  async finish(): Promise<readonly Finding[]> {
    if (!this.#page.isClosed()) {
      await this.check();
    }
    this.#finished = true;
    return this.#findings;
  }
}

/**
 * Fits the watch into the calls that Playwright runs no handler before: the
 * page's navigations, its `close` and that of its context, which first check the
 * page when it changed; its emulations of a viewport size or of media, which
 * change what it shows; and the raw input that can leave it, keys, clicks and taps,
 * and the touches of touches.ts, one step at a time.
 */
function fitCalls(page: Page, watch: PageWatch): void {
  const checked: Around = async (call) => {
    await watch.checkIfChanged();
    return call();
  };
  const emulated: Around = async (call) => watch.emulate(call);
  const raw: Around = async (call) => watch.rawInput(call);
  const { keyboard, mouse, touchscreen } = page;
  const context = page.context();
  Object.assign(page, {
    goto: within(checked, page.goto.bind(page)),
    reload: within(checked, page.reload.bind(page)),
    goBack: within(checked, page.goBack.bind(page)),
    goForward: within(checked, page.goForward.bind(page)),
    close: within(checked, page.close.bind(page)),
    setViewportSize: within(emulated, page.setViewportSize.bind(page)),
    emulateMedia: within(emulated, page.emulateMedia.bind(page)),
  } satisfies Partial<Page>);
  Object.assign(context, {
    close: within(checked, context.close.bind(context)),
  } satisfies Partial<typeof context>);
  Object.assign(keyboard, {
    down: within(raw, keyboard.down.bind(keyboard)),
    insertText: within(raw, keyboard.insertText.bind(keyboard)),
    press: within(raw, keyboard.press.bind(keyboard)),
    type: within(raw, keyboard.type.bind(keyboard)),
    up: within(raw, keyboard.up.bind(keyboard)),
  } satisfies Partial<Keyboard>);
  Object.assign(mouse, {
    click: within(raw, mouse.click.bind(mouse)),
    dblclick: within(raw, mouse.dblclick.bind(mouse)),
    down: within(raw, mouse.down.bind(mouse)),
    up: within(raw, mouse.up.bind(mouse)),
  } satisfies Partial<Mouse>);
  Object.assign(touchscreen, {
    tap: within(raw, touchscreen.tap.bind(touchscreen)),
  } satisfies Partial<Touchscreen>);
  watchTouches(page, raw);
}

/**
 * Watches `page` under the contract of CLAUDE.md, "The accessibility watch": its
 * document is checked before each action and web-first assertion on a locator,
 * and before each of their retries, and before each navigation that the test
 * starts, when it changed since its last check, and whatever changed when the
 * test ends.
 */
export async function watchAccessibility(page: Page): Promise<Watch> {
  const watch = new PageWatch(page, await watchDepartures(page));
  await page.addInitScript(markChanges, MARKING);
  try {
    // The document that the page shows already, a popup's for one, runs no init script.
    await page.evaluate(markChanges, MARKING);
  } catch {
    // The page closed or moved on meanwhile: its next document runs the init script.
  }
  // Playwright calls a handler before every action and web-first assertion, and
  // before each of their retries, while its locator is visible: the body, while it
  // has a box, which each check verifies. It calls none before raw input, a
  // navigation, or a locator's `dispatchEvent`, which the lint of e2e/ refuses
  // (scripts/eslint-playwright.ts).
  await page.addLocatorHandler(page.locator('body'), async () => watch.checkIfChanged(), {
    noWaitAfter: true,
  });
  fitCalls(page, watch);
  return watch;
}

/**
 * The watch of the pages of one test: each page that `watch` is given, from then
 * on, such as the test's own page, a popup that the test opened, or the page of a
 * second browser context that plays another device.
 */
export function watchPages(): Watches {
  const watches = new Map<Page, Promise<Watch>>();
  const watchOf = async (page: Page): Promise<Watch> => {
    const known = watches.get(page);
    if (known !== undefined) {
      return known;
    }
    const watch = watchAccessibility(page);
    watches.set(page, watch);
    return watch;
  };
  return {
    watch: async (page) => {
      await watchOf(page);
    },
    check: async (page) => {
      const watch = await watchOf(page);
      await watch.check();
    },
    finish: async () => {
      const findings = await Promise.all(
        Array.from(watches.values(), async (pending) => {
          const watch = await pending;
          return watch.finish();
        }),
      );
      return findings.flat();
    },
  };
}
