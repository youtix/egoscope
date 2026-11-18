// Proves what the Playwright override of eslint.config.ts refuses in the end-to-end
// specs and their helpers, beside what it lets through: no skipped, focused or
// failing test, no test without the accessibility check, and no empty pattern but
// the parameter of a fixture that depends on no other. Deliberate violations are
// linted in the probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();
const SPEC = 'e2e/smoke.spec.ts';
const HELPER = 'e2e/fixtures.ts';

/** An end-to-end spec whose suite holds `body`. */
const inSpec = (body: string): string =>
  `import { test } from './fixtures';\n\ntest.describe('probe', () => {\n${body}\n});\n`;

describe('the Playwright override', { timeout: 120_000 }, () => {
  afterAll(remove);

  it.each([
    [
      'a skipped spec',
      inSpec("  test.skip('runs', () => undefined);"),
      'playwright/no-skipped-test',
    ],
    [
      'a spec to fix',
      inSpec("  test.fixme('runs', () => undefined);"),
      'playwright/no-skipped-test',
    ],
    [
      'a focused spec',
      inSpec("  test.only('runs', () => undefined);"),
      'playwright/no-focused-test',
    ],
    [
      'a spec expected to fail',
      inSpec("  test.fail('runs', () => undefined);"),
      'no-restricted-syntax',
    ],
    [
      'a failing suite',
      inSpec("  test.describe.fail('runs', () => undefined);"),
      'no-restricted-syntax',
    ],
  ])('refuses %s', async (_kind, code, rule) => {
    expect(await ruleIds(SPEC, code)).toContain(rule);
  });

  it("refuses a spec that takes Playwright's own test, without the accessibility check", async () => {
    const code = "import { test } from '@playwright/test';\n\nexport const probe = test;\n";

    expect(await ruleIds(SPEC, code)).toContain('no-restricted-imports');
  });

  it.each([
    [
      'an empty object pattern',
      'export const probe = (source: object): object => {\n  const {} = source;\n  return source;\n};\n',
    ],
    [
      'an empty array pattern',
      'export const probe = (source: readonly number[]): readonly number[] => {\n  const [] = source;\n  return source;\n};\n',
    ],
  ])("refuses %s, which Playwright's preset allows", async (_kind, code) => {
    expect(await ruleIds(HELPER, code)).toContain('no-empty-pattern');
  });

  it('lets a fixture that depends on no other take the empty object pattern that Playwright requires', async () => {
    const code = [
      "import { test as base } from '@playwright/test';",
      '',
      'export const test = base.extend<{ probe: string }>({',
      '  probe: async ({}, use) => {',
      "    await use('probe');",
      '  },',
      '});',
      '',
    ].join('\n');

    expect(await ruleIds(HELPER, code)).not.toContain('no-empty-pattern');
  });
});
