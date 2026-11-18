/**
 * The accessibility check of the end-to-end tests: axe's rules of WCAG 2.2 levels
 * A and AA, touch-target size included, which matters on a phone (IHM-61), run
 * on every page a test visits. `test.ts` gives every test this check.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';

import type { Page } from '@playwright/test';

// The rule set of WCAG 2.2 levels A and AA, as axe tags it.
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// A page that has shown nothing yet: no test visits it.
const BLANK_PAGE = 'about:blank';

/** A rule that a page breaks: axe's id and help, and the elements that break it. */
export type Violation = Readonly<{ rule: string; help: string; elements: readonly string[] }>;

type Watch = Readonly<{
  /** Checks the page the test ends on, then fails the test on any finding. */
  finish: () => Promise<void>;
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

/** The address of the page, without its fragment, which only points within the page. */
function addressOf(page: Page): string {
  const url = new URL(page.url());
  url.hash = '';
  return url.href;
}

/**
 * Checks every page that `page` visits, once per address: before the first
 * action or auto-waiting assertion on it, and at the end of the test, whose
 * `finish` then fails it on any violation, listed page by page.
 */
export async function watchAccessibility(page: Page): Promise<Watch> {
  type Finding =
    | Readonly<{ address: string; violations: readonly Violation[] }>
    | Readonly<{ address: string; error: string }>;
  const checked = new Set([BLANK_PAGE]);
  const findings: Finding[] = [];
  const check = async (): Promise<void> => {
    const address = addressOf(page);
    if (checked.has(address)) {
      return;
    }
    checked.add(address);
    const violations = await accessibilityViolations(page);
    if (violations.length > 0) {
      findings.push({ address, violations });
    }
  };
  // Playwright calls a handler before every action and auto-waiting assertion
  // while its locator is visible, as the body always is. A handler must not
  // throw, since Playwright would report the error outside the test: what goes
  // wrong waits for `finish`, like the violations.
  const checkBeforeActing = async (): Promise<void> => {
    try {
      await check();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      findings.push({ address: addressOf(page), error: message });
    }
  };
  await page.addLocatorHandler(page.locator('body'), checkBeforeActing, { noWaitAfter: true });
  return {
    finish: async () => {
      if (!page.isClosed()) {
        await check();
      }
      expect(findings, 'Pages with WCAG 2.2 A or AA violations').toStrictEqual([]);
    },
  };
}
