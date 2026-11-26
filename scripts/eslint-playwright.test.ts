// Proves what the Playwright override of eslint.config.ts refuses in the end-to-end
// specs and their helpers, beside what it lets through: no skipped, focused or
// failing test in any form, no test without the accessibility check, no title without
// the space after its requirement IDs, no raw locator in a spec, no event that a test
// dispatches on a locator, and no empty pattern but the parameter of a fixture that
// depends on no other; and that the specs and their helpers, unlike src/, may import
// development dependencies. Deliberate violations are linted in the probe project of
// lint-probes.ts; the other probes of eslint.config.ts are in eslint.config.test.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();
const SPEC = 'e2e/smoke.spec.ts';
const HELPER = 'e2e/fixtures.ts';

/** An end-to-end spec whose suite holds `body`. */
const inSpec = (body: string): string =>
  `import { test } from './fixtures';\n\ntest.describe('probe', () => {\n${body}\n});\n`;

/** A test of an end-to-end spec whose body holds `statement`. */
const inTest = (statement: string): string =>
  inSpec(
    `  test('runs', async ({}, testInfo) => {\n    ${statement}\n    await testInfo.attach('x');\n  });`,
  );

/** An end-to-end spec whose one test bears `title`. */
const titled = (title: string): string => inSpec(`  test('${title}', () => undefined);`);

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
    ['a test that skips itself', inTest('testInfo.skip();'), 'playwright/no-skipped-test'],
    ['a test left to fix by itself', inTest('testInfo.fixme();'), 'playwright/no-skipped-test'],
    ['a test that expects itself to fail', inTest('testInfo.fail();'), 'no-restricted-syntax'],
    [
      'a test that skips itself through test.info()',
      inTest('test.info().skip();'),
      'no-restricted-syntax',
    ],
    [
      'a test left to fix through test.info()',
      inTest('test.info().fixme();'),
      'no-restricted-syntax',
    ],
    [
      'a test that expects itself to fail through test.info()',
      inTest('test.info().fail();'),
      'no-restricted-syntax',
    ],
    [
      'a test that skips itself through its info kept in a variable',
      inTest('const info = test.info();\n    info.skip();'),
      'no-restricted-syntax',
    ],
    [
      'a spec expected to fail, its annotation written as a string',
      inSpec("  test['fail']('runs', () => undefined);"),
      'no-restricted-syntax',
    ],
    [
      'an event that a test dispatches on a locator, which no handler precedes',
      inSpec(
        "  test('runs', async ({ page }) => {\n    await page.getByRole('button').dispatchEvent('click');\n  });",
      ),
      'no-restricted-syntax',
    ],
    [
      'an event that a test dispatches on a locator, its type written as a template',
      inSpec(
        "  test('runs', async ({ page }) => {\n    await page.getByRole('button').dispatchEvent(`click`);\n  });",
      ),
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

  it('lets a page dispatch an event of its own, as the DOM does, with the event itself', async () => {
    const code =
      "export const probe = (): boolean => globalThis.document.dispatchEvent(new Event('stream'));\n";

    expect(await ruleIds(HELPER, code)).not.toContain('no-restricted-syntax');
  });

  it('refuses a title whose requirement IDs the description follows without a space', async () => {
    expect(await ruleIds(SPEC, titled('[JOU-04]refuses a 31st active player'))).toContain(
      'playwright/valid-title',
    );
    expect(await ruleIds(SPEC, titled('[JOU-04] refuses a 31st active player'))).not.toContain(
      'playwright/valid-title',
    );
  });

  it('refuses a raw locator in a spec, but not in a helper', async () => {
    const code = [
      "import type { Locator, Page } from '@playwright/test';",
      '',
      "export const rows = (page: Page): Locator => page.locator('.row');",
      '',
    ].join('\n');

    expect(await ruleIds(SPEC, code)).toContain('playwright/no-raw-locators');
    expect(await ruleIds(HELPER, code)).not.toContain('playwright/no-raw-locators');
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

  describe('end-to-end specs', () => {
    it.each(['e2e/smoke.spec.ts', 'e2e/fixtures.ts'])(
      'let %s import a development dependency',
      async (file) => {
        const code = "import { expect } from 'vitest';\n\nexport const check = expect;\n";

        expect(await ruleIds(file, code)).not.toContain('import-x/no-extraneous-dependencies');
      },
    );

    it('still keeps development dependencies out of src/', async () => {
      const code = "import { expect } from 'vitest';\n\nexport const check = expect;\n";

      expect(await ruleIds('src/lib/probe/probe.ts', code)).toContain(
        'import-x/no-extraneous-dependencies',
      );
    });
  });
});
