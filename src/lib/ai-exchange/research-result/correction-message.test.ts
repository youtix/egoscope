import { describe, expect, expectTypeOf, it } from 'vitest';

import refusedEvents from '@data/fixtures/ai-exchange/research-result/messages/refused-events.json';

import { checkEvents } from './check-events';
import { composeCorrectionMessage } from './correction-message';
import { readDate } from './dates';
import { readResult } from './read-result';

import type { EventCheck, EventCheckContext, ImportRefusal } from './check-events';
import type { ResearchEvent } from './format';
import type { MessageContext } from './messages';
import type { ReadResultError, ReadResultOutcome } from './read-result';

const CONTEXT: MessageContext = { writeCount: String, maxSourceLeadDays: 1 };
// Keys of format 1.0 that the tests change in the fixture.
const FORMAT_VERSION_KEY = 'format_version';
const COVERED_TYPES_KEY = 'covered_types';
const COVERED_PERIOD_KEY = 'covered_period';
const REQUESTED = ['public-humiliation', 'player-conflict'];
const PERIOD = { startOn: '2019-10-23', endOn: '2026-11-11' };
const CHECKS: EventCheckContext = {
  taxonomy: [
    { id: 'public-humiliation', standing: 'research', status: 'validated' },
    { id: 'player-conflict', standing: 'research', status: 'validated' },
    { id: 'racist-abuse', standing: 'research', status: 'validated' },
  ],
  requestedTypes: REQUESTED.map((id) => ({ id, period: PERIOD, sheetVersion: 1 })),
  coveredTypes: REQUESTED,
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

// The parts that open every correction message (CL-IMP-04, items 1 to 3).
const OPENING = [
  'Correction request for an Egoscope backtest result',
  'Request reference: REQ-2026-0007. Format version: 1.0.',
  'The result you returned cannot be imported as it is. Correct the problems listed below and send back the complete corrected result: one JSON object in one piece, with no text before or after it, no code fence and no citation marker. Keep the other events unchanged. Invent nothing: a fact you cannot support with a dated public press article published before the next NBA game the player played goes in "unverified_leads", never in "events".',
];
const CUT = 'Your answer stopped before the end of the JSON object';
const CUT_REST =
  'Send the whole result again. If it does not fit in one answer, process the period in chronological order, stop at the end of a complete season and set "covered_period.end" to the last day you actually covered; the rest will be requested separately.';
const SYNTAX_CORRECTION =
  'Write straight quotation marks around keys and texts, and no comment, no trailing comma and no citation marker between values.';
const COVERED_TYPES_LINE =
  'The whole result — covered_types: they are missing, empty or hold none of the requested types. List the IDs of the requested types that you actually researched, exactly as given in point 3 of the prompt.';
const COVERED_PERIOD_LINE =
  'The whole result — covered_period: it is missing, has an invalid date or starts after its end. Give "start" and "end" as YYYY-MM-DD, the start on or before the end.';
const EVENTS_LINE =
  'The whole result — events: it is missing or is not a list. Give the events as a list, [] when you found none.';
// The lines of the refused events 3, 4 and 5 of the fixture, then those of event 6. The
// warnings of the refused events 3 (its confidence missing) and 6 (a quotation mark in its
// unverified note) give no line, nor do the added event 1 and the ignored event 2.
const EVENT_LINES = [
  'Event 3 (player-conflict, 2021-02-10) — description: the description contains a quotation mark (“). Remove the quotation mark (“): summarize what was said instead of quoting it (rule 2.6).',
  'Event 4 (public-humiliation, 2021-02-30) — public_date: this date does not exist. Give a date that exists, as YYYY-MM-DD.',
  'Event 5 (public-humiliation, 2021-03-05), source 2 — publication_date: the source is dated 2021-02-28, more than one day before the public date. Correct the public date, or remove the sources published more than one day before it.',
];
const EVENT_6_LINES = [
  'Event 6 (no type, 2021-03-20) — event_type: the event type is missing. Give in "event_type" the ID of one of the requested types.',
  'Event 6 (no type, 2021-03-20) — description: the description has 206 characters, more than the maximum of 200. Shorten the description to 200 characters at most, following rule 2.6.',
];

/** The parts of a message: the opening, then those given. */
const message = (...parts: readonly string[]): string => [...OPENING, ...parts].join('\n\n');

/** The list part of a message, its lines numbered from 1. */
const list = (lines: readonly string[]): string =>
  ['Problems to correct:', ...lines.map((line, index) => `${String(index + 1)}. ${line}`)].join(
    '\n',
  );

/** The correction message of a pasted text, its events checked when it is read. */
const correctionOf = (pasted: string, context: MessageContext = CONTEXT): string | undefined => {
  const reading = readResult(pasted, REQUESTED);
  const checks = reading.ok ? checkEvents(reading.result.events, CHECKS) : [];
  return composeCorrectionMessage({ reference: 'REQ-2026-0007', reading, checks }, context);
};

/** The fixture, its events limited to those at the positions given. */
const resultWith = (positions: readonly number[]): unknown => ({
  ...refusedEvents,
  events: refusedEvents.events.filter((_event, index) => positions.includes(index + 1)),
});

/** A result as text, the fixture unless said otherwise, cut before the first occurrence of a text. */
const cutBefore = (text: string, value: unknown = refusedEvents): string => {
  const whole = JSON.stringify(value);
  return whole.slice(0, whole.indexOf(text));
};

/** The correction message of a result refused whole by one error of the reader. */
const refusedWith = (error: ReadResultError): string | undefined => {
  const reading: ReadResultOutcome = {
    ok: false,
    errors: [error],
    resultWarnings: [],
    recovery: undefined,
  };
  return composeCorrectionMessage({ reference: 'REQ-2026-0007', reading, checks: [] }, CONTEXT);
};

// The parts that each blocking error of the reader adds to the opening: a line of the
// list, or for a cut answer its own paragraph.
const RESULT_PARTS = [
  [
    { kind: 'no_result_found' },
    list([
      'The whole result: your answer holds no JSON object. Send the result as one JSON object, as point 4 of the prompt describes it.',
    ]),
  ],
  [
    { kind: 'several_results' },
    list(['The whole result: your answer holds several different results. Send one result only.']),
  ],
  [
    { kind: 'syntax_error', path: ['events', 0, 'description'] },
    list([`The whole result: the JSON is not valid around event 1. ${SYNTAX_CORRECTION}`]),
  ],
  [
    { kind: 'syntax_error', path: [] },
    list([`The whole result: the JSON is not valid. ${SYNTAX_CORRECTION}`]),
  ],
  [{ kind: 'cut_not_recoverable', path: ['player'] }, `${CUT}. ${CUT_REST}`],
  [
    { kind: 'not_a_backtest_result' },
    list([
      'The whole result — format: this is not a backtest result. Write "egoscope-backtest", with the structure of point 4 of the prompt.',
    ]),
  ],
  [
    { kind: 'unknown_version' },
    list(['The whole result — format_version: this version is unknown. Write "1.0".']),
  ],
  [{ kind: 'covered_types_invalid' }, list([COVERED_TYPES_LINE])],
  [{ kind: 'covered_period_invalid' }, list([COVERED_PERIOD_LINE])],
  [{ kind: 'events_missing' }, list([EVENTS_LINE])],
] satisfies readonly (readonly [ReadResultError, string])[];

// The line that each refusal reason gives for event 2, of no type and dated 2021-01-14,
// after its location.
const REFUSAL_LINES = [
  [
    { reason: 'type_missing' },
    'event_type: the event type is missing. Give in "event_type" the ID of one of the requested types.',
  ],
  [
    { reason: 'type_unknown' },
    'event_type: this type is not an event type of the app. Use the ID of one of the requested types, exactly as given in point 3 of the prompt.',
  ],
  [
    { reason: 'public_date_missing' },
    'public_date: the public date is missing. Give the public date as YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known.',
  ],
  [
    { reason: 'public_date_malformed' },
    'public_date: the public date is not written in an accepted form. Write the public date as YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known.',
  ],
  [
    { reason: 'public_date_nonexistent' },
    'public_date: this date does not exist. Give a date that exists, as YYYY-MM-DD.',
  ],
  [
    { reason: 'description_missing' },
    'description: the description is missing. Write one factual sentence in English, following rule 2.6.',
  ],
  [
    { reason: 'description_too_long', length: 250, maxLength: 120 },
    'description: the description has 250 characters, more than the maximum of 120. Shorten the description to 120 characters at most, following rule 2.6.',
  ],
  [
    { reason: 'description_quotation_mark', character: '"' },
    'description: the description contains a quotation mark ("). Remove the quotation mark ("): summarize what was said instead of quoting it (rule 2.6).',
  ],
  [
    { reason: 'no_valid_source' },
    'sources: no valid source is left. Give at least one source: the full address of a dated public press article, with its outlet, title and publication date (rule 2.3).',
  ],
  [
    { reason: 'source_before_public_date', sourcePosition: 1 },
    'publication_date: the source is dated 2021-01-10, more than one day before the public date. Correct the public date, or remove the sources published more than one day before it.',
  ],
] satisfies readonly (readonly [ImportRefusal, string])[];

// Event 2 of a result read: no type, one source published four days before it.
const EVENT_2: ResearchEvent = {
  eventType: undefined,
  publicDate: readDate('2021-01-14'),
  description: undefined,
  sources: [
    {
      url: undefined,
      outlet: undefined,
      title: undefined,
      publicationDate: readDate('2021-01-10'),
    },
  ],
  context: { injuryReturn: undefined, gameStakes: undefined, detail: undefined },
  researchConfidence: undefined,
  unverifiedNote: undefined,
};

/** The correction message of a result read of these events, whose event 2 is refused as given. */
const refusingEvent2 = (
  refusals: readonly ImportRefusal[],
  events: readonly ResearchEvent[] = [EVENT_2, EVENT_2],
): string | undefined => {
  const reading = readResult(JSON.stringify(refusedEvents), REQUESTED);
  if (!reading.ok) {
    throw new Error('The fixture is a result that the reader reads');
  }
  const checks: readonly EventCheck[] = [
    { position: 2, outcome: 'refused', refusals, warnings: [] },
  ];
  const read = { ...reading, result: { ...reading.result, events } };
  return composeCorrectionMessage({ reference: 'REQ-2026-0007', reading: read, checks }, CONTEXT);
};

describe('composeCorrectionMessage', () => {
  it('[IMP-21] [CL-IMP-04] [CA-IMP-24] [CA-DSN-08] lists the refused events by position and field, with their expected corrections, and no warning or ignored event', () => {
    expect(correctionOf(JSON.stringify(refusedEvents))).toBe(
      message(list([...EVENT_LINES, ...EVENT_6_LINES])),
    );
  });

  it('[IMP-21] [CL-IMP-04] composes no message for a result read whole whose events are added or ignored', () => {
    const pasted = JSON.stringify(resultWith([1, 2]));
    expect(correctionOf(pasted)).toBeUndefined();
  });

  it('[IMP-21] [CA-IMP-02] asks for format version 1.0 when the result is of an unknown version', () => {
    const pasted = JSON.stringify({ ...refusedEvents, [FORMAT_VERSION_KEY]: '2.0' });
    expect(correctionOf(pasted)).toBe(
      message(list(['The whole result — format_version: this version is unknown. Write "1.0".'])),
    );
  });

  it('[IMP-09] [CL-IMP-04] lists every problem of the whole result in the order of the format', () => {
    const pasted = JSON.stringify({
      ...refusedEvents,
      [COVERED_TYPES_KEY]: [],
      [COVERED_PERIOD_KEY]: {},
      events: {},
    });
    expect(correctionOf(pasted)).toBe(
      message(list([COVERED_TYPES_LINE, COVERED_PERIOD_LINE, EVENTS_LINE])),
    );
  });

  it('[IMP-21] [CL-IMP-04] says what every blocking error of the reader asks the AI to correct, a cut answer by its own paragraph', () => {
    expectTypeOf<
      Exclude<ReadResultError['kind'], (typeof RESULT_PARTS)[number][0]['kind']>
    >().toBeNever();
    for (const [error, part] of RESULT_PARTS) {
      expect(refusedWith(error)).toBe(message(part));
    }
  });

  it('[IMP-21] [CL-IMP-04] gives every refusal reason its key of format 1.0 and its expected correction', () => {
    expectTypeOf<
      Exclude<ImportRefusal['reason'], (typeof REFUSAL_LINES)[number][0]['reason']>
    >().toBeNever();
    for (const [refusal, line] of REFUSAL_LINES) {
      const location = `Event 2 (no type, 2021-01-14)${'sourcePosition' in refusal ? ', source 1' : ''}`;
      expect(refusingEvent2([refusal])).toBe(message(list([`${location} — ${line}`])));
    }
  });

  it('[IMP-05] [IMP-21] [CL-IMP-04] asks for the whole result again when the cut answer allows no recovery, naming the event it stops in', () => {
    const [first, second, third] = refusedEvents.events;
    const unsorted = { ...refusedEvents, events: [third, first, second] };
    expect(correctionOf(cutBefore('Abuse in the stands', unsorted))).toBe(
      message(`${CUT}, during event 3. ${CUT_REST}`),
    );
    expect(correctionOf(cutBefore('Player A'))).toBe(message(`${CUT}. ${CUT_REST}`));
  });

  it('[IMP-05] [IMP-21] [CL-IMP-18] asks for the rest of a recovered answer after the events it recovered, and lists their refusals', () => {
    expect(correctionOf(cutBefore('Coach criticizes'))).toBe(
      message(`${CUT}, during event 6. ${CUT_REST}`, list(EVENT_LINES)),
    );
  });

  it('[IMP-21] [CL-IMP-04] names no event when the cut of a recovered answer fell after its events list', () => {
    const value = resultWith([1, 2]);
    expect(correctionOf(cutBefore('"limitations"', value))).toBe(message(`${CUT}. ${CUT_REST}`));
  });

  it('[IMP-09] [IMP-21] [CL-IMP-04] keeps the paragraph of a cut answer when the result recovered from it is refused whole', () => {
    const value = { ...refusedEvents, [COVERED_TYPES_KEY]: ['media-storm'] };
    expect(correctionOf(cutBefore('Coach criticizes', value))).toBe(
      message(`${CUT}, during event 6. ${CUT_REST}`, list([COVERED_TYPES_LINE])),
    );
  });

  it("[IMP-21] [IHM-13] numbers the lines and names the events with the caller's count writer", () => {
    const marked: MessageContext = {
      writeCount: (count) => `#${String(count)}`,
      maxSourceLeadDays: 1,
    };
    expect(correctionOf(cutBefore('Rumors around'), marked)).toBe(
      message(
        `${CUT}, during event #5. ${CUT_REST}`,
        [
          'Problems to correct:',
          '#1. Event #3 (player-conflict, 2021-02-10) — description: the description contains a quotation mark (“). Remove the quotation mark (“): summarize what was said instead of quoting it (rule 2.6).',
          '#2. Event #4 (public-humiliation, 2021-02-30) — public_date: this date does not exist. Give a date that exists, as YYYY-MM-DD.',
        ].join('\n'),
      ),
    );
  });

  it('refuses checks of an event that the result read does not hold, which is a bug of its caller', () => {
    expect(() => refusingEvent2([{ reason: 'type_missing' }], [EVENT_2])).toThrow(
      'The result read holds no event at position 2.',
    );
    const reading: ReadResultOutcome = {
      ok: false,
      errors: [{ kind: 'events_missing' }],
      resultWarnings: [],
      recovery: undefined,
    };
    const checks: readonly EventCheck[] = [
      { position: 1, outcome: 'refused', refusals: [{ reason: 'type_missing' }], warnings: [] },
    ];
    expect(() =>
      composeCorrectionMessage({ reference: 'REQ-2026-0007', reading, checks }, CONTEXT),
    ).toThrow('The result read holds no event at position 1.');
  });
});
