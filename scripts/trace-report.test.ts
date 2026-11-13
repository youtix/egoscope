import { describe, expect, it } from 'vitest';

import { reportMarkdown, summaryLines } from './trace-report';

import type { Trace, TracedId } from './trace-rules';
import type { RegisterEntry } from './waiver-register';

const PLAYERS = 'docs/01-joueurs-suivis.md';
const STATISTICS = 'docs/07-statistiques-de-match.md';
const TEST = {
  id: 'STA-11',
  where: 'src/lib/stats-engine/game-score.test.ts:64',
  title: '[STA-11] [H-13] scores 25.9 | the spec example',
};
const LIMIT: RegisterEntry = {
  id: 'STA-11',
  kind: 'limit',
  part: 'The box scores of the real source',
  reason: 'The source is outside.',
  check: 'scripts/check-source.ts',
  where: 'docs/engineering/requirement-waivers.md:21',
};

const traced = (id: string, file: string, fields: Partial<TracedId> = {}): TracedId => ({
  id,
  file,
  where: `${file}:1`,
  criterion: id.startsWith('CA-'),
  status: 'open',
  tests: [],
  entry: undefined,
  ...fields,
});

const TRACE: Trace = {
  ids: [
    traced('JOU-04', PLAYERS),
    traced('CA-JOU-02', PLAYERS, { status: 'waived' }),
    traced('CA-JOU-03', PLAYERS),
    traced('STA-11', STATISTICS, { status: 'covered', tests: [TEST], entry: LIMIT }),
  ],
  problems: [],
};

describe('summaryLines', () => {
  it('counts the IDs of each spec file and lists the limits with their manual checks', () => {
    expect(summaryLines(TRACE, { ids: [], citable: new Set() })).toStrictEqual([
      'Requirement traceability: 2 requirements and 2 acceptance criteria: 1 covered, 1 waived, 2 open.',
      '',
      'Spec file                    IDs  Covered  Waived  Open',
      '01-joueurs-suivis.md           3        0       1     2',
      '07-statistiques-de-match.md    1        1       0     0',
      'All spec files                 4        1       1     2',
      '',
      'Limits, checked by hand:',
      '  STA-11, The box scores of the real source: scripts/check-source.ts',
      'Full report: reports/requirements-trace.md',
    ]);
  });

  it('says what each ID that the run requires by name has become', () => {
    const lines = summaryLines(
      { ids: [traced('JOU-04', PLAYERS)], problems: [] },
      { ids: ['JOU-04', 'H-13', 'JOU-99'], citable: new Set(['H-13']) },
    );

    expect(lines.slice(lines.indexOf('Required by name:'), -1)).toStrictEqual([
      'Required by name:',
      '  JOU-04: open',
      '  H-13: cited only, it needs no test',
      '  JOU-99: not an ID of the specs',
    ]);
  });

  it('names each file of the tests of a required ID once, with the lines of its tests', () => {
    const tests = [
      TEST,
      { ...TEST, where: 'src/lib/stats-engine/baseline.test.ts:7' },
      { ...TEST, where: 'src/lib/stats-engine/game-score.test.ts:99' },
    ];
    const trace = {
      ids: [traced('STA-11', STATISTICS, { status: 'covered', tests })],
      problems: [],
    };

    expect(summaryLines(trace, { ids: ['STA-11'], citable: new Set() })).toContain(
      '  STA-11: covered by src/lib/stats-engine/game-score.test.ts:64,99, src/lib/stats-engine/baseline.test.ts:7',
    );
  });
});

describe('reportMarkdown', () => {
  it('lists each ID with the tests that cover it, the limits and the problems', () => {
    const report = reportMarkdown(TRACE, [{ where: 'src/x.test.ts:3', problem: 'A problem.' }]);

    expect(report).toContain('| 07-statistiques-de-match.md | 1 | 1 | 0 | 0 |');
    expect(report).toContain(
      '| STA-11 | The box scores of the real source | scripts/check-source.ts |',
    );
    expect(report).toContain('- src/x.test.ts:3: A problem.');
    expect(report).toContain(
      String.raw`| STA-11 | 07-statistiques-de-match.md | covered | src/lib/stats-engine/game-score.test.ts:64 [STA-11] [H-13] scores 25.9 \| the spec example |`,
    );
    expect(report).toContain('| JOU-04 | 01-joueurs-suivis.md | open |  |');
  });

  it('says so when there is no limit and no problem', () => {
    const report = reportMarkdown({ ids: [traced('JOU-04', PLAYERS)], problems: [] }, []);

    expect(report).toContain('## Limits, checked by hand\n\nNone.');
    expect(report).toContain('## Problems\n\nNone.');
  });
});
