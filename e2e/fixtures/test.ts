/**
 * The `test` and `expect` of every end-to-end spec: Playwright's, with the
 * accessibility watch of accessibility.ts on the test's `page` and on every page
 * that the test passes to `accessibility.watch`, and a browser context that starts
 * signed in, unless the spec says `test.use({ signedIn: false })`. CLAUDE.md,
 * "End-to-end tests", states what the watch checks, and when.
 */
import { test as base, expect } from '@playwright/test';

import { watchPages } from './accessibility';

import type { Watches } from './accessibility';
import type { BrowserContext, Page } from '@playwright/test';

/** The options of a spec, which `test.use` or a project sets. */
export type SessionOptions = Readonly<{
  /**
   * Whether the browser context starts with a session of the owner, which the
   * hermetic control `/api/test/session` opens: true by default, since every screen
   * but the login page needs one (TRV-58); false for a journey that logs in itself.
   */
  signedIn: boolean;
}>;

// What the session control answers once the cookie of the session is set.
const SESSION_OPENED = 204;

/** Opens a session of the owner in `context`, whose requests then carry its cookie. */
async function signIn(context: BrowserContext): Promise<void> {
  const answer = await context.request.post('/api/test/session');
  expect(answer.status(), 'The session control opened no session').toBe(SESSION_OPENED);
}

/** What a test asks of the accessibility watch beyond its own page. */
type Accessibility = Readonly<{
  /** Watches `page`, which the test opened beside its own: a popup, the page of another context. */
  watch: (page: Page) => Promise<void>;
  /** Checks `page`, the test's own by default, now: a state that CSS alone shows, or a moment. */
  check: (page?: Page) => Promise<void>;
}>;

export const test = base.extend<
  SessionOptions & { accessibility: Accessibility; watches: Watches }
>({
  signedIn: [true, { option: true }],
  context: async ({ context, signedIn }, use) => {
    if (signedIn) {
      await signIn(context);
    }
    await use(context);
  },
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
