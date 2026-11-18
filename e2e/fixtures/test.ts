/**
 * The `test` and `expect` of every end-to-end spec: Playwright's, with the
 * accessibility check of every page a test visits (accessibility.ts).
 */
import { test as base } from '@playwright/test';

import { watchAccessibility } from './accessibility';

export const test = base.extend({
  page: async ({ page }, use) => {
    const accessibility = await watchAccessibility(page);
    await use(page);
    await accessibility.finish();
  },
});

export { expect } from '@playwright/test';
