/**
 * The accessibility check of the end-to-end tests: axe's rules of WCAG 2.2 levels
 * A and AA, touch-target size included, which matters on a phone, run on every
 * page of the app that a test visits. `test.ts` gives every test this check.
 */
import { isDeepStrictEqual } from 'node:util';

import { AxeBuilder } from '@axe-core/playwright';

import type { Page } from '@playwright/test';

// The rule set of WCAG 2.2 levels A and AA, as axe tags it.
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// The app serves its pages over HTTP. The blank page that a test starts on keeps
// its address when a test writes a page of its own into it: neither is the app's.
const APP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
// The property of a document's window that marks the document as changed since
// the watch last checked it.
const CHANGED = '__egoscopeAccessibilityChanged';
// The longest that a check waits for the animations of the page to end, so that
// axe sees the state they lead to rather than a frame on the way there.
const ANIMATIONS_MS = 1000;

/** What the watch reports of a page that was left before the watch could check it. */
export const LEFT_UNCHECKED =
  'The page was left before any action, web-first assertion or navigation of the test, so it went unchecked: assert what it shows before it is left.';

/** A rule that a page breaks: axe's id and help, and the elements that break it. */
export type Violation = Readonly<{ rule: string; help: string; elements: readonly string[] }>;

/** What the watch found on a page: the rules it breaks, or why it could not be checked. */
export type Finding =
  | Readonly<{ address: string; violations: readonly Violation[] }>
  | Readonly<{ address: string; error: string }>;

type Watch = Readonly<{
  /** Checks the page the test ends on, in the state it ends in, then returns every finding. */
  finish: () => Promise<readonly Finding[]>;
}>;

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
 * Marks the document as changed at each change to its DOM or to a form control,
 * until a check clears the mark. Runs in the page, in every document, before the
 * document's own scripts.
 */
function markChanges(key: string): void {
  const mark = (): void => {
    Reflect.set(globalThis, key, true);
  };
  new MutationObserver(mark).observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  document.addEventListener('input', mark, { capture: true });
  document.addEventListener('change', mark, { capture: true });
}

/**
 * Says whether the document of `page` changed since its last check, or cannot
 * tell. A document that no check has cleared yet, a new one included, has changed.
 */
async function hasChanged(page: Page): Promise<boolean> {
  try {
    return await page.evaluate((key) => Reflect.get(globalThis, key) !== false, CHANGED);
  } catch {
    // A page that cannot tell is checked, and the check reports what fails there.
    return true;
  }
}

/**
 * Lets the finite animations of `page` end, for ANIMATIONS_MS at most, then clears
 * the mark of a change: what changes from then on, during the check included,
 * marks the document again.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    async ({ key, limitMs }) => {
      const running = globalThis.document
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
    },
    { key: CHANGED, limitMs: ANIMATIONS_MS },
  );
}

/**
 * What a check of `page`, at `address`, finds once the page's animations have
 * ended: the rules it breaks, why it could not be checked, or nothing.
 */
async function checkPage(page: Page, address: string): Promise<Finding | undefined> {
  try {
    await settle(page);
    const violations = await accessibilityViolations(page);
    return violations.length > 0 ? { address, violations } : undefined;
  } catch (error) {
    // What goes wrong is reported like a violation: a locator handler must not
    // throw, since Playwright would report the error outside the test.
    return { address, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Makes each navigation that a test starts on `page` run `first` before it:
 * Playwright runs nothing of its own before them, so the page they leave would
 * go unchecked in the state the test left it in.
 */
function beforeNavigations(page: Page, first: () => Promise<void>): void {
  const after =
    <Args extends readonly unknown[], Result>(navigate: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      await first();
      return navigate(...args);
    };
  Object.assign(page, {
    goto: after(page.goto.bind(page)),
    reload: after(page.reload.bind(page)),
    goBack: after(page.goBack.bind(page)),
    goForward: after(page.goForward.bind(page)),
    close: after(page.close.bind(page)),
  } satisfies Partial<Page>);
}

/**
 * Watches the visits of `page` to the app's pages, a visit beginning each time
 * the page moves to another address, and checks the page whenever it changed
 * since its last check, by a new visit, a new document or a change to its DOM
 * or to a form control: before each action and web-first assertion, and before
 * each of their retries, so that what an assertion waits for is checked; before
 * each navigation that the test starts; and, whatever changed, on the page the
 * test ends on, in the state it ends in. `finish` returns the violations found,
 * page by page, and every page that was left before the watch could check it.
 */
export async function watchAccessibility(page: Page): Promise<Watch> {
  /** A stay of the page at one address of the app, and whether the watch checked it. */
  type Visit = Readonly<{ address: string; checked: boolean }>;
  const findings: Finding[] = [];
  let visit: Visit | undefined;
  const leave = (): void => {
    if (visit?.checked === false) {
      report(findings, { address: visit.address, error: LEFT_UNCHECKED });
    }
    visit = undefined;
  };
  const follow = (url: string): void => {
    const address = appAddress(url);
    if (address === visit?.address) {
      return;
    }
    leave();
    visit = address === undefined ? undefined : { address, checked: false };
  };
  const check = async (): Promise<void> => {
    if (visit === undefined) {
      return;
    }
    const { address } = visit;
    visit = { address, checked: true };
    const finding = await checkPage(page, address);
    if (finding !== undefined) {
      report(findings, finding);
    }
  };
  const checkIfChanged = async (): Promise<void> => {
    if (page.isClosed()) {
      return;
    }
    follow(page.url());
    if (visit !== undefined && (!visit.checked || (await hasChanged(page)))) {
      await check();
    }
  };
  await page.addInitScript(markChanges, CHANGED);
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      follow(frame.url());
    }
  });
  // Playwright calls a handler before every action and web-first assertion, and
  // before each of their retries, while its locator is visible, as the body always
  // is; it calls none before raw keyboard or mouse input, nor before a navigation.
  await page.addLocatorHandler(page.locator('body'), checkIfChanged, { noWaitAfter: true });
  beforeNavigations(page, checkIfChanged);
  return {
    finish: async () => {
      if (page.isClosed()) {
        leave();
      } else {
        follow(page.url());
        await check();
      }
      return findings;
    },
  };
}
