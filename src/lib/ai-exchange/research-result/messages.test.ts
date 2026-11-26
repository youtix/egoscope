import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';

import refusedEvents from '@data/fixtures/ai-exchange/research-result/messages/refused-events.json';

import { checkEvents } from './check-events';
import { readDate } from './dates';
import { eventMessage } from './messages';
import { readResult } from './read-result';

import type { EventCheckContext, ImportRefusal, ImportWarning } from './check-events';
import type { ImportIgnoreReason } from './check-scope';
import type { SourceDropCause } from './check-sources';
import type { ResearchSource } from './format';
import type { EventAsRead, ImportMessage, MessageContext } from './messages';

const CONTEXT: MessageContext = { writeCount: String, maxSourceLeadDays: 1 };
const ARTICLE = 'https://www.media-national.example/basket/2021/01/14/player-a-taunted';
const PERIOD = { startOn: '2019-10-23', endOn: '2026-11-11' };
const CHECKS: EventCheckContext = {
  taxonomy: [
    { id: 'public-humiliation', standing: 'research', status: 'validated' },
    { id: 'player-conflict', standing: 'research', status: 'validated' },
    { id: 'racist-abuse', standing: 'research', status: 'validated' },
  ],
  requestedTypes: [
    { id: 'public-humiliation', period: PERIOD, sheetVersion: 1 },
    { id: 'player-conflict', period: PERIOD, sheetVersion: 1 },
  ],
  coveredTypes: ['public-humiliation', 'player-conflict'],
  declaredPeriod: PERIOD,
  firstNbaGameOn: '2019-10-23',
  splitChoices: [],
  maxDescriptionLength: 200,
  maxSourcesPerEvent: 3,
  maxSourceLeadDays: 1,
  sourceRules: {
    cleanLink: (url) => url,
    disallowedDomains: [],
    checkedAt: Date.UTC(2026, 10, 20),
  },
};

const source = (url: string | undefined, date: unknown = '2021-01-14'): ResearchSource => ({
  url,
  outlet: 'A national outlet (fictitious)',
  title: 'Player A taunted by an opponent',
  publicationDate: readDate(date),
});

/** Event 2 of a result, of the type and the public date given, with two sources. */
const at = (eventType: string | undefined, publicDate: unknown = '2021-01-14'): EventAsRead => ({
  position: 2,
  event: {
    eventType,
    publicDate: readDate(publicDate),
    description: 'An opposing player publicly mocks player A at a press conference.',
    sources: [source(ARTICLE), source(` ${ARTICLE}/ `, '2021-01-09')],
    context: { injuryReturn: 'no', gameStakes: 'normal', detail: undefined },
    researchConfidence: 'high',
    unverifiedNote: undefined,
  },
});

const EVENT_2 = at('public-humiliation');
const LOCATION = 'Event 2 (public-humiliation, 2021-01-14)';
const SOURCE_2 = `${LOCATION}, source 2`;
const NOTHING = 'Nothing to correct.';
const LEFT_OUT = 'Nothing to correct: the event is left out of this import.';
const CHECK_IT = 'Check it, and correct the event after saving if it does.';
const WITHOUT_IT = 'Nothing to correct: the event is added without it.';
const PUBLIC_DATE = 'Give the public date as YYYY-MM-DD.';
const PUBLICATION_DATE = 'Give the publication date as YYYY-MM-DD.';

/** The message of a problem of event 2 as its three parts and their text. */
const expected = (location: string, problem: string, fix: string): ImportMessage => ({
  location,
  problem,
  fix,
  text: `${location}: ${problem} ${fix}`,
});

/** The location that the message of a problem of event 2, of this type and date, gives. */
const locationOf = (eventType: string | undefined, publicDate?: unknown): string =>
  eventMessage({ reason: 'type_missing' }, at(eventType, publicDate), CONTEXT).location;

/** The messages that the checks of the fixture's events give, event by event. */
const fixtureMessages = (): readonly (readonly string[])[] => {
  const reading = readResult(JSON.stringify(refusedEvents), [
    'public-humiliation',
    'player-conflict',
  ]);
  if (!reading.ok) {
    throw new Error('The fixture is a result that the reader reads');
  }
  const { events } = reading.result;
  return checkEvents(events, CHECKS).map((check) => {
    const event = events[check.position - 1];
    if (event === undefined) {
      throw new Error('checkEvents gives one check per event, at its position');
    }
    const where = { position: check.position, event };
    const problems =
      check.outcome === 'ignored'
        ? [check.reason]
        : [...(check.outcome === 'refused' ? check.refusals : []), ...check.warnings];
    return problems.map((problem) => eventMessage(problem, where, CONTEXT).text);
  });
};

// Every refusal reason, with what its message says is wrong and how to fix it.
const REFUSALS = [
  [
    { reason: 'type_missing' },
    'the event type is missing.',
    'Give the ID of one of the requested types.',
  ],
  [
    { reason: 'type_unknown' },
    'this type is not an event type of the app.',
    'Use the ID of one of the requested types.',
  ],
  [{ reason: 'public_date_missing' }, 'the public date is missing.', PUBLIC_DATE],
  [
    { reason: 'public_date_malformed' },
    'the public date is not written in an accepted form.',
    PUBLIC_DATE,
  ],
  [{ reason: 'public_date_nonexistent' }, 'this date does not exist.', PUBLIC_DATE],
  [
    { reason: 'description_missing' },
    'the description is missing.',
    'Write one factual sentence in English.',
  ],
  [
    { reason: 'description_too_long', length: 1234, maxLength: 200 },
    'the description has 1234 characters, more than the maximum of 200.',
    'Shorten it to 200 characters at most.',
  ],
  [
    { reason: 'description_quotation_mark', character: '«' },
    'the description contains a quotation mark («).',
    'Quotations are not allowed: summarize what was said instead.',
  ],
  [
    { reason: 'no_valid_source' },
    'no valid source is left.',
    'Give at least one dated article of the public press, with its full address.',
  ],
  [
    { reason: 'source_before_public_date', sourcePosition: 2 },
    'the source is dated 2021-01-09, more than one day before the public date.',
    'Correct the public date or remove this source.',
  ],
] satisfies readonly (readonly [ImportRefusal, string, string])[];

// Every ignore reason, with what its message says is wrong and how to fix it.
const IGNORE_REASONS = [
  [
    'type_not_validated',
    'this type is not validated to date.',
    'Nothing to correct: once the type is validated, import the result again to add it.',
  ],
  [
    'type_not_requested',
    'this type is not part of the request.',
    'Nothing to correct: request a backtest of this type to add its events.',
  ],
  [
    'outside_requested_period',
    'this date is outside the period requested for this type.',
    LEFT_OUT,
  ],
  ['before_first_nba_game', "this date is before the player's first NBA game.", LEFT_OUT],
  [
    'calendar_derived_type',
    'this type is derived from the calendar.',
    'Nothing to correct: the app finds these events itself.',
  ],
  [
    'split_type_ignored',
    'you chose to ignore this event of a split type.',
    'Choose one of the types it was split into to add it.',
  ],
] satisfies readonly (readonly [ImportIgnoreReason, string, string])[];

// Every warning kind, each text it names and each cause of a dropped source, with the
// location, what is wrong and how to fix it.
const WARNINGS = [
  [
    { kind: 'attached_to_surviving_type', typeId: 'media-storm' },
    LOCATION,
    'this type was merged: the event is attached to the surviving type media-storm.',
    NOTHING,
  ],
  [
    { kind: 'type_not_declared_covered' },
    LOCATION,
    'the result does not declare this type as covered.',
    'Nothing to correct: the type stays among the coverage gaps.',
  ],
  [
    { kind: 'outside_declared_period' },
    LOCATION,
    'this date is outside the covered period that the result declares.',
    'Nothing to correct: the event is added all the same.',
  ],
  [
    { kind: 'non_standard_date' },
    LOCATION,
    'a date is written in a non-standard form.',
    'Check that it was read as meant.',
  ],
  [
    { kind: 'non_standard_date', sourcePosition: 2 },
    SOURCE_2,
    'a date is written in a non-standard form.',
    'Check that it was read as meant.',
  ],
  [
    { kind: 'time_ignored' },
    LOCATION,
    'a time without an offset, or at midnight, is ignored.',
    'Nothing to correct: the date alone is kept.',
  ],
  [
    { kind: 'time_ignored', sourcePosition: 2 },
    SOURCE_2,
    'a time without an offset, or at midnight, is ignored.',
    'Nothing to correct: the date alone is kept.',
  ],
  [
    { kind: 'possible_statistics', field: 'description' },
    LOCATION,
    'the description may contain statistics or a score.',
    CHECK_IT,
  ],
  [
    { kind: 'possible_statistics', field: 'unverified_note' },
    LOCATION,
    'the unverified note may contain statistics or a score.',
    CHECK_IT,
  ],
  [
    { kind: 'possible_citation_marker', field: 'description' },
    LOCATION,
    'the description may contain a citation marker.',
    CHECK_IT,
  ],
  [
    { kind: 'possible_citation_marker', field: 'outlet', sourcePosition: 2 },
    SOURCE_2,
    'the outlet may contain a citation marker.',
    CHECK_IT,
  ],
  [
    { kind: 'possible_citation_marker', field: 'title', sourcePosition: 2 },
    SOURCE_2,
    'the title may contain a citation marker.',
    CHECK_IT,
  ],
  [
    { kind: 'text_too_long_ignored', field: 'detail', length: 340, maxLength: 200 },
    LOCATION,
    'the context detail has 340 characters, more than the maximum of 200, and is ignored.',
    WITHOUT_IT,
  ],
  [
    { kind: 'text_too_long_ignored', field: 'unverified_note', length: 201, maxLength: 200 },
    LOCATION,
    'the unverified note has 201 characters, more than the maximum of 200, and is ignored.',
    WITHOUT_IT,
  ],
  [
    { kind: 'text_quotation_mark_ignored', field: 'unverified_note', character: '„' },
    LOCATION,
    'the unverified note contains a quotation mark („) and is ignored.',
    WITHOUT_IT,
  ],
  [
    { kind: 'confidence_defaulted' },
    LOCATION,
    'the research confidence is missing or not high, medium or low.',
    'Nothing to correct: it is set to low.',
  ],
  [
    { kind: 'context_defaulted' },
    LOCATION,
    'the context is missing or holds a value outside its list.',
    'Nothing to correct: it is set to unknown.',
  ],
  [
    { kind: 'shared_link', otherPosition: 5 },
    LOCATION,
    'this event cites the same link as event 5.',
    'Check that the two events are distinct facts.',
  ],
  [
    { kind: 'source_dropped', position: 2, cause: 'incomplete_address' },
    SOURCE_2,
    `"${ARTICLE}/" is not the full address of an article.`,
    'Give the full address, starting with https://.',
  ],
  [
    { kind: 'source_dropped', position: 2, cause: 'home_page' },
    SOURCE_2,
    `"${ARTICLE}/" is the address of a home page.`,
    'Give the address of the article itself.',
  ],
  [
    { kind: 'source_dropped', position: 2, cause: 'disallowed_domain' },
    SOURCE_2,
    `"${ARTICLE}/" is on a disallowed domain.`,
    'Give a press article instead.',
  ],
  [
    { kind: 'source_dropped', position: 2, cause: 'publication_date_missing' },
    SOURCE_2,
    'the publication date is missing.',
    PUBLICATION_DATE,
  ],
  [
    { kind: 'source_dropped', position: 2, cause: 'publication_date_malformed' },
    SOURCE_2,
    'the publication date is malformed or does not exist.',
    PUBLICATION_DATE,
  ],
  [
    { kind: 'source_dropped', position: 2, cause: 'publication_date_in_future' },
    SOURCE_2,
    'the source is dated 2021-01-09, after the import day.',
    'Correct the publication date or remove this source.',
  ],
  [
    { kind: 'source_outlet_or_title_missing', position: 1 },
    `${LOCATION}, source 1`,
    'the outlet or the title is missing.',
    'Nothing to correct: the source is kept.',
  ],
] satisfies readonly (readonly [ImportWarning, string, string, string])[];

describe('eventMessage', () => {
  it('[IMP-20] [CA-IMP-06] refuses event 4 dated 2021-02-30 with its location, the date that does not exist and the format to use', () => {
    expect(fixtureMessages()[3]).toStrictEqual([
      'Event 4 (public-humiliation, 2021-02-30): this date does not exist. Give the public date as YYYY-MM-DD.',
    ]);
  });

  it('[IMP-14] [CA-IMP-08] asks to correct the public date or to remove the source dated five days before it, located at that source', () => {
    expect(fixtureMessages()[4]).toStrictEqual([
      'Event 5 (public-humiliation, 2021-03-05), source 2: the source is dated 2021-02-28, more than one day before the public date. Correct the public date or remove this source.',
    ]);
  });

  it('[IMP-20] [CL-IMP-02] gives every refusal of an event its location, what is wrong and how to fix it', () => {
    expectTypeOf<
      Exclude<ImportRefusal['reason'], (typeof REFUSALS)[number][0]['reason']>
    >().toBeNever();
    for (const [refusal, problem, fix] of REFUSALS) {
      const location = 'sourcePosition' in refusal ? SOURCE_2 : LOCATION;
      expect(eventMessage(refusal, EVENT_2, CONTEXT)).toStrictEqual(
        expected(location, problem, fix),
      );
    }
  });

  it('[IMP-20] [CL-IMP-02] gives every ignore reason its location, why the event is left out and what can be done', () => {
    expectTypeOf<Exclude<ImportIgnoreReason, (typeof IGNORE_REASONS)[number][0]>>().toBeNever();
    for (const [reason, problem, fix] of IGNORE_REASONS) {
      expect(eventMessage(reason, EVENT_2, CONTEXT)).toStrictEqual(
        expected(LOCATION, problem, fix),
      );
    }
  });

  it('[IMP-20] [CL-IMP-02] gives every warning, each text and each cause of a dropped source included, its location, what is wrong and what to do', () => {
    type ListedWarning = (typeof WARNINGS)[number][0];
    expectTypeOf<Exclude<ImportWarning['kind'], ListedWarning['kind']>>().toBeNever();
    expectTypeOf<
      Exclude<SourceDropCause, Extract<ListedWarning, Readonly<{ cause: string }>>['cause']>
    >().toBeNever();
    expectTypeOf<
      Exclude<
        Extract<ImportWarning, Readonly<{ field: string }>>['field'],
        Extract<ListedWarning, Readonly<{ field: string }>>['field']
      >
    >().toBeNever();
    for (const [warning, location, problem, fix] of WARNINGS) {
      expect(eventMessage(warning, EVENT_2, CONTEXT)).toStrictEqual(
        expected(location, problem, fix),
      );
    }
  });

  it('[IMP-20] [CL-IMP-02] words the problems of the fixture without its description or any other free text', () => {
    const texts = fixtureMessages().flat();
    expect(texts).toStrictEqual([
      'Event 1 (public-humiliation, 2021-01-14): the research confidence is missing or not high, medium or low. Nothing to correct: it is set to low.',
      'Event 2 (racist-abuse, 2021-01-20): this type is not part of the request. Nothing to correct: request a backtest of this type to add its events.',
      'Event 3 (player-conflict, 2021-02-10): the description contains a quotation mark (“). Quotations are not allowed: summarize what was said instead.',
      'Event 3 (player-conflict, 2021-02-10): the research confidence is missing or not high, medium or low. Nothing to correct: it is set to low.',
      'Event 4 (public-humiliation, 2021-02-30): this date does not exist. Give the public date as YYYY-MM-DD.',
      'Event 5 (public-humiliation, 2021-03-05), source 2: the source is dated 2021-02-28, more than one day before the public date. Correct the public date or remove this source.',
      'Event 6 (no type, 2021-03-20): the event type is missing. Give the ID of one of the requested types.',
      'Event 6 (no type, 2021-03-20): the description has 206 characters, more than the maximum of 200. Shorten it to 200 characters at most.',
      'Event 6 (no type, 2021-03-20): the unverified note contains a quotation mark («) and is ignored. Nothing to correct: the event is added without it.',
    ]);
    const freeTexts = refusedEvents.events.flatMap((event) => [
      event.description,
      ...('unverified_note' in event ? [event.unverified_note] : []),
      ...event.sources.flatMap(({ outlet, title }) => [outlet, title]),
    ]);
    expect(
      freeTexts.filter((text) => texts.some((message) => message.includes(text))),
    ).toStrictEqual([]);
  });

  it('[CL-IMP-02] locates an event by its type as read, trimmed, when it has the shape of an identifier', () => {
    const fiftyLong = `${'a'.repeat(24)}-${'b'.repeat(25)}`;
    expect(
      [' Public-Humiliation ', 'record-approach-2', 'birthday', fiftyLong].map((type) =>
        locationOf(type),
      ),
    ).toStrictEqual([
      'Event 2 (Public-Humiliation, 2021-01-14)',
      'Event 2 (record-approach-2, 2021-01-14)',
      'Event 2 (birthday, 2021-01-14)',
      `Event 2 (${fiftyLong}, 2021-01-14)`,
    ]);
  });

  it('[CL-IMP-02] shows the placeholder for a type missing, longer than 50 characters or without the shape of an identifier', () => {
    const types = [
      undefined,
      `${'a'.repeat(25)}-${'b'.repeat(25)}`,
      'public humiliation',
      'public--humiliation',
      '-public',
      'public-',
      'humiliation-publiqué',
      'The coach said player A is soft!',
      // The long s and the Kelvin sign, letters that only case folding turns into s and k.
      'ſcandal',
      'public-Keepsake',
    ];
    expect(new Set(types.map((type) => locationOf(type)))).toStrictEqual(
      new Set(['Event 2 (no type, 2021-01-14)']),
    );
  });

  it('[CL-IMP-02] never quotes a type as read that holds anything but letters, digits and hyphens', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(' ', '"', '.', '_', 'é', '!'), (text, other) => {
        expect(locationOf(`a${text}${other}${text}b`)).toBe('Event 2 (no type, 2021-01-14)');
      }),
    );
  });

  it('[CL-IMP-02] [CL-IMP-08] quotes a date as read when it has the shape of a date of the format, and shows the placeholder otherwise', () => {
    expect(
      ['2021-01-14T23:10-05:00', '2021-01-14 23:10Z', '2021-02-30', '14 January 2021', null].map(
        (date) => locationOf('public-humiliation', date),
      ),
    ).toStrictEqual([
      'Event 2 (public-humiliation, 2021-01-14T23:10-05:00)',
      'Event 2 (public-humiliation, 2021-01-14 23:10Z)',
      'Event 2 (public-humiliation, 2021-02-30)',
      'Event 2 (public-humiliation, no date)',
      'Event 2 (public-humiliation, no date)',
    ]);
  });

  it('[CL-IMP-02] says that the link of a dropped source is missing, and shows the placeholder for a source that the event does not hold', () => {
    const withoutLink: EventAsRead = {
      position: 2,
      event: { ...EVENT_2.event, sources: [source(undefined)] },
    };
    const causes = ['incomplete_address', 'home_page', 'disallowed_domain'] as const;
    expect(
      causes.map(
        (cause) =>
          eventMessage({ kind: 'source_dropped', position: 1, cause }, withoutLink, CONTEXT).text,
      ),
    ).toStrictEqual(
      causes.map(
        () =>
          `${LOCATION}, source 1: the link is missing. Give the full address, starting with https://.`,
      ),
    );
    expect(
      eventMessage({ reason: 'source_before_public_date', sourcePosition: 3 }, EVENT_2, CONTEXT)
        .problem,
    ).toBe('the source is dated no date, more than one day before the public date.');
    expect(
      eventMessage(
        { kind: 'source_dropped', position: 3, cause: 'publication_date_in_future' },
        EVENT_2,
        CONTEXT,
      ).problem,
    ).toBe('the source is dated no date, after the import day.');
  });

  it("[IMP-20] [IHM-13] writes every number with the caller's count writer, and a lead other than one day in days", () => {
    const marked: MessageContext = {
      writeCount: (count) => `#${String(count)}`,
      maxSourceLeadDays: 2,
    };
    const messages = [
      eventMessage({ reason: 'source_before_public_date', sourcePosition: 2 }, EVENT_2, marked),
      eventMessage(
        { reason: 'description_too_long', length: 1234, maxLength: 200 },
        EVENT_2,
        marked,
      ),
      eventMessage({ kind: 'shared_link', otherPosition: 5 }, EVENT_2, marked),
      eventMessage(
        { kind: 'text_too_long_ignored', field: 'detail', length: 1234, maxLength: 200 },
        EVENT_2,
        marked,
      ),
    ];
    expect(messages.map(({ text }) => text)).toStrictEqual([
      'Event #2 (public-humiliation, 2021-01-14), source #2: the source is dated 2021-01-09, more than #2 days before the public date. Correct the public date or remove this source.',
      'Event #2 (public-humiliation, 2021-01-14): the description has #1234 characters, more than the maximum of #200. Shorten it to #200 characters at most.',
      'Event #2 (public-humiliation, 2021-01-14): this event cites the same link as event #5. Check that the two events are distinct facts.',
      'Event #2 (public-humiliation, 2021-01-14): the context detail has #1234 characters, more than the maximum of #200, and is ignored. Nothing to correct: the event is added without it.',
    ]);
  });
});
