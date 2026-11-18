/**
 * The accessibility watch of the end-to-end tests: axe's rules of WCAG 2.2 levels
 * A and AA, touch-target size included, which matters on a phone, run on the pages
 * of the app that a watched page shows, whenever they changed. `test.ts` watches
 * the test's page and every page that the test passes to it; CLAUDE.md, "The
 * accessibility watch", states the contract that this file keeps.
 */
import { isDeepStrictEqual } from 'node:util';

import { AxeBuilder } from '@axe-core/playwright';

import type { JSHandle, Keyboard, Mouse, Page, Touchscreen } from '@playwright/test';

// The rule set of WCAG 2.2 levels A and AA, as axe tags it.
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The app serves its pages over HTTP. The blank page that a test starts on keeps
// its address when a test writes a page of its own into it: neither is the app's.
const APP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
// The property of a document's window that marks the document as changed since
// the watch last checked it. A document that no check has cleared yet, a new one
// included, has changed.
const CHANGED = '__egoscopeAccessibilityChanged';
// The events that change what a page shows while its DOM stays as it was: a form
// control's value, the top layer as a popover or a dialog opens or closes (the
// first of its two toggle events fires at once), and a move of the focus.
const CHANGE_EVENTS = ['input', 'change', 'beforetoggle', 'toggle', 'focusin', 'focusout'];
// The longest that a check waits for the animations of the page to end, so that
// axe sees the state they lead to rather than a frame on the way there.
const ANIMATIONS_MS = 1000;

/** What the watch reports of a page that the test left, by raw input, before any check. */
export const LEFT_UNCHECKED =
  'The test left the page by raw keyboard, mouse or touch input before any check: assert what the page shows before leaving it.';

/** A rule that a page breaks: axe's id and help, and the elements that break it. */
export type Violation = Readonly<{ rule: string; help: string; elements: readonly string[] }>;

/** What the watch found on a page: the rules it breaks, or why it could not be checked. */
export type Finding =
  | Readonly<{ address: string; violations: readonly Violation[] }>
  | Readonly<{ address: string; error: string }>;

/** The watch of one page. */
type Watch = Readonly<{
  /** Checks the page now, whatever changed. */
  check: () => Promise<void>;
  /** Checks the page the test ends on, in the state it ends in, then returns every finding. */
  finish: () => Promise<readonly Finding[]>;
}>;

/** The watch of the pages of one test, each from the moment `watch` is given it. */
export type Watches = Readonly<{
  /** Watches `page` from now on: the test's own, a popup, the page of another context. */
  watch: (page: Page) => Promise<void>;
  /** Checks `page` now, whatever changed: a state that shows by CSS alone, or a chosen moment. */
  check: (page: Page) => Promise<void>;
  /** Checks each page in the state the test ends it in, then returns the findings, page by page. */
  finish: () => Promise<readonly Finding[]>;
}>;

/** What the script that marks a document as changed needs: the mark, and the events it hears. */
type Marking = Readonly<{ key: string; events: readonly string[] }>;

/**
 * A stay of a page at one address of the app: whether a check began there, and
 * whether raw input acted there.
 */
type Visit = Readonly<{ address: string; checked: boolean; rawInput: boolean }>;

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
 * Marks the document as changed at each change to its DOM and at each event that
 * `events` names, until a check clears the mark. Runs in the page: in every new
 * document, before the document's own scripts, and in the document that a page
 * shows when its watch begins.
 */
function markChanges({ key, events }: Marking): void {
  const mark = (): void => {
    Reflect.set(globalThis, key, true);
  };
  new MutationObserver(mark).observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  for (const type of events) {
    document.addEventListener(type, mark, { capture: true });
  }
}

/**
 * Says whether the document of `page` changed since its last check, or cannot
 * tell. A document that no check has cleared yet, a new one included, has changed.
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

/** Says whether `shown` is gone: its page closed, or shows a new document. */
async function isGone(shown: JSHandle<Document>): Promise<boolean> {
  try {
    await shown.evaluate(() => true);
    return false;
  } catch {
    return true;
  }
}

/**
 * Lets the finite animations of `shown` end, for ANIMATIONS_MS at most, then
 * clears its mark of a change, before axe reads it: what changes from then on,
 * during the check included, marks it again. Returns the document's address.
 */
async function settle(shown: JSHandle<Document>): Promise<string> {
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
      return read.URL;
    },
    { key: CHANGED, limitMs: ANIMATIONS_MS },
  );
}

/**
 * What a check of `shown`, the document of `page`, finds once its animations have
 * ended: the rules it breaks, why it could not be checked, or nothing.
 */
async function findIn(page: Page, shown: JSHandle<Document>): Promise<Finding | undefined> {
  try {
    const url = await settle(shown);
    const violations = await accessibilityViolations(page);
    return violations.length > 0 ? { address: appAddress(url) ?? url, violations } : undefined;
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
  if (await isGone(shown)) {
    return undefined;
  }
  await shown.dispose();
  return finding;
}

/** `method`, made to run `first` before it. */
function preceded<Args extends readonly unknown[], Result>(
  first: () => Promise<void> | void,
  method: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    await first();
    return method(...args);
  };
}

/** The watch of one page: its visits, what changed since its last check, and its findings. */
class PageWatch {
  readonly #page: Page;
  readonly #findings: Finding[] = [];
  #visit: Visit | undefined;
  // Whether the test emulated another viewport size or media since the last check.
  #emulated = false;

  constructor(page: Page) {
    this.#page = page;
  }

  /** Ends the visit; one that raw input acted on before any check is reported. */
  #leave(): void {
    if (this.#visit?.rawInput === true && !this.#visit.checked) {
      report(this.#findings, { address: this.#visit.address, error: LEFT_UNCHECKED });
    }
    this.#visit = undefined;
  }

  /** Follows the page to `url`: another address of the app begins another visit. */
  follow(url: string): void {
    const address = appAddress(url);
    if (address === this.#visit?.address) {
      return;
    }
    this.#leave();
    this.#visit = address === undefined ? undefined : { address, checked: false, rawInput: false };
  }

  /** Notes that the test acts on the page by raw input, which can leave it unchecked. */
  noteRawInput(): void {
    this.follow(this.#page.url());
    if (this.#visit !== undefined) {
      this.#visit = { ...this.#visit, rawInput: true };
    }
  }

  /** Notes that the test emulates another viewport size or media, which the page shows. */
  noteEmulation(): void {
    this.#emulated = true;
  }

  /** Checks the page now, whatever changed. */
  async check(): Promise<void> {
    this.follow(this.#page.url());
    if (this.#visit === undefined) {
      return;
    }
    this.#visit = { ...this.#visit, checked: true };
    this.#emulated = false;
    const finding = await checkPage(this.#page);
    if (finding !== undefined) {
      report(this.#findings, finding);
    }
  }

  /** Checks the page when it changed since its last check. */
  async checkIfChanged(): Promise<void> {
    this.follow(this.#page.url());
    if (
      this.#visit !== undefined &&
      (!this.#visit.checked || this.#emulated || (await hasChanged(this.#page)))
    ) {
      await this.check();
    }
  }

  /** Checks the page the test ends on, in the state it ends in, then returns every finding. */
  async finish(): Promise<readonly Finding[]> {
    if (this.#page.isClosed()) {
      this.#leave();
    } else {
      await this.check();
    }
    return this.#findings;
  }
}

/**
 * Fits the watch into the calls that Playwright runs no handler before: the
 * page's navigations and `close`, which first check the page when it changed;
 * its emulations of a viewport size or of media, which change what it shows;
 * and the raw input that can leave it, keys, clicks and taps.
 */
function fitCalls(page: Page, watch: PageWatch): void {
  const check = async (): Promise<void> => watch.checkIfChanged();
  const emulation = (): void => {
    watch.noteEmulation();
  };
  const rawInput = (): void => {
    watch.noteRawInput();
  };
  const { keyboard, mouse, touchscreen } = page;
  Object.assign(page, {
    goto: preceded(check, page.goto.bind(page)),
    reload: preceded(check, page.reload.bind(page)),
    goBack: preceded(check, page.goBack.bind(page)),
    goForward: preceded(check, page.goForward.bind(page)),
    close: preceded(check, page.close.bind(page)),
    setViewportSize: preceded(emulation, page.setViewportSize.bind(page)),
    emulateMedia: preceded(emulation, page.emulateMedia.bind(page)),
  } satisfies Partial<Page>);
  Object.assign(keyboard, {
    down: preceded(rawInput, keyboard.down.bind(keyboard)),
    insertText: preceded(rawInput, keyboard.insertText.bind(keyboard)),
    press: preceded(rawInput, keyboard.press.bind(keyboard)),
    type: preceded(rawInput, keyboard.type.bind(keyboard)),
    up: preceded(rawInput, keyboard.up.bind(keyboard)),
  } satisfies Partial<Keyboard>);
  Object.assign(mouse, {
    click: preceded(rawInput, mouse.click.bind(mouse)),
    dblclick: preceded(rawInput, mouse.dblclick.bind(mouse)),
    down: preceded(rawInput, mouse.down.bind(mouse)),
    up: preceded(rawInput, mouse.up.bind(mouse)),
  } satisfies Partial<Mouse>);
  Object.assign(touchscreen, {
    tap: preceded(rawInput, touchscreen.tap.bind(touchscreen)),
  } satisfies Partial<Touchscreen>);
}

/**
 * Watches `page` under the contract of CLAUDE.md, "The accessibility watch": its
 * document is checked before each action and web-first assertion on a locator,
 * and before each of their retries, and before each navigation that the test
 * starts, when it changed since its last check, and whatever changed when the
 * test ends.
 */
export async function watchAccessibility(page: Page): Promise<Watch> {
  const watch = new PageWatch(page);
  const marking: Marking = { key: CHANGED, events: CHANGE_EVENTS };
  await page.addInitScript(markChanges, marking);
  try {
    // The document that the page shows already, a popup's for one, runs no init script.
    await page.evaluate(markChanges, marking);
  } catch {
    // The page closed or moved on meanwhile: its next document runs the init script.
  }
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      watch.follow(frame.url());
    }
  });
  // Playwright calls a handler before every action and web-first assertion, and
  // before each of their retries, while its locator is visible, as the body always
  // is; it calls none before raw keyboard, mouse or touch input, nor before a
  // navigation.
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
