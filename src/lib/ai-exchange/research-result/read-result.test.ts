import { describe, expect, it } from 'vitest';

import explorationResponse from '@data/fixtures/ai-exchange/extract-json/exploration-response.json';
import frenchKeys from '@data/fixtures/ai-exchange/research-result/reading/french-keys.json';
import example from '@data/fixtures/ai-exchange/research-result/reading/full-example.json';
import cutInsideHeader from '@data/fixtures/ai-exchange/research-result/recovery/cut-inside-header.json';

import { canonicalValue } from '../conventions';
import { readResult } from './read-result';

import type { DateReading } from './dates';
import type {
  ContextIndications,
  ResearchEvent,
  ResearchResult,
  ResearchSource,
  UnverifiedLead,
} from './format';
import type { ReadResultOutcome, ReadResultWarning, TruncationRecovery } from './read-result';

// The keys of format 1.0 that object literals cannot spell.
const FORMAT_VERSION = 'format_version';
const REQUEST_REFERENCE = 'request_reference';
const COVERED_TYPES = 'covered_types';
const COVERED_PERIOD = 'covered_period';
const UNVERIFIED_LEADS = 'unverified_leads';
const PUBLIC_DATE = 'public_date';
const UNVERIFIED_NOTE = 'unverified_note';
const APPROXIMATE_PERIOD = 'approximate_period';
const EVENT_TYPE = 'event_type';
const INJURY_RETURN = 'injury_return';
const GAME_STAKES = 'game_stakes';

// The codes of the reader that the tests name often.
const TYPES = 'covered_types_invalid';
const PERIOD = 'covered_period_invalid';
const EVENTS = 'events_missing';
const UNSORTED = 'events_not_sorted';

// The types of the request that the example answers, from 2019-10-23 to 2026-11-11.
const REQUESTED = ['player-conflict', 'public-humiliation', 'racist-abuse', 'record-approach'];
const PLAYER_ID = '8b2e4f6a-1c3d-4a5b-9e7f-0a1b2c3d4e5f';

const [HUMILIATION, CONFLICT, RECORD] = example.events;
const [SNEER, TAUNT] = HUMILIATION?.sources ?? [];
const [LEAD] = example.unverified_leads;

const day = (text: string): DateReading => ({
  ok: true,
  text,
  date: { kind: 'date', on: text },
  warning: undefined,
});

/** A date and time of the example, each of which is written at UTC-05:00. */
const eastern = (text: string, at: number): DateReading => ({
  ok: true,
  text,
  date: { kind: 'instant', on: text.slice(0, 10), at, offsetMinutes: -300 },
  warning: undefined,
});

const MISSING_DATE: DateReading = { ok: false, error: { kind: 'missing' } };
const NO_CONTEXT = { injuryReturn: undefined, gameStakes: undefined, detail: undefined };

/** A source of the example as read: its texts as written, and its publication date. */
const sourceOf = (raw: typeof SNEER, publicationDate: DateReading): ResearchSource => ({
  url: raw?.url,
  outlet: raw?.outlet,
  title: raw?.title,
  publicationDate,
});

const SNEER_READ = sourceOf(SNEER, eastern('2021-01-14T23:40-05:00', Date.UTC(2021, 0, 15, 4, 40)));
const TAUNT_READ = sourceOf(TAUNT, day('2021-01-15'));
const CONFLICT_CONTEXT: ContextIndications = {
  injuryReturn: 'no',
  gameStakes: 'high',
  detail: 'Next game: Game 7 of a playoff series.',
};

const HUMILIATION_READ: ResearchEvent = {
  eventType: 'public-humiliation',
  publicDate: eastern('2021-01-14T23:10-05:00', Date.UTC(2021, 0, 15, 4, 10)),
  description: HUMILIATION?.description,
  sources: [SNEER_READ, TAUNT_READ],
  context: { injuryReturn: 'no', gameStakes: 'normal', detail: undefined },
  researchConfidence: 'high',
  unverifiedNote: undefined,
};

const CONFLICT_READ: ResearchEvent = {
  eventType: 'player-conflict',
  publicDate: day('2023-04-26'),
  description: CONFLICT?.description,
  sources: [sourceOf(CONFLICT?.sources[0], day('2023-04-26'))],
  context: CONFLICT_CONTEXT,
  researchConfidence: 'medium',
  unverifiedNote: 'Only one source found; publication time unknown.',
};

const RECORD_READ: ResearchEvent = {
  eventType: 'record-approach',
  publicDate: day('2025-12-02'),
  description: RECORD?.description,
  sources: [sourceOf(RECORD?.sources[0], day('2025-12-02'))],
  context: { injuryReturn: 'yes', gameStakes: 'normal', detail: RECORD?.context.detail },
  researchConfidence: 'low',
  unverifiedNote: RECORD?.unverified_note,
};

const LEAD_READ: UnverifiedLead = {
  eventType: 'racist-abuse',
  approximatePeriod: '2020-21 season',
  description: LEAD?.description,
  reason: 'No source published before the game concerned was found.',
};

/** The full example of 05 in English, every field typed, its texts as written (CL-BKT-02). */
const EXAMPLE_RESULT: ResearchResult = {
  formatVersion: '1.0',
  reference: 'REQ-2026-0007',
  player: { id: PLAYER_ID, name: 'Player A' },
  coveredTypes: ['record-approach', 'player-conflict', 'public-humiliation', 'racist-abuse'],
  coveredPeriod: { startOn: '2019-10-23', endOn: '2026-11-11' },
  events: [HUMILIATION_READ, CONFLICT_READ, RECORD_READ],
  unverifiedLeads: [LEAD_READ],
  declaredLimitations: example.limitations,
};

const NO_LIST: Partial<ResearchResult> = { unverifiedLeads: [], declaredLimitations: [] };

/** The example with these root members changed, written compact; an undefined one is left out. */
const pasted = (changes: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ ...example, ...changes });

/** A covered period as the format writes it. */
const periodOf = (start: string, end: string): Record<string, unknown> => ({
  [COVERED_PERIOD]: { start, end },
});

/** The context of an event as the format writes it. */
const contextOf = (injuryReturn: string, gameStakes: string): Record<string, string> => ({
  [INJURY_RETURN]: injuryReturn,
  [GAME_STAKES]: gameStakes,
});

/** The text up to the end of the first `marker` in it. */
const cutAfter = (text: string, marker: string): string =>
  text.slice(0, text.indexOf(marker) + marker.length);

/** The text with `written` in place of the first `marker` in it. */
function replaced(text: string, marker: string, written: string): string {
  const at = text.indexOf(marker);
  return `${text.slice(0, at)}${written}${text.slice(at + marker.length)}`;
}

const read = (text: string): ReadResultOutcome => readResult(text, REQUESTED);

const resultWith = (changes: Partial<ResearchResult>): ResearchResult => ({
  ...EXAMPLE_RESULT,
  ...changes,
});

const accepted = (
  result: ResearchResult,
  resultWarnings: readonly ReadResultWarning[] = [],
  recovery?: TruncationRecovery,
): ReadResultOutcome => ({ ok: true, result, resultWarnings, recovery });

/** The outcome that refuses the whole result with these blocking errors, in their order. */
const refused = (
  kinds: readonly string[],
  resultWarnings: readonly ReadResultWarning[] = [],
): unknown => ({ ok: false, errors: kinds.map((kind) => ({ kind })), resultWarnings });

/** The outcome that refuses the whole result with one error at a place of the text. */
const refusedAt = (kind: string, path: readonly (number | string)[]): unknown => ({
  ok: false,
  errors: [{ kind, path }],
  resultWarnings: [],
});

/** What the recovery says of a result cut inside its events list, but for `changes`. */
const recovery = (changes: Partial<TruncationRecovery>): TruncationRecovery => ({
  truncationRecovered: true,
  recoveredEventCount: 0,
  retainedCoverageEmpty: false,
  lostLists: ['unverified_leads', 'limitations'],
  eventsListComplete: false,
  ...changes,
});

describe('readResult', () => {
  it('[BKT-24] [CA-BKT-13] [CL-BKT-02] reads the full example of 05, written with English keys, values and texts, with no blocking error and no warning, every field typed', () => {
    expect(read(JSON.stringify(example))).toStrictEqual(accepted(EXAMPLE_RESULT));
  });

  it('[IMP-04] [IMP-06] isolates the result from the prose and the fences around it, over an exploration response pasted with it', () => {
    const backtest = ['And the backtest:', '```json', JSON.stringify(example, null, 2), '```'];
    const answer = [...explorationResponse.pasted, ...backtest].join('\n');

    expect(read(answer)).toStrictEqual(accepted(EXAMPLE_RESULT));
  });

  it('[BKT-23] reads an empty result, its covered types and period declared, as a valid one with zero events, over a period of one day', () => {
    const text = pasted({ ...periodOf('2026-11-11', '2026-11-11'), events: [] });
    const coveredPeriod = { startOn: '2026-11-11', endOn: '2026-11-11' };

    expect(read(text)).toStrictEqual(accepted(resultWith({ coveredPeriod, events: [] })));
  });

  it('[IMP-04] refuses the whole result as JSON isolation reports a text with no JSON object, two different results or a syntax error', () => {
    const twoResults = `${pasted()}\n${pasted({ format: ' egoscope-backtest' })}`;
    const marker = replaced(pasted(), '"high"}', '"high"} [3]');

    expect(read('The research found nothing.')).toStrictEqual(refused(['no_result_found']));
    expect(read(twoResults)).toStrictEqual(refused(['several_results']));
    expect(read(marker)).toStrictEqual(refusedAt('syntax_error', ['events', 0]));
  });

  it.each(['2.0', '1.1', '1.00', 'v1.0', 2, 1.5, true, { major: 1 }])(
    '[IMP-06] refuses the whole result whose format_version is %j as of an unknown version',
    (version) => {
      const text = pasted({ [FORMAT_VERSION]: version });

      expect(read(text)).toStrictEqual(refused(['unknown_version']));
    },
  );

  it.each([
    ['an exploration response', explorationResponse.pasted.join('\n')],
    ['one with the members of a result', pasted({ format: 'egoscope-exploration' })],
    ['another format value', pasted({ format: 'egoscope-backtests' })],
    ['a format with an underscore for its hyphen', pasted({ format: 'egoscope_backtest' })],
    ['a format that is no text', pasted({ format: 7 })],
    ['no format nor covered period', pasted({ format: undefined, [COVERED_PERIOD]: undefined })],
  ])('[IMP-06] [CL-IMP-22] refuses %s as not a backtest result', (_case, text) => {
    expect(read(text)).toStrictEqual(refused(['not_a_backtest_result']));
  });

  it.each(['"1"', '" 1 "', '1', '1.0'])(
    '[IMP-06] [CL-IMP-06] reads format_version written %s as version 1.0, with a warning',
    (written) => {
      const text = replaced(pasted(), '"1.0"', written);

      expect(read(text)).toStrictEqual(accepted(EXAMPLE_RESULT, [{ kind: 'version_normalized' }]));
    },
  );

  it.each([
    ['no format', { format: undefined }],
    ['a null format', { format: null }],
    ['no version', { [FORMAT_VERSION]: undefined }],
    ['a blank version', { [FORMAT_VERSION]: '  ' }],
    ['neither', { format: undefined, [FORMAT_VERSION]: undefined }],
  ])(
    '[IMP-06] [CL-IMP-06] reads a result with %s, its structure recognized, as version 1.0, with a warning',
    (_case, changes) => {
      const warning: ReadResultWarning = { kind: 'format_or_version_missing' };

      expect(read(pasted(changes))).toStrictEqual(accepted(EXAMPLE_RESULT, [warning]));
    },
  );

  it('[IMP-06] [IMP-16] [CL-BKT-02] reads the French keys as unknown fields: the result names its format, version 1.0 is assumed, and its members are missing', () => {
    const warnings: ReadResultWarning[] = [
      { kind: 'format_or_version_missing' },
      { kind: 'lists_missing' },
      { kind: 'unknown_fields', detail: 8 },
    ];

    expect(read(JSON.stringify(frenchKeys))).toStrictEqual(
      refused([TYPES, PERIOD, EVENTS], warnings),
    );
  });

  it.each([
    ['no covered types', { [COVERED_TYPES]: undefined }, TYPES],
    ['covered types in a text', { [COVERED_TYPES]: 'public-humiliation' }, TYPES],
    ['empty covered types', { [COVERED_TYPES]: [] }, TYPES],
    ['no requested type', { [COVERED_TYPES]: ['media-storm', 'public_humiliation', 7] }, TYPES],
    ['no covered period', { [COVERED_PERIOD]: undefined }, PERIOD],
    ['a covered period in a text', { [COVERED_PERIOD]: '2019/2026' }, PERIOD],
    ['a covered period in a list', { [COVERED_PERIOD]: [{ start: '2019-10-23' }] }, PERIOD],
    ['a null covered period', { [COVERED_PERIOD]: null }, PERIOD],
    ['no start', { [COVERED_PERIOD]: { end: '2026-11-11' } }, PERIOD],
    ['a day that does not exist', periodOf('2019-10-23', '2026-02-30'), PERIOD],
    ['a malformed start', periodOf('October 2019', '2026-11-11'), PERIOD],
    ['a start after the end', periodOf('2026-11-12', '2026-11-11'), PERIOD],
    ['no events', { events: undefined }, EVENTS],
    ['null events', { events: null }, EVENTS],
    ['events in an object', { events: { count: 3 } }, EVENTS],
  ])('[IMP-09] refuses the whole result with %s', (_case, changes, kind) => {
    expect(read(pasted(changes))).toStrictEqual(refused([kind]));
  });

  it('[IMP-09] gives the blocking errors with the warnings of the other members', () => {
    const repeated = { [COVERED_TYPES]: [...REQUESTED, 'Public-Humiliation'], events: {} };
    const timed = { ...periodOf('2019-10-23 08:00', '2026-11-11'), events: 1 };

    expect(read(pasted(repeated))).toStrictEqual(
      refused([EVENTS], [{ kind: 'covered_type_repeated' }]),
    );
    expect(read(pasted(timed))).toStrictEqual(
      refused([EVENTS], [{ kind: 'covered_period_time_ignored' }]),
    );
  });

  it.each([
    ['no leads', { [UNVERIFIED_LEADS]: undefined }, { unverifiedLeads: [] }],
    ['null limitations', { limitations: null }, { declaredLimitations: [] }],
    ['limitations in a text', { limitations: 'None.' }, { declaredLimitations: [] }],
    ['neither list', { [UNVERIFIED_LEADS]: undefined, limitations: undefined }, NO_LIST],
  ])(
    '[IMP-09] reads a result with %s with that list empty, and one warning',
    (_case, changes, empty) => {
      expect(read(pasted(changes))).toStrictEqual(
        accepted(resultWith(empty), [{ kind: 'lists_missing' }]),
      );
    },
  );

  it('[IMP-09] [CL-IMP-23] [CL-IMP-22] counts a covered type listed more than once, in any spelling, once, with a warning, and leaves out an element that is no text', () => {
    const types = [...REQUESTED, ' Record-Approach', 'media-storm', 'Média-Storm', 7, null, '', {}];
    const result = resultWith({ coveredTypes: [...REQUESTED, 'media-storm'] });

    expect(read(pasted({ [COVERED_TYPES]: types }))).toStrictEqual(
      accepted(result, [{ kind: 'covered_type_repeated' }]),
    );
  });

  it('[CL-IMP-22] compares the format, its version, the covered types and the enumerated values trimmed and without case or accents, a hyphen not an underscore', () => {
    const events = [
      { ...HUMILIATION, confidence: ' HIGH ', context: contextOf('No', 'NORMAL') },
      { ...CONFLICT, confidence: 'Médium', context: contextOf(' unknown', 'Unknown') },
      { ...RECORD, confidence: 'haute', context: contextOf('oui', 'fort') },
    ];
    const types = [' RECORD-approach', 'Plàyer-Conflict', 'public-humiliation', 'racist_abuse'];
    const format = { format: ' Egoscope-BACKTEST ', [FORMAT_VERSION]: ' 1.0 ' };
    const unknown: ContextIndications = {
      ...NO_CONTEXT,
      injuryReturn: 'unknown',
      gameStakes: 'unknown',
    };
    const conflict = { ...CONFLICT_READ, context: unknown };
    const record = { ...RECORD_READ, researchConfidence: undefined, context: NO_CONTEXT };
    const result = resultWith({
      coveredTypes: ['record-approach', 'player-conflict', 'public-humiliation', 'racist_abuse'],
      events: [HUMILIATION_READ, conflict, record],
    });

    expect(read(pasted({ ...format, [COVERED_TYPES]: types, events }))).toStrictEqual(
      accepted(result),
    );
  });

  it('[CL-IMP-22] gives the reference and the player as written, which compare with the request trimmed and without case or accents, a hyphen not an underscore', () => {
    const reference = ' req-2026-0007 ';
    const player = { id: ` ${PLAYER_ID.toUpperCase()}`, name: 'Plâyer A' };
    const text = pasted({ [REQUEST_REFERENCE]: reference, player });

    expect(read(text)).toStrictEqual(accepted(resultWith({ reference, player })));
    expect(canonicalValue(reference, ['REQ-2026-0007'])).toBe('REQ-2026-0007');
    expect(canonicalValue(player.id, [PLAYER_ID])).toBe(PLAYER_ID);
    expect(canonicalValue('REQ_2026_0007', ['REQ-2026-0007'])).toBeUndefined();
  });

  it('[IMP-16] drops the keys that the format does not define, at every level, camel-cased and French ones included, and reports them once with their count', () => {
    const additions = [
      ['{"format":', '{"generatedBy":"A research tool","format":'],
      ['"name":"Player A"', '"name":"Player A","team":"Team X"'],
      ['"end":"2026-11-11"', '"end":"2026-11-11","timeZone":"UTC"'],
      ['"high"', '"high","stats":{"points":31,"rebounds":9},"publicDate":1,"confiance":2'],
      ['"normal"}', '"normal","opponent":"Team Y"}'],
      ['"2021-01-15"', '"2021-01-15","author":"A writer"'],
      ['"reason":', '"sourceUrl":"https://www.archive.example/2021","reason":'],
    ] as const;
    let text = pasted();
    for (const [marker, written] of additions) {
      text = replaced(text, marker, written);
    }
    const warning: ReadResultWarning = { kind: 'unknown_fields', detail: 9 };

    expect(read(text)).toStrictEqual(accepted(EXAMPLE_RESULT, [warning]));
  });

  it('[CL-IMP-06] reads null or a blank text as an absent optional field, with no warning, and as a missing required one, as it reads a value that is no text', () => {
    const sources = [{ ...SNEER, url: '  ', outlet: null }, TAUNT, 'https://www.media.example/a'];
    const events = [
      { ...HUMILIATION, description: null, [PUBLIC_DATE]: '', sources },
      { ...CONFLICT, context: { ...CONFLICT?.context, detail: null }, [UNVERIFIED_NOTE]: '' },
      { ...RECORD, context: 'unknown', confidence: null },
    ];
    const leads = [{ ...LEAD, [APPROXIMATE_PERIOD]: null, [EVENT_TYPE]: '  ' }];
    const limitations = [...example.limitations, '', { text: 'Local outlets' }];
    const changes = { events, [UNVERIFIED_LEADS]: leads, limitations, [REQUEST_REFERENCE]: null };
    const humiliation = { ...HUMILIATION_READ, description: undefined, publicDate: MISSING_DATE };
    const sneer = { ...SNEER_READ, url: undefined, outlet: undefined };
    const conflict = { ...CONFLICT_READ, context: { ...CONFLICT_CONTEXT, detail: undefined } };
    const result = resultWith({
      reference: undefined,
      events: [
        { ...humiliation, sources: [sneer, TAUNT_READ, sourceOf(undefined, MISSING_DATE)] },
        { ...conflict, unverifiedNote: undefined },
        { ...RECORD_READ, context: NO_CONTEXT, researchConfidence: undefined },
      ],
      unverifiedLeads: [{ ...LEAD_READ, approximatePeriod: undefined, eventType: undefined }],
      declaredLimitations: [...example.limitations, undefined, undefined],
    });

    expect(read(pasted(changes))).toStrictEqual(accepted(result));
  });

  it.each([
    [periodOf('2019-10-23T08:00+02:00', '2026-11-11')],
    [periodOf('2019-10-23', '2026-11-11T23:59Z')],
    [periodOf('2019-10-23 00:00', '2026-11-11T12:00')],
  ])(
    '[CL-IMP-08] [IMP-09] keeps the date part of a covered-period bound written with a time, with a whole-result warning: %j',
    (period) => {
      const warning: ReadResultWarning = { kind: 'covered_period_time_ignored' };

      expect(read(pasted(period))).toStrictEqual(accepted(EXAMPLE_RESULT, [warning]));
    },
  );

  it.each([
    ['the second event comes before the first', [CONFLICT, HUMILIATION, RECORD], 2],
    [
      'an undated event lies between two out of order',
      [RECORD, { [PUBLIC_DATE]: 'May' }, CONFLICT],
      3,
    ],
  ])(
    '[CL-IMP-19] [CL-BKT-15] warns that the events are not sorted, from the first one out of order, when %s',
    (_case, events, position) => {
      expect(read(pasted({ events })).resultWarnings).toStrictEqual([
        { kind: UNSORTED, detail: position },
      ]);
    },
  );

  it('[IMP-05] [CL-IMP-18] reads a cut answer that the recovery allows like a whole result, with its shortened period, its recovered events and what the recovery says', () => {
    const answer = ['The backtest:', '```json', JSON.stringify(example, null, 2)].join('\n');
    const cut = cutAfter(answer, '"description": "A national outlet notes');
    const coveredPeriod = { startOn: '2019-10-23', endOn: '2023-04-25' };
    const result = resultWith({
      ...NO_LIST,
      coveredPeriod,
      events: [HUMILIATION_READ, CONFLICT_READ],
    });

    expect(read(cut)).toStrictEqual(accepted(result, [], recovery({ recoveredEventCount: 2 })));
  });

  it('[IMP-05] [CL-IMP-18] refuses a cut answer that the recovery does not allow as cut, at the place of the cut', () => {
    const unsorted = pasted({ events: [CONFLICT, HUMILIATION, RECORD] });
    const cut = cutAfter(unsorted, '"description":"A national outlet notes');
    const inHeader = cutInsideHeader.pasted.join('\n');

    expect(read(inHeader)).toStrictEqual(refusedAt('cut_not_recoverable', [COVERED_PERIOD, 'end']));
    expect(read(cut)).toStrictEqual(refusedAt('cut_not_recoverable', ['events', 2, 'description']));
  });

  it('[IMP-05] [CL-IMP-18] reads a result cut after its closed events list with its covered period as written, unsorted events with their warning, and no missing-list warning for a list that the cut lost', () => {
    const marker = '"limitations":["2019-20';
    const whole = cutAfter(pasted(), marker);
    const unsorted = cutAfter(pasted({ events: [CONFLICT, HUMILIATION, RECORD] }), marker);
    const lostLists: TruncationRecovery['lostLists'] = ['limitations'];
    const lost = recovery({ recoveredEventCount: 3, lostLists, eventsListComplete: true });
    const result = resultWith({ declaredLimitations: [] });
    const events = [CONFLICT_READ, HUMILIATION_READ, RECORD_READ];
    const warning: ReadResultWarning = { kind: UNSORTED, detail: 2 };

    expect(read(whole)).toStrictEqual(accepted(result, [], lost));
    expect(read(unsorted)).toStrictEqual(accepted({ ...result, events }, [warning], lost));
  });

  it('[CL-IMP-18] reads a recovered result whose shortened covered period ends before its start, its retained coverage empty, without refusing it', () => {
    const text = pasted(periodOf('2021-01-14', '2026-11-11'));
    const cut = cutAfter(text, '"description":"Verbal altercation');
    const coveredPeriod = { startOn: '2021-01-14', endOn: '2021-01-13' };
    const result = resultWith({ ...NO_LIST, coveredPeriod, events: [HUMILIATION_READ] });
    const empty = recovery({ recoveredEventCount: 1, retainedCoverageEmpty: true });

    expect(read(cut)).toStrictEqual(accepted(result, [], empty));
  });

  it('reads lists nested a hundred thousand levels deep in any member without overflowing the stack', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    let text = replaced(pasted(), '"covered_types":[', `"covered_types":[${deep},`);
    text = replaced(text, '"events":[', `"events":[${deep},`);
    text = replaced(text, '"limitations":[', `"stats":${deep},"limitations":[${deep},`);
    const noEvent: ResearchEvent = {
      ...HUMILIATION_READ,
      eventType: undefined,
      publicDate: MISSING_DATE,
      description: undefined,
      sources: [],
      context: NO_CONTEXT,
      researchConfidence: undefined,
    };
    const events = [noEvent, ...EXAMPLE_RESULT.events];
    const declaredLimitations = [undefined, ...example.limitations];
    const warning: ReadResultWarning = { kind: 'unknown_fields', detail: 1 };

    expect(read(text)).toStrictEqual(
      accepted(resultWith({ events, declaredLimitations }), [warning]),
    );
  });
});
