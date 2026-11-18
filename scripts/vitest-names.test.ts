// Proves that no-skipped-tests, the one rule that uses vitest-names.ts, knows a
// Vitest object by every name it goes by (an import alias, a member of the vitest
// namespace, a variable that holds one, such as a test made by it.extend()), and
// tells the test context from the fixtures that come with it. The rule's other
// probes are in eslint-plugin.test.ts. Deliberate violations are linted in the
// probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();

/** A test file whose suite holds `body`, below the import statement `imports`. */
const inTest = (body: string, imports = "import { describe, expect, it } from 'vitest';"): string =>
  `${imports}\n\ndescribe('probe', () => {\n${body}\n});\n`;

describe('vitestNames and contextPart, through no-skipped-tests', { timeout: 120_000 }, () => {
  afterAll(remove);

  it.each([
    [
      'a conditional skip on a test made by it.extend()',
      inTest(
        "  const databaseTest = it.extend({});\n  databaseTest.skipIf(true)('runs', () => undefined);",
      ),
    ],
    [
      'a skip from the context of a test made by it.extend()',
      inTest(
        "  const databaseTest = it.extend({});\n  databaseTest('skips', ({ skip }) => {\n    skip();\n  });",
      ),
    ],
    [
      'a conditional skip on it held in a variable',
      inTest("  const check = it;\n  check.skipIf(true)('runs', () => undefined);"),
    ],
    [
      'a conditional run on it imported under another name',
      inTest(
        "  check.runIf(false)('runs', () => undefined);",
        "import { describe, it as check } from 'vitest';",
      ),
    ],
    [
      'an expected failure on test imported under another name, then extended twice',
      inTest(
        "  const databaseTest = base.extend({}).extend({});\n  databaseTest.fails('fails', () => undefined);",
        "import { describe, test as base } from 'vitest';",
      ),
    ],
    [
      'a skip from the context of a hook imported under another name',
      inTest(
        '  setUp((context) => {\n    context.skip();\n  });',
        "import { beforeEach as setUp, describe } from 'vitest';",
      ),
    ],
    [
      'a conditional skip through the vitest namespace',
      inTest(
        "  vitest.it.skipIf(true)('runs', () => undefined);",
        "import * as vitest from 'vitest';\nimport { describe } from 'vitest';",
      ),
    ],
    [
      'a conditional skip on a test built by a helper function',
      inTest(
        [
          '  function withSeed(seed: number) {',
          '    return it.extend({ seed });',
          '  }',
          '  const test = withSeed(1);',
          '  for (const seed of [1, 2]) {',
          "    test.skipIf(seed === 1)('runs', () => undefined);",
          '  }',
        ].join('\n'),
      ),
    ],
    [
      'a skip from the context of a test built by a helper function',
      inTest(
        [
          '  const withSeed = (seed: number) => it.extend({ seed });',
          '  const test = withSeed(1);',
          '  for (const seed of [1, 2]) {',
          "    test('runs', ({ skip }) => {",
          '      skip(seed === 1);',
          '    });',
          '  }',
        ].join('\n'),
      ),
    ],
    [
      'a conditional skip on it destructured from the vitest namespace',
      inTest(
        "  const { it } = vitest;\n  it.skipIf(true)('runs', () => undefined);",
        "import * as vitest from 'vitest';\nimport { describe } from 'vitest';",
      ),
    ],
  ])('rejects %s', async (_kind, code) => {
    expect(await ruleIds('src/lib/probe/probe.test.ts', code)).toContain(
      'egoscope/no-skipped-tests',
    );
  });

  it.each([
    ['a type assertion', 'it.extend({}) as typeof it'],
    ['an angle-bracket type assertion', '<typeof it>it.extend({})'],
    ['a satisfies check', 'it.extend({}) satisfies typeof it'],
    ['a non-null assertion', 'it.extend({})!'],
    ['an optional call', 'it.extend?.({})'],
  ])('rejects a conditional skip on a test made by it.extend() under %s', async (_kind, init) => {
    const body = `  const databaseTest = ${init};\n  databaseTest.skipIf(true)('runs', () => undefined);`;

    expect(await ruleIds('src/lib/probe/probe.test.ts', inTest(body))).toContain(
      'egoscope/no-skipped-tests',
    );
  });

  it.each([
    ['{ skip: pass }', 'pass()'],
    ['{ [key]: skip }', 'skip()'],
    ['{ skip = () => undefined }', 'skip()'],
    ['{ skip } = {}', 'skip()'],
    ['{ task, ...context }', 'context.skip()'],
    ['context = {}', 'context.skip()'],
  ])('rejects a skip from the test context bound as %s', async (parameter, call) => {
    const body = `  it('skips', (${parameter}) => {\n    ${call};\n  });`;

    expect(await ruleIds('src/lib/probe/probe.test.ts', inTest(body))).toContain(
      'egoscope/no-skipped-tests',
    );
  });

  it('lets a test made by it.extend(), or imported under another name, run', async () => {
    const code = [
      "import { describe, expect, it as check } from 'vitest';",
      '',
      'const databaseTest = check.extend({ seed: 1 });',
      '',
      "describe('probe', () => {",
      "  databaseTest('reads its fixture', ({ seed }) => {",
      '    expect(seed).toBe(1);',
      '  });',
      "  check('runs', () => undefined);",
      '});',
      '',
    ].join('\n');

    expect(await ruleIds('src/lib/probe/probe.test.ts', code)).not.toContain(
      'egoscope/no-skipped-tests',
    );
  });

  it('lets a test made by it.extend() call skip() on a fixture it destructures', async () => {
    const code = [
      "import { describe, expect, it } from 'vitest';",
      '',
      'const pagedTest = it.extend({ cursor: { skip: (count: number): number => count + 1 } });',
      '',
      "describe('probe', () => {",
      "  pagedTest('pages through the results', ({ cursor }) => {",
      '    expect(cursor.skip(2)).toBe(3);',
      '  });',
      "  it('keeps the larger count', () => {",
      '    expect(Math.max(1, 2)).toBe(2);',
      '  });',
      '});',
      '',
    ].join('\n');

    expect(await ruleIds('src/lib/probe/probe.test.ts', code)).not.toContain(
      'egoscope/no-skipped-tests',
    );
  });
});
