import { describe, expect, it } from 'vitest';

import { findTitleTags, isTestFile } from './test-titles';

const FILE = 'src/lib/players/cap.test.ts';

/** The IDs that the titles of `lines` cite, each with its line. */
const tagsOf = (lines: readonly string[], file = FILE): readonly string[] =>
  findTitleTags(file, lines.join('\n')).map(
    (tag) => `${tag.id}@${tag.where.slice(tag.where.lastIndexOf(':') + 1)}`,
  );

describe('findTitleTags', () => {
  it('reads the IDs of test and suite titles, with their place and title', () => {
    const source = [
      "describe('[JOU-04] the cap on active players', () => {",
      "  it('[CA-JOU-02] [JOU-05] refuses a 31st active player', () => {});",
      '});',
    ];

    expect(findTitleTags(FILE, source.join('\n'))).toStrictEqual([
      { id: 'JOU-04', where: `${FILE}:1`, title: '[JOU-04] the cap on active players' },
      {
        id: 'CA-JOU-02',
        where: `${FILE}:2`,
        title: '[CA-JOU-02] [JOU-05] refuses a 31st active player',
      },
      {
        id: 'JOU-05',
        where: `${FILE}:2`,
        title: '[CA-JOU-02] [JOU-05] refuses a 31st active player',
      },
    ]);
  });

  it('reads the titles of modifiers, tables, templates and Playwright suites', () => {
    const source = [
      "it.each([['points', 1]])('[STA-11] [H-13] weighs %s at %s', () => {});",
      'describe.each`a`(`[STA-12] a table of $a`, () => {});',
      "it.concurrent('[STA-13] runs concurrently', async () => {});",
      "test.describe.serial('[IHM-02] installs the app', () => {});",
      'it(`[STA-14] a template with ${String(1)} inside`, () => {});',
      "suite('[H-STA-03] [CL-STA-01] [D-07 bis] cites what needs no test', () => {});",
    ];

    expect(tagsOf(source)).toStrictEqual([
      'STA-11@1',
      'H-13@1',
      'STA-12@2',
      'STA-13@3',
      'IHM-02@4',
      'STA-14@5',
      'H-STA-03@6',
      'CL-STA-01@6',
      'D-07 bis@6',
    ]);
  });

  it('reads no ID from a quoted title, a step, a hook, another call, or a tag split by an interpolation', () => {
    const source = [
      'const fixture = "it(\'[JOU-01] is a fixture\', () => {})";',
      'const template = `describe("[JOU-02] is one too", () => {})`;',
      "test('a test with steps', async () => { await test.step('[JOU-03] a step', () => {}); });",
      "test.beforeEach('[JOU-04] a titled hook', () => {});",
      "expect('[JOU-05]').toBe(label('[JOU-06]'));",
      'it(`[JOU-${String(7)}] an interpolated ID`, () => {});',
      "it(title, () => {}); it('a title without [brackets] of an ID [JOU]', () => {});",
    ];

    expect(tagsOf(source)).toStrictEqual([]);
  });

  it('reads the titles of a component test, JSX included', () => {
    const source = [
      "it('[IHM-01] renders one column', () => {",
      '  render(<Home title="[IHM-99] not a title" />);',
      '});',
    ];

    expect(tagsOf(source, 'src/app/page.test.tsx')).toStrictEqual(['IHM-01@1']);
  });

  it('shows an interpolation of a title as an ellipsis', () => {
    const [tag] = findTitleTags(FILE, 'it(`[STA-14] scores ${String(25.9)} points`, () => {});');

    expect(tag?.title).toBe('[STA-14] scores … points');
  });
});

describe('isTestFile', () => {
  it('counts unit tests, the tests of the scripts and end-to-end specs, and nothing else', () => {
    expect(
      [
        'src/lib/stats-engine/game-score.test.ts',
        'src/app/page.test.tsx',
        'scripts/spec-ids.test.ts',
        'e2e/install.spec.ts',
        'eslint.config.test.ts',
        'src/lib/stats-engine/game-score.ts',
        'e2e/helpers.ts',
        'scripts/lint-probes.ts',
      ].filter((file) => isTestFile(file)),
    ).toStrictEqual([
      'src/lib/stats-engine/game-score.test.ts',
      'src/app/page.test.tsx',
      'scripts/spec-ids.test.ts',
      'e2e/install.spec.ts',
    ]);
  });
});
