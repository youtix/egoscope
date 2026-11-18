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

/** What the watch reports of a page that a test left before it could check it. */
export const LEFT_UNCHECKED =
  'The test left this page before any action or web-first assertion on it, so the page went unchecked: assert what it shows before leaving it.';

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
 * Watches the visits of `page` to the app's pages, a visit beginning each time
 * the page moves to another address: checks the page before the first action or
 * web-first assertion of each visit, and the page the test ends on in the state
 * it ends in. `finish` returns the violations found, page by page, and every
 * page that the test left before the watch could check it.
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
  // What goes wrong is reported like a violation: a locator handler must not
  // throw, since Playwright would report the error outside the test.
  const check = async (): Promise<void> => {
    if (visit === undefined) {
      return;
    }
    const { address } = visit;
    visit = { address, checked: true };
    try {
      const violations = await accessibilityViolations(page);
      if (violations.length > 0) {
        report(findings, { address, violations });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report(findings, { address, error: message });
    }
  };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      follow(frame.url());
    }
  });
  // Playwright calls a handler before every action and web-first assertion while
  // its locator is visible, as the body always is, but not before a navigation:
  // a page that a test leaves without acting on it is reported as unchecked.
  const checkBeforeActing = async (): Promise<void> => {
    follow(page.url());
    if (visit?.checked === false) {
      await check();
    }
  };
  await page.addLocatorHandler(page.locator('body'), checkBeforeActing, { noWaitAfter: true });
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
