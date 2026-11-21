/**
 * The `test` and `expect` of every end-to-end spec: Playwright's, with the
 * accessibility watch of accessibility.ts on the test's `page` and on every page
 * that the test passes to `accessibility.watch`. CLAUDE.md, "End-to-end tests",
 * states what the watch checks, and when.
 */
import { test as base, expect } from '@playwright/test';

import { watchPages } from './accessibility';

import type { Watches } from './accessibility';
import type { Page } from '@playwright/test';

/** What a test asks of the accessibility watch beyond its own page. */
type Accessibility = Readonly<{
  /** Watches `page`, which the test opened beside its own: a popup, the page of another context. */
  watch: (page: Page) => Promise<void>;
  /** Checks `page`, the test's own by default, now: a state that CSS alone shows, or a moment. */
  check: (page?: Page) => Promise<void>;
}>;

export const test = base.extend<{ accessibility: Accessibility; watches: Watches }>({
  // The watch of the test's pages: its own, and those it passes to `accessibility.watch`.
  watches: async ({}, use) => {
    await use(watchPages());
  },
  page: async ({ page, watches }, use) => {
    await watches.watch(page);
    await use(page);
    // The context, which closes the pages, outlives the page that this fixture extends.
    const findings = await watches.finish();
    expect(findings, 'Pages with WCAG 2.2 A or AA violations, or left unchecked').toStrictEqual([]);
  },
  // It takes the test's page, so that the findings on every page are asserted when
  // the test ends, even in a test that asks for no page of its own.
  accessibility: async ({ page, watches }, use) => {
    await use({
      watch: watches.watch,
      check: async (target = page) => watches.check(target),
    });
  },
});

export { expect } from '@playwright/test';
