// Proves that no-skipped-tests, the one rule that uses vitest-names.ts, knows a
// Vitest object by every name it goes by (an import alias, a member of the vitest
// namespace, a variable that holds one, such as a test made by it.extend()), reads
// every member of its chains however it is named, and the options of a test, tells
// the test context from the fixtures that come with it, and lets a value of one's own
// that TypeScript tells from Vitest's pass. The rule's other probes are in
// eslint-plugin.test.ts. Deliberate violations are linted in the probe project of
// lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();

/** A test file whose suite holds `body`, below the import statement `imports`. */
const inTest = (body: string, imports = "import { describe, expect, it } from 'vitest';"): string =>
  `${imports}\n\ndescribe('probe', () => {\n${body}\n});\n`;

describe('vitestNames, contextPart and chains in no-skipped-tests', { timeout: 120_000 }, () => {
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
    [
      'a skip read on a value whose type may be anything',
      inTest("  const test = JSON.parse('{}');\n  test.skip('runs', () => undefined);"),
    ],
    ['an expected failure read through a computed key', inTest("  it['fails']('fails', () => 1);")],
    ['a skip read through a template key', inTest("  it[`skip`]('runs', () => undefined);")],
    [
      'a skip destructured from it',
      inTest("  const { skip } = it;\n  skip('runs', () => undefined);"),
    ],
    [
      'an expected failure destructured from test under another name',
      inTest(
        "  const { fails: pending } = test;\n  pending('fails', () => 1);",
        "import { describe, test } from 'vitest';",
      ),
    ],
    [
      'a skip from the context of aroundEach',
      inTest(
        '  aroundEach(async (runTest, context) => {\n    context.skip();\n    await runTest();\n  });',
        "import { aroundEach, describe } from 'vitest';",
      ),
    ],
    [
      'a skip from the context of a fixture of it.extend()',
      inTest(
        [
          '  const seededTest = it.extend<{ seed: number }>({',
          '    seed: async ({ skip }, use) => {',
          '      skip();',
          '      await use(1);',
          '    },',
          '  });',
          "  seededTest('reads its seed', ({ seed }) => {",
          '    expect(seed).toBe(1);',
          '  });',
        ].join('\n'),
      ),
    ],
  ])('rejects %s', async (_kind, code) => {
    expect(await ruleIds('src/lib/probe/probe.test.ts', code)).toContain(
      'egoscope/no-skipped-tests',
    );
  });

  it.each([
    ['skip, whatever its value', "it('runs', { skip: false }, () => undefined);"],
    ['todo', "it('runs', { todo: true }, () => undefined);"],
    ['fails', "test('fails', { fails: true }, () => 1);"],
    ['skip under a computed key', "it('runs', { ['skip']: true }, () => undefined);"],
    ['skip, on a suite', "describe('suite', { skip: true }, () => undefined);"],
    ['skip, on a test of a table', "it.each([1])('runs %i', { skip: true }, () => undefined);"],
  ])('rejects the test option %s', async (_kind, call) => {
    const code = inTest(`  ${call}`, "import { describe, it, test } from 'vitest';");

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
    ['context', "context['skip']()"],
  ])('rejects a skip from the test context bound as %s', async (parameter, call) => {
    const body = `  it('skips', (${parameter}) => {\n    ${call};\n  });`;

    expect(await ruleIds('src/lib/probe/probe.test.ts', inTest(body))).toContain(
      'egoscope/no-skipped-tests',
    );
  });

  // Vitest carries a modifier along the rest of its chain: `it.fails.each([1])`
  // makes expected failures, as `it.concurrent.fails` does.
  it.each([
    ['an expected failure, then concurrent', "  it.fails.concurrent('fails', () => undefined);"],
    ['an expected failure, then for', "  it.fails.for([1])('fails', () => undefined);"],
    ['an expected failure, then each', "  it.fails.each([1])('fails', () => undefined);"],
    ['a skip, then for', "  it.skip.for([1])('runs', () => undefined);"],
    ['a skip, then each', "  it.skip.each([1])('runs', () => undefined);"],
    ['a skip, then concurrent', "  it.skip.concurrent('runs', () => undefined);"],
    [
      'a skip held in a variable, then called',
      "  const pending = it.skip;\n  pending('runs', () => undefined);",
    ],
  ])('rejects %s once: every member of a chain counts, not only the last', async (_kind, body) => {
    const rules = await ruleIds('src/lib/probe/probe.test.ts', inTest(body));

    expect(rules.filter((rule) => rule === 'egoscope/no-skipped-tests')).toHaveLength(1);
  });

  it('lets each, concurrent and for run, alone or chained, on tests and suites', async () => {
    const body = [
      "  it.each([1])('runs %i', (count) => {",
      '    expect(count).toBe(1);',
      '  });',
      "  it.concurrent('runs', () => {",
      '    expect(Math.max(1, 2)).toBe(2);',
      '  });',
      "  it.for([1])('runs %i', (count) => {",
      '    expect(count).toBe(1);',
      '  });',
      "  it.concurrent.each([1])('runs %i', (count) => {",
      '    expect(count).toBe(1);',
      '  });',
      "  describe.each([1])('suite %i', () => undefined);",
    ].join('\n');

    expect(await ruleIds('src/lib/probe/probe.test.ts', inTest(body))).not.toContain(
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

  it('lets a test read a skip of its own on a value that TypeScript tells from Vitest', async () => {
    const code = [
      "import { describe, expect, it } from 'vitest';",
      '',
      "const rows = [{ name: 'first', skip: false }];",
      'const tasks = [{ skip: (count: number): number => count + 1 }];',
      '',
      "describe('probe', () => {",
      "  it('keeps the rows to run', () => {",
      '    expect(rows.filter((test) => !test.skip)).toHaveLength(1);',
      '  });',
      "  it('skips ahead in each task', () => {",
      '    expect(tasks.map((test) => test.skip(1))).toStrictEqual([2]);',
      '  });',
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

  it('lets a test pass an object with a skip key to a call of its own on a binding named test', async () => {
    const code = [
      "import { describe, expect, it } from 'vitest';",
      '',
      'const test = {',
      "  run: (name: string, options: Readonly<{ skip: boolean }>): string => (options.skip ? '' : name),",
      '};',
      '',
      "describe('probe', () => {",
      "  it('runs the rows', () => {",
      "    expect(test.run('first', { skip: false })).toBe('first');",
      '  });',
      '});',
      '',
    ].join('\n');

    expect(await ruleIds('src/lib/probe/probe.test.ts', code)).not.toContain(
      'egoscope/no-skipped-tests',
    );
  });

  it('lets a row of a table call skip() on a parameter of its own function', async () => {
    const code = [
      "import { describe, expect, it } from 'vitest';",
      '',
      'type Reader = Readonly<{ skip: (count: number) => number }>;',
      'const reader: Reader = { skip: (count) => count + 1 };',
      '',
      "describe('probe', () => {",
      "  it.each([{ name: 'one', run: (cursor: Reader): number => cursor.skip(1) }])(",
      "    'reads $name',",
      '    ({ run }) => {',
      '      expect(run(reader)).toBe(2);',
      '    },',
      '  );',
      "  describe.each([[(cursor: Reader): number => cursor.skip(2)]])('suite', (run) => {",
      "    it('reads', () => {",
      '      expect(run(reader)).toBe(3);',
      '    });',
      '  });',
      '});',
      '',
    ].join('\n');

    expect(await ruleIds('src/lib/probe/probe.test.ts', code)).not.toContain(
      'egoscope/no-skipped-tests',
    );
  });
});
