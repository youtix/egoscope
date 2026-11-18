/**
 * The `test` and `expect` of every end-to-end spec: Playwright's, with the
 * accessibility check of every page a test visits (accessibility.ts).
 */
import { test as base, expect } from '@playwright/test';

import { watchAccessibility } from './accessibility';

export const test = base.extend({
  page: async ({ page }, use) => {
    const accessibility = await watchAccessibility(page);
    await use(page);
    const findings = await accessibility.finish();
    expect(findings, 'Pages with WCAG 2.2 A or AA violations, or left unchecked').toStrictEqual([]);
  },
});

export { expect } from '@playwright/test';
