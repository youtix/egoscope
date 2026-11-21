import { describe, expect, it } from 'vitest';

import { checkScope } from './check-scope';
import { readDate } from './dates';

import type { Scope, ScopeFacts, SplitChoice } from './check-scope';
import type { ResearchEvent } from './format';

const WHOLE_REQUEST = { startOn: '2019-10-01', endOn: '2026-11-11' };

// The taxonomy today: T2 and T6 merged into T1 after the request, the first sheet covering
// the union and the second not; T3 split into T4 and T5; the record approach withdrawn
// since the request; two calendar-derived types.
const FACTS: ScopeFacts = {
  taxonomy: [
    { id: 'public-humiliation', standing: 'research', status: 'validated' },
    { id: 'player-conflict', standing: 'research', status: 'validated' },
    { id: 'racist-abuse', standing: 'research', status: 'validated' },
    { id: 'record-approach', standing: 'research', status: 'withdrawn' },
    { id: 'trade-request', standing: 'research', status: 'validated' },
    { id: 'media-storm', standing: 'research', status: 'proposed' },
    { id: 't1', standing: 'research', status: 'validated' },
    { id: 't2', standing: 'merged', survivorId: 't1', mergeVersion: 4, mergeCoversUnion: true },
    { id: 't6', standing: 'merged', survivorId: 't1', mergeVersion: 4, mergeCoversUnion: false },
    {
      id: 't3',
      standing: 'split',
      resultingTypes: [
        { id: 't4', version: 1 },
        { id: 't5', version: 2 },
      ],
    },
    { id: 'birthday-game', standing: 'calendar_derived' },
    { id: 'former-team-game', standing: 'calendar_derived' },
  ],
  requestedTypes: [
    { id: 'public-humiliation', period: WHOLE_REQUEST, sheetVersion: 3 },
    {
      id: 'player-conflict',
      period: { startOn: '2021-01-01', endOn: '2023-12-31' },
      sheetVersion: 1,
    },
    { id: 'racist-abuse', period: WHOLE_REQUEST, sheetVersion: 1 },
    { id: 'record-approach', period: WHOLE_REQUEST, sheetVersion: 2 },
    { id: 't2', period: WHOLE_REQUEST, sheetVersion: 2 },
    { id: 't6', period: WHOLE_REQUEST, sheetVersion: 3 },
    { id: 't3', period: WHOLE_REQUEST, sheetVersion: 1 },
    { id: 'birthday-game', period: WHOLE_REQUEST, sheetVersion: 1 },
  ],
  coveredTypes: ['public-humiliation', 'player-conflict', 'record-approach', 't2', 't3', 't6'],
  declaredPeriod: { startOn: '2020-01-01', endOn: '2026-06-30' },
  firstNbaGameOn: '2019-10-23',
  splitChoices: [],
};

/** An event of this type and public date; the checks of its scope read nothing else. */
const event = (
  eventType: string | undefined,
  publicDate: unknown = '2021-01-14',
): ResearchEvent => ({
  eventType,
  publicDate: readDate(publicDate),
  description: undefined,
  sources: [],
  context: { injuryReturn: undefined, gameStakes: undefined, detail: undefined },
  researchConfidence: undefined,
  unverifiedNote: undefined,
});

/** The scope of the event at position 1, the facts changed as given. */
const scopeOf = (
  eventType: string | undefined,
  publicDate?: unknown,
  facts: Partial<ScopeFacts> = {},
): Scope => checkScope(event(eventType, publicDate), 1, { ...FACTS, ...facts });

/** What the scope of each event decides: the reason it is ignored, its refusals, or `valid`. */
const decisions = (scopes: readonly Scope[]): readonly string[] =>
  scopes.map((scope) => {
    if (scope.kind === 'ignored') {
      return scope.reason;
    }
    return scope.kind === 'valid' ? 'valid' : scope.refusals.map(({ reason }) => reason).join(',');
  });

const ON_14_JANUARY = { kind: 'date', on: '2021-01-14' } as const;

/** A valid scope of a type as the request has it, on 2021-01-14, without warnings. */
const validType = (typeId: string, sheetVersion: number): Scope => ({
  kind: 'valid',
  type: { kind: 'type', typeId, sheetVersion, toRequalify: false },
  publicDate: ON_14_JANUARY,
  warnings: [],
});

/** The facts with the owner's answer for the split type at a position. */
const answer = (choice: SplitChoice['choice'], position = 1): Partial<ScopeFacts> => ({
  splitChoices: [{ position, choice }],
});

describe('checkScope', () => {
  it('[IMP-11] [CA-IMP-05] ignores an event of a type withdrawn since the request as not validated to date, which is no refusal', () => {
    expect(scopeOf('record-approach')).toStrictEqual({
      kind: 'ignored',
      reason: 'type_not_validated',
    });
    expect(scopeOf('public-humiliation')).toStrictEqual(validType('public-humiliation', 3));
  });

  it('[IMP-11] [CA-IMP-23] [CL-IMP-21] attaches a type absorbed by a merge to the survivor, with a warning and the version of CL-IMP-21', () => {
    const attached = { kind: 'attached_to_surviving_type', typeId: 't1' } as const;
    expect(scopeOf('t2')).toStrictEqual({
      ...validType('t1', 4),
      warnings: [attached],
    });
    expect(scopeOf('t6')).toStrictEqual({
      ...validType('t1', 3),
      type: { kind: 'type', typeId: 't1', sheetVersion: 3, toRequalify: true },
      warnings: [attached],
    });
  });

  it('[IMP-11] [CA-IMP-23] asks for one of the types of a split, or to ignore the event, and takes the answer for its position', () => {
    const choice = { kind: 'split_choice', splitTypeId: 't3', resultingTypeIds: ['t4', 't5'] };
    expect(scopeOf('t3')).toStrictEqual({ ...validType('t3', 1), type: choice });
    expect(scopeOf('t3', undefined, answer({ typeId: 't5' }))).toStrictEqual(validType('t5', 2));
    expect(scopeOf('t3', undefined, answer({ typeId: 't5' }, 2))).toMatchObject({ type: choice });
    expect(scopeOf('t3', undefined, answer({ typeId: 't1' }))).toMatchObject({ type: choice });
    expect(scopeOf('t3', undefined, answer('ignore'))).toStrictEqual({
      kind: 'ignored',
      reason: 'split_type_ignored',
    });
  });

  it('[IMP-11] [CL-IMP-29] ignores a calendar-derived type whatever the request, and a type the request did not hold', () => {
    const types = ['birthday-game', 'former-team-game', 'trade-request', 'media-storm'];
    expect(decisions(types.map((type) => scopeOf(type)))).toStrictEqual([
      'calendar_derived_type',
      'calendar_derived_type',
      'type_not_requested',
      'type_not_requested',
    ]);
  });

  it('[IMP-11] [CL-IMP-22] refuses a missing or unknown type, and compares types without case, accents or outer spaces', () => {
    const types = [
      undefined,
      'press-conference',
      'public_humiliation',
      ' Public-Humiliation ',
      'PUBLIC-HUMILIATIÓN',
    ];
    expect(decisions(types.map((type) => scopeOf(type)))).toStrictEqual([
      'type_missing',
      'type_unknown',
      'type_unknown',
      'valid',
      'valid',
    ]);
  });

  it('[IMP-11] accepts with a warning an event of a requested type that the result does not declare covered', () => {
    expect(scopeOf('racist-abuse')).toStrictEqual({
      ...validType('racist-abuse', 1),
      warnings: [{ kind: 'type_not_declared_covered' }],
    });
  });

  it('[IMP-12] refuses a public date that is missing, malformed or does not exist, such as 2021-02-30', () => {
    const dates = [null, '14/01/2021', 'January 14, 2021', '2021-02-30'];
    expect(decisions(dates.map((date) => scopeOf('public-humiliation', date)))).toStrictEqual([
      'public_date_missing',
      'public_date_malformed',
      'public_date_malformed',
      'public_date_nonexistent',
    ]);
  });

  it('[IMP-11] [IMP-12] lists the defects of the type and of the date, with the warnings of a valid date and of a type taken', () => {
    expect(scopeOf('press-conference', '2021-02-30')).toStrictEqual({
      kind: 'refused',
      refusals: [{ reason: 'type_unknown' }, { reason: 'public_date_nonexistent' }],
      warnings: [],
    });
    expect(scopeOf(undefined, '2021-01-14T23:10Z')).toStrictEqual({
      kind: 'refused',
      refusals: [{ reason: 'type_missing' }],
      warnings: [{ kind: 'non_standard_date' }],
    });
    expect(scopeOf('racist-abuse', null)).toStrictEqual({
      kind: 'refused',
      refusals: [{ reason: 'public_date_missing' }],
      warnings: [{ kind: 'type_not_declared_covered' }],
    });
  });

  it('[IMP-12] [CL-IMP-09] ignores a date outside the requested period of its own type, bounds included in the period', () => {
    const dates = [
      '2020-12-31',
      '2021-01-01',
      '2023-12-31',
      '2023-12-31T23:30-05:00',
      '2024-01-01',
    ];
    expect(decisions(dates.map((date) => scopeOf('player-conflict', date)))).toStrictEqual([
      'outside_requested_period',
      'valid',
      'valid',
      'valid',
      'outside_requested_period',
    ]);
    expect(decisions([scopeOf('public-humiliation', '2020-12-31')])).toStrictEqual(['valid']);
  });

  it('[IMP-12] [CL-IMP-09] ignores a date before the US date of the first NBA game, or before the declared start when that date is unknown', () => {
    const dates = ['2019-10-22', '2019-10-23', '2019-12-31', '2020-01-01'];
    const known = dates.map((date) => scopeOf('public-humiliation', date));
    const unknown = dates.map((date) =>
      scopeOf('public-humiliation', date, { firstNbaGameOn: undefined }),
    );
    expect(decisions(known)).toStrictEqual(['before_first_nba_game', 'valid', 'valid', 'valid']);
    expect(decisions(unknown)).toStrictEqual([
      'before_first_nba_game',
      'before_first_nba_game',
      'before_first_nba_game',
      'valid',
    ]);
  });

  it('[IMP-12] [IMP-19] ignores an event before the first NBA game whatever its type, since no correction of its type would bring it into the request', () => {
    const scopes = [scopeOf(undefined, '2019-10-22'), scopeOf('press-conference', '2019-10-22')];
    expect(decisions(scopes)).toStrictEqual(['before_first_nba_game', 'before_first_nba_game']);
    expect(decisions([scopeOf('press-conference', '2019-10-23')])).toStrictEqual(['type_unknown']);
  });

  it('[IMP-12] warns of a date inside the requested period but outside the declared one, its bounds included in it', () => {
    const dates = ['2019-12-31', '2020-01-01', '2026-06-30', '2026-07-01'];
    const warnings = dates.map((date) => {
      const scope = scopeOf('public-humiliation', date);
      return scope.kind === 'valid' ? scope.warnings : undefined;
    });
    const outside = [{ kind: 'outside_declared_period' }];
    expect(warnings).toStrictEqual([outside, [], [], outside]);
  });

  it('[IMP-12] [CL-IMP-08] keeps the warning of a date written in a non-standard form or whose time is ignored, after those of its type', () => {
    expect(scopeOf('racist-abuse', '2021-01-14 23:10:00+00:00')).toMatchObject({
      warnings: [{ kind: 'type_not_declared_covered' }, { kind: 'non_standard_date' }],
    });
    expect(scopeOf('public-humiliation', '2021-01-14T23:10')).toStrictEqual({
      ...validType('public-humiliation', 3),
      warnings: [{ kind: 'time_ignored' }],
    });
  });
});
