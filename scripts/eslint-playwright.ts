/**
 * What the Playwright override of eslint.config.ts restricts in the end-to-end
 * specs and their helpers, on top of Playwright's recommended rules (CLAUDE.md,
 * "End-to-end tests"); eslint-playwright.test.ts probes the whole override.
 *
 * - A spec takes `test` and `expect` from e2e/fixtures/test.ts, which checks
 *   every page that a test visits for accessibility.
 * - No test is skipped, left to fix or expected to fail, in any form: on `test`,
 *   on `test.describe`, or on a test's info, whatever its name or however it is
 *   reached. Playwright's `no-skipped-test` finds a test's info only as a named
 *   parameter, and nothing of Playwright's refuses `fail`.
 */

/** Playwright's own `test` and `expect`, which lack the accessibility check. */
export const E2E_TEST_IMPORT = {
  name: '@playwright/test',
  importNames: ['test', 'expect'],
  message:
    'Import test and expect from e2e/fixtures/test.ts, which checks every page that a test visits for accessibility.',
};

/**
 * The three annotations of Playwright that leave a test unrun or expect it to
 * fail, whether their name is written as such or as a string.
 */
export const E2E_SYNTAX = [
  {
    selector:
      'MemberExpression:matches([property.name=/^(?:skip|fixme|fail)$/u], [property.value=/^(?:skip|fixme|fail)$/u])',
    message:
      '`skip`, `fixme` and `fail` leave a test unrun or turn its failure into a pass: a test runs and passes, or it is deleted.',
  },
];
