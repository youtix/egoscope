/**
 * What the Playwright override of eslint.config.ts restricts in the end-to-end
 * specs and their helpers, on top of Playwright's recommended rules (CLAUDE.md,
 * "End-to-end tests"); eslint-playwright.test.ts probes the whole override.
 *
 * - A spec takes `test` and `expect` from e2e/fixtures/test.ts, which checks
 *   every page that a test visits for accessibility.
 * - No test is expected to fail: nothing of Playwright's refuses `fail`.
 */

/** Playwright's own `test` and `expect`, which lack the accessibility check. */
export const E2E_TEST_IMPORT = {
  name: '@playwright/test',
  importNames: ['test', 'expect'],
  message:
    'Import test and expect from e2e/fixtures/test.ts, which checks every page that a test visits for accessibility.',
};

/** `test.fail` and `test.describe.fail`, with or without a condition. */
export const E2E_SYNTAX = [
  {
    selector:
      "MemberExpression[property.name='fail']:matches([object.name='test'], [object.object.name='test'])",
    message: '`fail` turns a failing test into a pass: a test runs and passes, or it is deleted.',
  },
];
