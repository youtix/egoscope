import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import quirks from '@data/fixtures/ai-exchange/research-result/event-checks/output-quirks.json';

import { checkEvents } from './check-events';
import { readDate } from './dates';
import { readResult } from './read-result';

import type { AcceptedEvent, EventCheck, EventCheckContext, ImportWarning } from './check-events';
import type { ResearchEvent, ResearchSource } from './format';

const REQUEST = { startOn: '2019-10-23', endOn: '2026-11-11' };
const ARTICLE = 'https://www.media-national.example/basket/2021/01/14/player-a-taunted';
const OTHER_ARTICLE = 'https://www.site-basket.example/news/2021/01/14/rival-mocks-player-a';
const DESCRIPTION = 'An opposing player publicly mocks player A at a press conference.';
const OUTLET = 'A national outlet (fictitious)';
const TITLE = 'Player A taunted by an opponent';
// Texts of the maximum length of 200 code points, and of one more.
const LONGEST = 'a'.repeat(200);
const TOO_LONG = 'a'.repeat(201);

const CONTEXT: EventCheckContext = {
  taxonomy: [
    { id: 'public-humiliation', standing: 'research', status: 'validated' },
    { id: 'player-conflict', standing: 'research', status: 'validated' },
    { id: 'record-approach', standing: 'research', status: 'withdrawn' },
  ],
  requestedTypes: [
    { id: 'public-humiliation', period: REQUEST, sheetVersion: 2 },
    { id: 'player-conflict', period: REQUEST, sheetVersion: 1 },
    { id: 'record-approach', period: REQUEST, sheetVersion: 1 },
  ],
  coveredTypes: ['public-humiliation', 'player-conflict', 'record-approach'],
  declaredPeriod: REQUEST,
  firstNbaGameOn: '2019-10-23',
  splitChoices: [],
  maxDescriptionLength: 200,
  maxSourcesPerEvent: 3,
  maxSourceLeadDays: 1,
  sourceRules: {
    // The cleaning of COL-28 as these tests need it, which the engine owns: no fragment.
    cleanLink: (url) => url.split('#', 1)[0] ?? url,
    disallowedDomains: ['social.example'],
    checkedAt: Date.UTC(2026, 10, 20, 12),
  },
};

/** A source of the national outlet, published on 2021-01-14 unless said otherwise. */
const source = (
  changes: Partial<Omit<ResearchSource, 'publicationDate'>> = {},
  date: unknown = '2021-01-14',
): ResearchSource => ({
  url: ARTICLE,
  outlet: OUTLET,
  title: TITLE,
  publicationDate: readDate(date),
  ...changes,
});

/** An event that every check accepts, its fields changed as given. */
const event = (changes: Partial<ResearchEvent> = {}): ResearchEvent => ({
  eventType: 'public-humiliation',
  publicDate: readDate('2021-01-14'),
  description: DESCRIPTION,
  sources: [source()],
  context: { injuryReturn: 'no', gameStakes: 'normal', detail: undefined },
  researchConfidence: 'high',
  unverifiedNote: undefined,
  ...changes,
});

/** The check of one event, the context changed as given. */
const checkOne = (
  changes: Partial<ResearchEvent> = {},
  context: Partial<EventCheckContext> = {},
): EventCheck => {
  const [check] = checkEvents([event(changes)], { ...CONTEXT, ...context });
  if (check === undefined) {
    throw new Error('checkEvents gives one check per event');
  }
  return check;
};

/** What a check decides: its outcome and its reasons. */
const decision = (check: EventCheck): string => {
  if (check.outcome === 'refused') {
    return `refused: ${check.refusals.map(({ reason }) => reason).join(', ')}`;
  }
  return check.outcome === 'ignored' ? `ignored: ${check.reason}` : check.outcome;
};

/** The warnings of a check, none for an ignored event. */
const warningsOf = (check: EventCheck | undefined): readonly ImportWarning[] =>
  check === undefined || check.outcome === 'ignored' ? [] : check.warnings;

/** The accepted event of a check, or nothing. */
const acceptedOf = (check: EventCheck | undefined): AcceptedEvent | undefined =>
  check?.outcome === 'added' || check?.outcome === 'added_with_warning' ? check.event : undefined;

/** What the check of one event decides, the context changed as given. */
const decide = (
  changes: Partial<ResearchEvent>,
  context: Partial<EventCheckContext> = {},
): string => decision(checkOne(changes, context));

/** The accepted event of the check of one event, or nothing. */
const acceptedOne = (
  changes: Partial<ResearchEvent>,
  context: Partial<EventCheckContext> = {},
): AcceptedEvent | undefined => acceptedOf(checkOne(changes, context));

/** The warnings of the check of one event. */
const warningsOne = (changes: Partial<ResearchEvent>): readonly ImportWarning[] =>
  warningsOf(checkOne(changes));

/** An event whose description repeats a character. */
const repeated = (length: number, character = 'a'): Partial<ResearchEvent> => ({
  description: character.repeat(length),
});

/** The unverified note that the check of an event keeps, and its warnings. */
const noteCheck = (
  unverifiedNote: string,
): Readonly<{ note: string | undefined; warnings: readonly ImportWarning[] }> => {
  const check = checkOne({ unverifiedNote });
  return { note: acceptedOf(check)?.unverifiedNote, warnings: warningsOf(check) };
};

/** Whether the outcome of a check agrees with what it holds (IMP-19): reasons to refuse, warnings to add with warning. */
const isSound = (check: EventCheck): boolean => {
  if (check.outcome === 'refused') {
    return check.refusals.length > 0;
  }
  if (check.outcome === 'ignored') {
    return true;
  }
  return check.outcome === (check.warnings.length > 0 ? 'added_with_warning' : 'added');
};

describe('checkEvents', () => {
  it('[IMP-19] adds an event that passes every check, with its type, its values and its sources as checked', () => {
    expect(checkOne()).toStrictEqual({
      position: 1,
      outcome: 'added',
      warnings: [],
      event: {
        type: { kind: 'type', typeId: 'public-humiliation', sheetVersion: 2, toRequalify: false },
        publicDate: { kind: 'date', on: '2021-01-14' },
        description: DESCRIPTION,
        sources: [
          {
            position: 1,
            url: ARTICLE,
            cleanedUrl: ARTICLE,
            outlet: OUTLET,
            title: TITLE,
            publicationDate: { kind: 'date', on: '2021-01-14' },
            dateWarning: undefined,
          },
        ],
        context: { injuryReturn: 'no', gameStakes: 'normal', detail: undefined },
        researchConfidence: 'high',
        unverifiedNote: undefined,
      },
    });
  });

  it('[IMP-11] [CA-IMP-05] ignores the event of a type withdrawn since the request, no refusal, and leaves the others acceptable', () => {
    const checks = checkEvents(
      [event({ eventType: 'record-approach' }), event({ eventType: 'player-conflict' })],
      CONTEXT,
    );
    expect(checks.map((check) => decision(check))).toStrictEqual([
      'ignored: type_not_validated',
      'added',
    ]);
    expect(checks[0]).toStrictEqual({
      position: 1,
      outcome: 'ignored',
      reason: 'type_not_validated',
    });
  });

  it('[IMP-13] [DSN-24] [CA-DSN-07] refuses a description of 250 characters against the default 200, counted in code points once trimmed', () => {
    expect(checkOne(repeated(250))).toMatchObject({
      outcome: 'refused',
      refusals: [{ reason: 'description_too_long', length: 250, maxLength: 200 }],
    });
    const descriptions = [repeated(201), repeated(200, '\u{1F3C0}'), { description: undefined }];
    expect(descriptions.map((changes) => decide(changes))).toStrictEqual([
      'refused: description_too_long',
      'added',
      'refused: description_missing',
    ]);
    expect(decide(repeated(250), { maxDescriptionLength: 250 })).toBe('added');
    expect(acceptedOne({ description: `  ${LONGEST} ` })?.description).toBe(LONGEST);
  });

  it('[IMP-13] [DSN-24] [CL-IMP-05] refuses a description holding a quotation mark of CL-DSN-03, naming it, and lets apostrophes pass', () => {
    const marks = ['"', '«', '»', '“', '”', '„', '‟'];
    const refusals = marks.map((mark) => {
      const check = checkOne({ description: `A rival calls player A ${mark}soft${mark}.` });
      return check.outcome === 'refused' ? check.refusals : [];
    });
    expect(refusals).toStrictEqual(
      marks.map((character) => [{ reason: 'description_quotation_mark', character }]),
    );
    expect(decide({ description: "The rival's remark about the players' union, l’équipe." })).toBe(
      'added',
    );
  });

  it('[IMP-13] [CL-IMP-03] [CL-IMP-07] only warns of statistics, a score or a citation marker in a description, kept as written', () => {
    const check = checkOne({
      description: 'Player A answers the boos with 31 points in a 102-98 win [2].',
    });
    expect(check.outcome).toBe('added_with_warning');
    expect(warningsOf(check)).toStrictEqual([
      { kind: 'possible_statistics', field: 'description' },
      { kind: 'possible_citation_marker', field: 'description' },
    ]);
    expect(acceptedOf(check)?.description).toBe(
      'Player A answers the boos with 31 points in a 102-98 win [2].',
    );
  });

  it('[IMP-15] [CL-IMP-02] [CL-IMP-05] ignores with a warning an unverified note too long, with its length and the maximum, or holding a quotation mark, naming it, and keeps another trimmed', () => {
    const field = 'unverified_note';
    expect(noteCheck(TOO_LONG)).toStrictEqual({
      note: undefined,
      warnings: [{ kind: 'text_too_long_ignored', field, length: 201, maxLength: 200 }],
    });
    expect(noteCheck('The «exact» words are not confirmed.')).toStrictEqual({
      note: undefined,
      warnings: [{ kind: 'text_quotation_mark_ignored', field, character: '«' }],
    });
    expect(noteCheck(`"${LONGEST}"`).warnings).toStrictEqual([
      { kind: 'text_too_long_ignored', field, length: 202, maxLength: 200 },
      { kind: 'text_quotation_mark_ignored', field, character: '"' },
    ]);
    expect(noteCheck(' The date of the remark is not confirmed. ')).toStrictEqual({
      note: 'The date of the remark is not confirmed.',
      warnings: [],
    });
    expect(noteCheck('He then scored 31 points [1].').warnings).toStrictEqual([
      { kind: 'possible_statistics', field },
      { kind: 'possible_citation_marker', field },
    ]);
  });

  it('[IMP-15] [CL-IMP-02] sets a missing confidence to low and a missing context value to unknown, each with a warning, and ignores a detail too long, with its length and the maximum', () => {
    const missing = checkOne({
      researchConfidence: undefined,
      context: { injuryReturn: undefined, gameStakes: undefined, detail: TOO_LONG },
    });
    expect(acceptedOf(missing)).toMatchObject({
      researchConfidence: 'low',
      context: { injuryReturn: 'unknown', gameStakes: 'unknown', detail: undefined },
    });
    expect(warningsOf(missing)).toStrictEqual([
      { kind: 'context_defaulted' },
      { kind: 'text_too_long_ignored', field: 'detail', length: 201, maxLength: 200 },
      { kind: 'confidence_defaulted' },
    ]);
    const onlyStakes = checkOne({
      context: { injuryReturn: 'yes', gameStakes: undefined, detail: ' The "return" game. ' },
    });
    expect(acceptedOf(onlyStakes)?.context).toStrictEqual({
      injuryReturn: 'yes',
      gameStakes: 'unknown',
      detail: 'The "return" game.',
    });
    expect(warningsOf(onlyStakes)).toStrictEqual([{ kind: 'context_defaulted' }]);
    const longestDetail = { injuryReturn: undefined, gameStakes: 'high', detail: LONGEST } as const;
    expect(warningsOne({ context: longestDetail })).toStrictEqual([{ kind: 'context_defaulted' }]);
  });

  it('[IMP-14] [CA-IMP-07] drops with a warning a source that is not a complete address, and refuses an event left without a source', () => {
    const incomplete = source({ url: 'www.media-national.example' });
    const dropped = { kind: 'source_dropped', position: 2, cause: 'incomplete_address' };
    const kept = checkOne({ sources: [source(), incomplete] });
    expect(kept.outcome).toBe('added_with_warning');
    expect(warningsOf(kept)).toStrictEqual([dropped]);
    expect(checkOne({ sources: [incomplete] })).toMatchObject({
      outcome: 'refused',
      refusals: [{ reason: 'no_valid_source' }],
      warnings: [{ ...dropped, position: 1 }],
    });
    expect(decide({ sources: [] })).toBe('refused: no_valid_source');
  });

  it('[IMP-14] [CA-IMP-25] [DSN-01] [DSN-03] [CA-DSN-01] refuses an event whose only source is a social-network post, for want of a valid source', () => {
    const post = source({ url: 'https://www.social.example/player-a/status/1349912' });
    expect(checkOne({ sources: [post] })).toStrictEqual({
      position: 1,
      outcome: 'refused',
      refusals: [{ reason: 'no_valid_source' }],
      warnings: [{ kind: 'source_dropped', position: 1, cause: 'disallowed_domain' }],
    });
  });

  it('[IMP-14] [CL-IMP-11] refuses a source more than a day before the public date, by the smallest lead the two values allow', () => {
    const cases = [
      ['2021-03-02T10:00+00:00', '2021-03-01T10:00+00:00', 'added'],
      ['2021-03-02T10:01+00:00', '2021-03-01T10:00+00:00', 'refused: source_before_public_date'],
      ['2021-03-01', '2021-02-28', 'added'],
      ['2021-03-01', '2021-02-27', 'refused: source_before_public_date'],
      ['2021-03-03T11:59+00:00', '2021-03-01', 'added'],
      ['2021-03-03T12:00+00:00', '2021-03-01', 'refused: source_before_public_date'],
      ['2021-03-02', '2021-02-28T10:00+00:00', 'added'],
      ['2021-03-02', '2021-02-28T09:59+00:00', 'refused: source_before_public_date'],
      ['2021-03-05', '2021-03-02', 'refused: source_before_public_date'],
      ['2021-03-06', '2021-03-01', 'refused: source_before_public_date'],
      ['2021-03-01', '2021-03-05', 'added'],
    ];
    const decided = cases.map(([publicDate, date]) => [
      publicDate,
      date,
      decide({ publicDate: readDate(publicDate), sources: [source({}, date)] }),
    ]);
    expect(decided).toStrictEqual(cases);
  });

  it('[IMP-14] [CL-IMP-11] takes the tolerated lead from imports.maxSourceLeadDays and names the source too early', () => {
    const fiveDays = {
      publicDate: readDate('2021-03-06'),
      sources: [source({}, '2021-03-06'), source({}, '2021-03-01')],
    };
    expect(checkOne(fiveDays)).toMatchObject({
      refusals: [{ reason: 'source_before_public_date', sourcePosition: 2 }],
    });
    expect(decide(fiveDays, { maxSourceLeadDays: 5 })).toBe('added');
    const twoDays = {
      publicDate: readDate('2021-03-03T10:00+00:00'),
      sources: [source({}, '2021-03-01T10:00+00:00')],
    };
    expect(decide(twoDays, { maxSourceLeadDays: 2 })).toBe('added');
  });

  it('[IMP-14] [CL-IMP-16] keeps the oldest sources up to backtests.maxSourcesPerEvent, a timed one first on its date, ties in list order', () => {
    const sources = [
      source({ url: `${ARTICLE}-1`, outlet: undefined }, '2021-01-16'),
      source({ url: `${ARTICLE}-2` }, '2021-01-15'),
      source({ url: `${ARTICLE}-3` }, '2021-01-15T20:00-0500'),
      source({ url: `${ARTICLE}-4` }, '2021-01-15T09:00+00:00'),
    ];
    const kept = checkOne({ publicDate: readDate('2021-01-15'), sources });
    expect(acceptedOf(kept)?.sources.map(({ position }) => position)).toStrictEqual([4, 3, 2]);
    expect(warningsOf(kept)).toStrictEqual([{ kind: 'non_standard_date' }]);
    // The calendar date as written decides first: the second source is the earliest instant.
    const byDate = [
      source({ url: `${ARTICLE}-1` }, '2021-01-15'),
      source({ url: `${ARTICLE}-2` }, '2021-01-16T00:30+14:00'),
      source({ url: `${ARTICLE}-3` }, '2021-01-15T20:00-05:00'),
    ];
    expect(
      acceptedOne({ publicDate: readDate('2021-01-16'), sources: byDate })?.sources.map(
        ({ position }) => position,
      ),
    ).toStrictEqual([3, 1, 2]);
    const ties = [source({ url: `${ARTICLE}-1` }), source({ url: `${ARTICLE}-2` })];
    expect(
      acceptedOne({ sources: ties }, { maxSourcesPerEvent: 1 })?.sources.map(
        ({ position }) => position,
      ),
    ).toStrictEqual([1]);
  });

  it('[IMP-14] [CL-IMP-07] only warns of a missing outlet or title and of a citation marker in a kept source, once per field', () => {
    const sources = [
      source({ title: undefined, outlet: 'Outlet [3]' }),
      source({ url: OTHER_ARTICLE, outlet: 'Another outlet [4]', title: 'Taunted¹' }),
    ];
    expect(warningsOne({ sources })).toStrictEqual([
      { kind: 'source_outlet_or_title_missing', position: 1 },
      { kind: 'possible_citation_marker', field: 'outlet' },
      { kind: 'possible_citation_marker', field: 'title' },
    ]);
  });

  it('[IMP-19] [H-IMP-01] refuses only for the defects of IMP-11 to IMP-14, listing each in the order of the format', () => {
    const allDefects = checkOne({
      eventType: 'press-conference',
      publicDate: readDate('2021-02-30'),
      description: undefined,
      sources: [],
    });
    expect(allDefects).toMatchObject({
      outcome: 'refused',
      refusals: [
        { reason: 'type_unknown' },
        { reason: 'public_date_nonexistent' },
        { reason: 'description_missing' },
        { reason: 'no_valid_source' },
      ],
    });
    const descriptionAndSource = checkOne({
      description: 'The "soft" remark.',
      sources: [source({}, '2021-01-10')],
    });
    expect(decision(descriptionAndSource)).toBe(
      'refused: description_quotation_mark, source_before_public_date',
    );
    expect(decide({ eventType: undefined, sources: [source({}, '2021-01-10')] })).toBe(
      'refused: type_missing, source_before_public_date',
    );
    expect(decide({ publicDate: readDate(null) })).toBe('refused: public_date_missing');
  });

  it('[IMP-17] [CL-IMP-13] warns each accepted event that cites a cleaned link of another accepted one, once per other event', () => {
    const checks = checkEvents(
      [
        event({ sources: [source(), source({ url: OTHER_ARTICLE })] }),
        event({ eventType: 'player-conflict', sources: [source({ url: `${ARTICLE}-2` })] }),
        event({
          eventType: 'player-conflict',
          sources: [source({ url: `${OTHER_ARTICLE}#comments` }), source({ url: `${ARTICLE}-3` })],
        }),
        event({ description: undefined, sources: [source({ url: `${ARTICLE}-2` })] }),
        event({ eventType: 'record-approach', sources: [source({ url: `${ARTICLE}-2` })] }),
      ],
      CONTEXT,
    );
    expect(checks.map((check) => decision(check))).toStrictEqual([
      'added_with_warning',
      'added',
      'added_with_warning',
      'refused: description_missing',
      'ignored: type_not_validated',
    ]);
    expect(checks.map((check) => warningsOf(check))).toStrictEqual([
      [{ kind: 'shared_link', otherPosition: 3 }],
      [],
      [{ kind: 'shared_link', otherPosition: 1 }],
      [],
      [],
    ]);
  });

  it('[CL-IMP-06] [CL-IMP-07] [CL-IMP-08] [CL-IMP-22] gives each event-level quirk of research AIs its own outcome', () => {
    const read = readResult(JSON.stringify(quirks), ['public-humiliation', 'player-conflict']);
    const checks = read.ok ? checkEvents(read.result.events, CONTEXT) : [];
    expect(checks.map((check) => [decision(check), warningsOf(check)])).toStrictEqual([
      [
        'added_with_warning',
        [
          { kind: 'possible_citation_marker', field: 'description' },
          { kind: 'possible_citation_marker', field: 'title' },
        ],
      ],
      ['added', []],
      [
        'added_with_warning',
        [{ kind: 'source_outlet_or_title_missing', position: 1 }, { kind: 'confidence_defaulted' }],
      ],
      ['refused: description_missing', []],
      ['added', []],
      ['added_with_warning', [{ kind: 'non_standard_date' }]],
      ['added_with_warning', [{ kind: 'time_ignored' }]],
      ['refused: type_missing, public_date_missing', []],
    ]);
    // The marked description kept as written, the blank optional texts absent, the
    // closed values canonical or defaulted, a midnight time read as a date alone.
    expect([0, 1, 2, 4, 6].map((index) => acceptedOf(checks[index]))).toMatchObject([
      { description: quirks.events[0]?.description },
      { unverifiedNote: undefined, context: { detail: undefined } },
      { researchConfidence: 'low' },
      {
        type: { typeId: 'public-humiliation' },
        researchConfidence: 'high',
        context: { injuryReturn: 'no', gameStakes: 'normal' },
      },
      { publicDate: { kind: 'date', on: '2021-07-01' } },
    ]);
  });

  it('[IMP-19] gives every event exactly one outcome, in its place, a refusal always with its reasons', () => {
    const anyEvent = fc.record({
      eventType: fc.constantFrom(
        undefined,
        'public-humiliation',
        'record-approach',
        'press-conference',
      ),
      publicDate: fc
        .constantFrom(null, '2021-02-30', '2021-01-14', '2018-05-01', '2021-01-14T23:10Z')
        .map((date) => readDate(date)),
      description: fc.constantFrom(undefined, DESCRIPTION, 'The "soft" remark.', TOO_LONG),
      sources: fc.subarray([
        source(),
        source({ url: 'https://news.example/' }),
        source({}, '2021-01-01'),
      ]),
      researchConfidence: fc.constantFrom(undefined, 'high' as const),
    });
    fc.assert(
      fc.property(fc.array(anyEvent, { maxLength: 8 }), (changes) => {
        const checks = checkEvents(
          changes.map((change) => event(change)),
          CONTEXT,
        );
        expect(checks.map(({ position }) => position)).toStrictEqual(
          changes.map((_, index) => index + 1),
        );
        expect(checks.every((check) => isSound(check))).toBe(true);
      }),
    );
  });

  it('[IMP-19] [H-IMP-01] never refuses nor ignores an event whose only defects warn', () => {
    const warnOnly = fc.record({
      researchConfidence: fc.constantFrom(undefined, 'low' as const),
      unverifiedNote: fc.constantFrom(
        undefined,
        TOO_LONG,
        'The "words" are unconfirmed.',
        '31 points [1]',
      ),
      context: fc.record({
        injuryReturn: fc.constantFrom(undefined, 'yes' as const),
        gameStakes: fc.constantFrom(undefined, 'high' as const),
        detail: fc.constantFrom(undefined, TOO_LONG),
      }),
      sources: fc
        .subarray([
          source({ url: 'https://news.example/' }),
          source({ outlet: undefined, title: 'Taunted [2]' }, '2021-01-14T23:10Z'),
        ])
        .map((extra) => [source(), ...extra]),
      description: fc.constantFrom(DESCRIPTION, 'He scored 31 points [1].'),
    });
    fc.assert(
      fc.property(warnOnly, (changes) => {
        expect(['added', 'added_with_warning']).toContain(checkOne(changes).outcome);
      }),
    );
  });
});
