import { describe, expect, it } from 'vitest';

import { traceIds } from './trace-rules';

import type { SpecIds } from './spec-ids';
import type { TitleTag } from './test-titles';
import type { Requirements, Trace } from './trace-rules';
import type { EntryKind, RegisterEntry } from './waiver-register';

const PLAYERS = 'docs/01-joueurs-suivis.md';
const SPECS: SpecIds = {
  requirements: [
    { id: 'JOU-04', file: PLAYERS, where: `${PLAYERS}:82`, lot: 1 },
    { id: 'JOU-05', file: PLAYERS, where: `${PLAYERS}:83`, lot: 1 },
  ],
  criteria: [{ id: 'CA-JOU-02', file: PLAYERS, where: `${PLAYERS}:160`, text: '(JOU-04) …' }],
  citable: new Set(['H-13', 'CL-JOU-01']),
  problems: [],
};
const NOTHING_REQUIRED: Requirements = { strict: false, required: [] };

const tag = (id: string, line = 1): TitleTag => ({
  id,
  where: `src/lib/players/cap.test.ts:${String(line)}`,
  title: `[${id}] a behavior`,
});

const entry = (id: string, kind: EntryKind): RegisterEntry => ({
  id,
  kind,
  part: kind === 'limit' ? 'The wording of an outside AI' : '',
  reason: 'A reason.',
  check: 'Guide, step 6',
  where: 'docs/engineering/requirement-waivers.md:21',
});

const problemsOf = (trace: Trace): readonly string[] =>
  trace.problems.map(({ where, problem }) => `${where}: ${problem}`);

const statusOf = (trace: Trace, id: string): string | undefined =>
  trace.ids.find((each) => each.id === id)?.status;

describe('traceIds', () => {
  it('covers an ID that a test names, waives one that the register waives, leaves the others open', () => {
    const trace = traceIds(
      {
        specs: SPECS,
        tags: [tag('JOU-04'), tag('JOU-04', 9)],
        entries: [entry('JOU-05', 'waiver')],
      },
      NOTHING_REQUIRED,
    );

    expect(trace.ids.map(({ id, status, tests }) => [id, status, tests.length])).toStrictEqual([
      ['JOU-04', 'covered', 2],
      ['JOU-05', 'waived', 0],
      ['CA-JOU-02', 'open', 0],
    ]);
    expect(problemsOf(trace)).toStrictEqual([]);
  });

  it('refuses a title ID that the specs do not define, and accepts one that needs no test', () => {
    const trace = traceIds(
      { specs: SPECS, tags: [tag('JOU-99'), tag('H-13'), tag('CL-JOU-01')], entries: [] },
      NOTHING_REQUIRED,
    );

    expect(problemsOf(trace)).toStrictEqual([
      'src/lib/players/cap.test.ts:1: [JOU-99] is not an ID that the specs define: check it against the spec, or against docs/engineering/acceptance-criteria-index.md for a criterion.',
    ]);
  });

  it.each([
    ['an unknown ID', 'JOU-99'],
    ['a hypothesis, which needs no test', 'H-13'],
  ])('refuses a register entry for %s', (_case, id) => {
    const trace = traceIds(
      { specs: SPECS, tags: [], entries: [entry(id, 'waiver')] },
      NOTHING_REQUIRED,
    );

    expect(problemsOf(trace)).toStrictEqual([
      `docs/engineering/requirement-waivers.md:21: ${id} is not a requirement or an acceptance criterion of the specs: the register lists only those.`,
    ]);
  });

  it('refuses a waiver beside a test', () => {
    const trace = traceIds(
      { specs: SPECS, tags: [tag('JOU-04', 12)], entries: [entry('JOU-04', 'waiver')] },
      NOTHING_REQUIRED,
    );

    expect(problemsOf(trace)).toStrictEqual([
      'docs/engineering/requirement-waivers.md:21: JOU-04 has a waiver and a test (src/lib/players/cap.test.ts:12): a waived ID has no test, so drop the waiver, or make it a limit.',
    ]);
  });

  it('accepts a limit beside a test, which leaves the ID covered', () => {
    const trace = traceIds(
      { specs: SPECS, tags: [tag('JOU-04')], entries: [entry('JOU-04', 'limit')] },
      { strict: false, required: ['JOU-04'] },
    );

    expect(statusOf(trace, 'JOU-04')).toBe('covered');
    expect(problemsOf(trace)).toStrictEqual([]);
  });

  it('accepts a limit before its test, unless the ID is required', () => {
    const inputs = { specs: SPECS, tags: [], entries: [entry('JOU-04', 'limit')] };

    expect(problemsOf(traceIds(inputs, NOTHING_REQUIRED))).toStrictEqual([]);
    expect(problemsOf(traceIds(inputs, { strict: false, required: ['JOU-04'] }))).toStrictEqual([
      `${PLAYERS}:82: JOU-04 is required and has a limit, but no test: a limit keeps the tests of the application's part.`,
    ]);
  });

  it('requires each listed ID to be tested or waived, and an ID of the specs', () => {
    const trace = traceIds(
      { specs: SPECS, tags: [tag('JOU-04')], entries: [entry('JOU-05', 'waiver')] },
      { strict: false, required: ['JOU-04', 'JOU-05', 'CA-JOU-02', 'H-13', 'JOU-99'] },
    );

    expect(problemsOf(trace)).toStrictEqual([
      `${PLAYERS}:160: CA-JOU-02 is required, but no test names it and the register does not waive it.`,
      'Required IDs: JOU-99 is required, but the specs define no such ID.',
    ]);
  });

  it('requires every requirement and criterion when strict', () => {
    const trace = traceIds(
      { specs: SPECS, tags: [tag('JOU-04')], entries: [] },
      { strict: true, required: [] },
    );

    expect(problemsOf(trace)).toStrictEqual([
      `${PLAYERS}:83: JOU-05 is required, but no test names it and the register does not waive it.`,
      `${PLAYERS}:160: CA-JOU-02 is required, but no test names it and the register does not waive it.`,
    ]);
  });
});
