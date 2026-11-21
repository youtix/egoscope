import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import cutInsideEvent from '@data/fixtures/ai-exchange/research-result/recovery/cut-inside-event.json';
import cutInsideHeader from '@data/fixtures/ai-exchange/research-result/recovery/cut-inside-header.json';
import cutInsideString from '@data/fixtures/ai-exchange/research-result/recovery/cut-inside-string.json';
import result from '@data/fixtures/ai-exchange/research-result/recovery/result.json';

import { extractJson } from '../extract-json';
import { recoverCut } from './recover-cut';

import type { CutRecovery, RecoverCutError, RecoverCutResult } from './recover-cut';

// A complete result, which the tests write compact and cut at chosen places: JSON
// isolation reports a cut as the tokens without the spaces between them.
const RESULT: Readonly<Record<string, unknown>> = result;
const [FIRST, SECOND, THIRD] = result.events;
const WHOLE = JSON.stringify(result);
const COVERED_PERIOD = 'covered_period';
const PUBLIC_DATE = 'public_date';
const HEADER_KEYS = [
  'format',
  'format_version',
  'request_reference',
  'player',
  'covered_types',
  COVERED_PERIOD,
];
const LISTS = ['unverified_leads', 'limitations'] as const;
// A place inside the description of the third event.
const IN_THIRD_EVENT = '"description":"A rival';

/** The answer that a fixture holds, line by line. */
const answer = (fixture: Readonly<{ pasted: readonly string[] }>): string =>
  fixture.pasted.join('\n');

/** The partial object that JSON isolation reports for an answer that stops before its end. */
function partialTextOf(text: string): string {
  const isolated = extractJson(text);
  if (isolated.ok || isolated.error.kind !== 'cut') {
    throw new Error('The answer is not cut.');
  }
  return isolated.error.partialText;
}

/** The text up to the end of the first `marker` in it. */
const cutAfter = (text: string, marker: string): string =>
  text.slice(0, text.indexOf(marker) + marker.length);

/** The complete result with some members changed, written compact. */
const resultWith = (changes: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ ...result, ...changes });

/** The result cut inside its last event, after these complete ones. */
const cutAfterEvents = (events: readonly unknown[], changes = {}): string =>
  cutAfter(resultWith({ ...changes, events: [...events, THIRD] }), IN_THIRD_EVENT);

/** A member of the result, written compact. */
const member = (key: string): string => `${JSON.stringify(key)}:${JSON.stringify(RESULT[key])}`;

/** The members of the result that `keys` names, in their order, as a text cut after them. */
const membersIn = (keys: readonly string[]): string =>
  `{${keys.map((key) => member(key)).join(',')}`;

const listed = (keys: readonly string[]): Readonly<Record<string, unknown>> =>
  Object.fromEntries(keys.map((key) => [key, RESULT[key]]));

/** An event like the first one, on the public date given. */
const eventOn = (day: unknown): unknown => ({ ...FIRST, [PUBLIC_DATE]: day });

/** The members of the result before its events list, with the covered period given. */
const header = (period: unknown): Readonly<Record<string, unknown>> => ({
  ...listed(HEADER_KEYS),
  [COVERED_PERIOD]: period,
});

/** What a recovery keeps: the header, the covered period ending on `end`, these events. */
const kept = (end: string, events: readonly unknown[]): Readonly<Record<string, unknown>> => ({
  ...header({ start: '2020-12-22', end }),
  events,
});

/** The recovery of `value` from a cut inside the events list, both lists lost unless `changes` says otherwise. */
const recovery = (
  value: Readonly<Record<string, unknown>>,
  recoveredEventCount: number,
  changes: Partial<CutRecovery> = {},
): RecoverCutResult => ({
  ok: true,
  recovery: {
    value,
    truncationRecovered: true,
    recoveredEventCount,
    retainedCoverageEmpty: false,
    lostLists: LISTS,
    eventsListComplete: false,
    ...changes,
  },
});

/** The recovery of `value` from a cut after the closed events list, the lists in `lostLists` lost. */
const afterList = (
  value: Readonly<Record<string, unknown>>,
  recoveredEventCount: number,
  lostLists: CutRecovery['lostLists'] = LISTS,
): RecoverCutResult =>
  recovery(value, recoveredEventCount, { eventsListComplete: true, lostLists });

/** The result with these events, cut inside its limitations, after the closed events list. */
const cutInLimitations = (events: unknown): string =>
  cutAfter(resultWith({ events }), '"limitations":["Local');

const refused = (kind: RecoverCutError['kind']): RecoverCutResult => ({
  ok: false,
  error: { kind },
});

/** A covered period declared, and as the recovery of a cut inside the third event leaves it. */
type PeriodRow = Readonly<{
  place: string;
  declared: unknown;
  period: unknown;
  retainedCoverageEmpty: boolean;
}>;

/**
 * A covered period that the reader refuses in the whole answer, with `kind`, which the
 * recovery leaves as written for the reader to refuse it again (IMP-09).
 */
const keptAsWritten = (kind: string, declared: Readonly<Record<string, unknown>>): PeriodRow => ({
  place: `nowhere for a period that the reader refuses whole, with ${kind}, kept as written`,
  declared,
  period: declared,
  retainedCoverageEmpty: false,
});

/** The result with these lists written before its events list, cut inside the third event. */
const listsFirst = (lists: readonly string[]): string =>
  cutAfter(membersIn([...HEADER_KEYS, ...lists, 'events']), IN_THIRD_EVENT);

/** What a recovery keeps of `listsFirst`: the first two events, and the lists. */
const keptWithLists = (lists: readonly string[]): Readonly<Record<string, unknown>> => ({
  ...kept('2021-03-01', [FIRST, SECOND]),
  ...listed(lists),
});

describe('recoverCut', () => {
  it.each([
    ['inside an event', cutInsideEvent],
    ['inside a string', cutInsideString],
    ['inside the header, which allows no recovery', cutInsideHeader],
  ])(
    '[BKT-25] [IMP-05] reads an answer cut %s, after prose and inside a code fence, as its fixture expects',
    (_place, fixture) => {
      const partialText = partialTextOf(answer(fixture));

      expect(recoverCut(partialText)).toStrictEqual(fixture.expected);
    },
  );

  it('[CA-IMP-04] [IMP-05] recovers the 37 complete events of a result cut in the middle of event 38, ends its covered period the day before event 37 and loses its leads and limitations', () => {
    // An event every third day from 2020-12-24.
    const events = Array.from({ length: 38 }, (_, index) => ({
      ...FIRST,
      [PUBLIC_DATE]: new Date(Date.UTC(2020, 11, 24 + 3 * index)).toISOString().slice(0, 10),
      description: `Fact ${String(index + 1)} was reported by a national outlet.`,
    }));
    const pasted = ['The backtest:', '```json', JSON.stringify({ ...result, events }, null, 2)];
    const cut = cutAfter(pasted.join('\n'), 'Fact 38 was');
    const recovered = kept('2021-04-10', events.slice(0, 37));

    expect(events[36]?.[PUBLIC_DATE]).toBe('2021-04-11');
    expect(extractJson(cut)).toMatchObject({ error: { path: ['events', 37, 'description'] } });
    expect(recoverCut(partialTextOf(cut))).toStrictEqual(recovery(recovered, 37));
  });

  it.each([
    ['inside a string', '{"event_type":"media-storm","description":"Several outl'],
    ['inside a number', '{"event_type":"media-storm","public_date":"2021-03-02","confidence":0.8'],
    ['inside a nested object', '{"event_type":"media-storm","context":{"injury_return":"no"'],
    ['between two events', ''],
  ])(
    '[CL-IMP-18] drops the event being written at the cut, whether the cut falls %s',
    (_place, next) => {
      const text = `${cutAfter(WHOLE, '"events":[')}${JSON.stringify(FIRST)},${next}`;

      expect(recoverCut(text)).toStrictEqual(recovery(kept('2021-01-13', [FIRST]), 1));
    },
  );

  it('[CL-IMP-18] keeps an event that closes right at the cut', () => {
    const text = cutAfter(WHOLE, JSON.stringify(SECOND));

    expect(recoverCut(text)).toStrictEqual(recovery(kept('2021-03-01', [FIRST, SECOND]), 2));
  });

  it('[CL-IMP-18] drops the event being written at the cut, wherever the cut falls inside it', () => {
    const cuts = [
      { event: FIRST, outcome: refused('no_complete_event') },
      { event: SECOND, outcome: recovery(kept('2021-01-13', [FIRST]), 1) },
      { event: THIRD, outcome: recovery(kept('2021-03-01', [FIRST, SECOND]), 2) },
    ];
    const cutInside = fc.constantFrom(...cuts).chain(({ event, outcome }) => {
      const start = WHOLE.indexOf(JSON.stringify(event));
      const end = start + JSON.stringify(event).length;
      return fc.tuple(fc.constant(outcome), fc.integer({ min: start, max: end - 1 }));
    });

    fc.assert(
      fc.property(cutInside, ([outcome, position]) => {
        expect(recoverCut(WHOLE.slice(0, position))).toStrictEqual(outcome);
      }),
    );
  });

  it.each(['request_reference', 'player', 'covered_types', COVERED_PERIOD])(
    '[CL-IMP-18] refuses the recovery when the %s is incomplete: not written, or cut after the events',
    (key) => {
      const others = HEADER_KEYS.filter((other) => other !== key);
      const cutInside = membersIn([...others, 'events', key]).slice(0, -2);

      expect(recoverCut(membersIn([...others, 'events']))).toStrictEqual(
        refused('header_incomplete'),
      );
      expect(recoverCut(cutInside)).toStrictEqual(refused('header_incomplete'));
    },
  );

  it.each([
    ['the cut falls inside the first event', cutAfter(WHOLE, '"description":"An opposing')],
    ['the cut falls right after the list opens', cutAfter(WHOLE, '"events":[')],
    [
      'the list has no value yet, after a list',
      `${membersIn(['request_reference', 'player', COVERED_PERIOD, 'covered_types'])},"events":`,
    ],
    ['the events are an object', `${membersIn(HEADER_KEYS)},"events":{"count":2,"list":"none"`],
  ])('[CL-IMP-18] refuses the recovery when no event is complete: %s', (_case, text) => {
    expect(recoverCut(text)).toStrictEqual(refused('no_complete_event'));
  });

  it.each([
    ['the second event is dated before the first', ['2021-03-02', '2021-01-14']],
    ['the third event is dated before the second', ['2021-01-14', '2021-03-02', '2021-02-01']],
  ])(
    '[IMP-05] [CL-IMP-18] [CL-IMP-19] [CL-BKT-15] refuses the recovery when the complete events are not sorted: %s',
    (_case, days) => {
      const events = days.map((day) => eventOn(day));

      expect(recoverCut(cutAfterEvents(events))).toStrictEqual(refused('events_not_sorted'));
    },
  );

  it('[CL-BKT-15] [CL-IMP-19] compares the date parts as written: events of one day come in any order, whatever their times and offsets', () => {
    const days = ['2021-03-02T23:30-05:00', '2021-03-02T08:00+01:00', '2021-03-02'];
    const events = days.map((day) => eventOn(day));

    expect(recoverCut(cutAfterEvents(events))).toStrictEqual(
      recovery(kept('2021-03-01', events), 3),
    );
  });

  it('[CL-BKT-15] [CL-IMP-19] leaves the events without a calendar date out of the order, and ends the covered period the day before the last dated one', () => {
    const undated = [
      eventOn('2021-02-30'),
      eventOn(null),
      eventOn('March 2, 2021'),
      'A fact',
      null,
    ];
    const events = [eventOn('2021-01-14'), eventOn('2021-03-02'), ...undated];

    expect(recoverCut(cutAfterEvents(events))).toStrictEqual(
      recovery(kept('2021-03-01', events), 7),
    );
  });

  it('[CL-IMP-18] refuses the recovery when no complete event has a calendar date to end the covered period on', () => {
    const text = cutAfterEvents([eventOn('2021-02-30'), eventOn(null)]);

    expect(recoverCut(text)).toStrictEqual(refused('no_dated_event'));
  });

  it('[CL-IMP-18] keeps the leads and limitations written before the events list', () => {
    expect(recoverCut(listsFirst(LISTS))).toStrictEqual(
      recovery(keptWithLists(LISTS), 2, { lostLists: [] }),
    );
    expect(recoverCut(listsFirst(['limitations']))).toStrictEqual(
      recovery(keptWithLists(['limitations']), 2, { lostLists: ['unverified_leads'] }),
    );
  });

  it('[IMP-05] [CL-IMP-18] keeps every member written in full and the covered period as written when the cut falls after the closed events list, which sets eventsListComplete', () => {
    const lists = listed([...HEADER_KEYS, 'events', 'unverified_leads']);

    expect(recoverCut(cutAfter(WHOLE, '"limitations":["Local'))).toStrictEqual(
      afterList(lists, 3, ['limitations']),
    );
    expect(recoverCut(cutAfter(WHOLE, '"unverified_leads":['))).toStrictEqual(
      afterList(listed([...HEADER_KEYS, 'events']), 3),
    );
    expect(recoverCut(cutAfter(WHOLE, IN_THIRD_EVENT))).toStrictEqual(
      recovery(kept('2021-03-01', [FIRST, SECOND]), 2, { eventsListComplete: false }),
    );
  });

  it.each([
    ['no event', [], 0],
    ['unsorted events', [eventOn('2021-03-02'), eventOn('2021-01-14')], 2],
    ['events without a calendar date', [eventOn('2021-02-30'), eventOn(null), 'A fact'], 3],
    ['events written as an object, for the reader to refuse', { count: 2 }, 0],
  ])(
    '[IMP-05] [CL-IMP-18] recovers a result cut after its closed events list with %s, its covered period as written',
    (_case, events, count) => {
      const value = { ...listed([...HEADER_KEYS, 'unverified_leads']), events };

      expect(recoverCut(cutInLimitations(events))).toStrictEqual(
        afterList(value, count, ['limitations']),
      );
    },
  );

  it('[IMP-05] [CL-IMP-18] refuses the recovery when the last recovered date is 0000-01-01, whose day before YYYY-MM-DD cannot write', () => {
    const period = { start: '0000-01-01', end: '9999-12-31' };
    const cut = (day: string): string =>
      cutAfterEvents([eventOn(day)], { [COVERED_PERIOD]: period });
    const value = { ...header({ ...period, end: '0000-01-01' }), events: [eventOn('0000-01-02')] };

    expect(recoverCut(cut('0000-01-02'))).toStrictEqual(recovery(value, 1));
    expect(recoverCut(cut('0000-01-01'))).toStrictEqual(refused('no_dated_event'));
  });

  it.each([
    {
      place: 'on the day before the last recovered event',
      declared: { start: '2020-12-22', end: '2021-05-16' },
      period: { start: '2020-12-22', end: '2021-03-01' },
      retainedCoverageEmpty: false,
    },
    {
      place: 'never after a declared end that comes earlier, kept as written',
      declared: { start: '2020-12-22', end: '2021-02-01' },
      period: { start: '2020-12-22', end: '2021-02-01' },
      retainedCoverageEmpty: false,
    },
    {
      place: 'on a declared end of that very day, kept as written',
      declared: { start: '2020-12-22', end: '2021-03-01T12:00+01:00' },
      period: { start: '2020-12-22', end: '2021-03-01T12:00+01:00' },
      retainedCoverageEmpty: false,
    },
    {
      place: 'before its start, which leaves the retained coverage empty',
      declared: { start: '2021-03-02T10:00+01:00', end: '2021-05-16' },
      period: { start: '2021-03-02T10:00+01:00', end: '2021-03-01' },
      retainedCoverageEmpty: true,
    },
    {
      place:
        'before its start when it starts on its declared end, which leaves the retained coverage empty',
      declared: { start: '2021-05-16', end: '2021-05-16' },
      period: { start: '2021-05-16', end: '2021-03-01' },
      retainedCoverageEmpty: true,
    },
    {
      place: 'on its start, which leaves one day covered',
      declared: { start: '2021-03-01', end: '2021-05-16' },
      period: { start: '2021-03-01', end: '2021-03-01' },
      retainedCoverageEmpty: false,
    },
    {
      place: 'without a flag when the start names no date, for the reader to refuse',
      declared: { start: 'December 2020', end: '2021-05-16' },
      period: { start: 'December 2020', end: '2021-03-01' },
      retainedCoverageEmpty: false,
    },
    {
      place: 'nowhere when the period is a text, kept as written',
      declared: '2020-12-22/2021-05-16',
      period: '2020-12-22/2021-05-16',
      retainedCoverageEmpty: false,
    },
    {
      place: 'nowhere when the period is a list, kept as written',
      declared: ['2020-12-22'],
      period: ['2020-12-22'],
      retainedCoverageEmpty: false,
    },
    {
      place: 'nowhere when the period is null, kept as written',
      declared: null,
      period: null,
      retainedCoverageEmpty: false,
    },
    keptAsWritten('its end left out', { start: '2020-12-22' }),
    keptAsWritten('its end null', { start: '2020-12-22', end: null }),
    keptAsWritten('an end that names no date', { start: '2020-12-22', end: 'end of the season' }),
    keptAsWritten('an end on a day that does not exist', {
      start: '2020-12-22',
      end: '2021-02-30',
    }),
    keptAsWritten('an end that readDate does not read', {
      start: '2020-12-22',
      end: '2021-05-16 or later',
    }),
    keptAsWritten('an end before its start', { start: '2021-05-16', end: '2021-04-01' }),
  ])(
    '[IMP-09] [CL-IMP-18] ends the covered period $place',
    ({ declared, period, retainedCoverageEmpty }) => {
      const text = cutAfter(resultWith({ [COVERED_PERIOD]: declared }), IN_THIRD_EVENT);
      const value = { ...header(period), events: [FIRST, SECOND] };

      expect(recoverCut(text)).toStrictEqual(recovery(value, 2, { retainedCoverageEmpty }));
    },
  );

  it.each([
    ['2021-01-01', '2020-12-31'],
    ['2021-03-01', '2021-02-28'],
    ['2024-03-01', '2024-02-29'],
    ['0050-03-01', '0050-02-28'],
  ])('[IMP-05] ends the covered period of an event on %s on %s, the day before', (day, end) => {
    const period = { start: '0001-01-01', end: '9999-12-31' };
    const text = cutAfterEvents([eventOn(day)], { [COVERED_PERIOD]: period });

    expect(recoverCut(text)).toStrictEqual(
      recovery({ ...header({ ...period, end }), events: [eventOn(day)] }, 1),
    );
  });

  it('[IMP-05] ends the covered period on the calendar day before the last recovered event, whatever its date', () => {
    const period = { start: '1900-01-01', end: '2999-12-31' };
    const instants = fc.date({
      min: new Date(Date.UTC(1946, 0, 1)),
      max: new Date(Date.UTC(2099, 11, 31)),
      noInvalidDate: true,
    });

    fc.assert(
      fc.property(instants, (instant) => {
        const day = instant.toISOString().slice(0, 10);
        const year = instant.getUTCFullYear();
        const before = new Date(Date.UTC(year, instant.getUTCMonth(), instant.getUTCDate() - 1));
        const end = before.toISOString().slice(0, 10);
        const text = cutAfterEvents([eventOn(day)], { [COVERED_PERIOD]: period });

        expect(recoverCut(text)).toStrictEqual(
          recovery({ ...header({ ...period, end }), events: [eventOn(day)] }, 1),
        );
      }),
    );
  });

  it('[CL-IMP-18] keeps every value written in full as JSON reads it, a __proto__ key as a member', () => {
    const members = membersIn(['request_reference', 'player', 'covered_types', COVERED_PERIOD]);
    const text = String.raw`{"format_version":1.0,"reviewed":true,"note":null,"title":"The \"big\" one \\","__proto__":{"polluted":true},${members.slice(1)},"ev\u0065nts":[${JSON.stringify(FIRST)},{"conf`;
    const value = Object.fromEntries([
      ['format_version', 1],
      ['reviewed', true],
      ['note', null],
      ['title', 'The "big" one \\'],
      ['__proto__', { polluted: true }],
      ...Object.entries(listed(['request_reference', 'player', 'covered_types'])),
      [COVERED_PERIOD, { start: '2020-12-22', end: '2021-01-13' }],
      ['events', [FIRST]],
    ]);

    expect(recoverCut(text)).toStrictEqual(recovery(value, 1));
  });

  it.each([
    ['a number, which the cut may have shortened', '"rank":12', {}],
    ['a literal that JSON cannot read', '"reviewed":tru', {}],
    ['a string with an escape that JSON does not know', String.raw`"note":"a \q"`, {}],
    ['a string left open by the cut', '"note":"National outlets, then local', {}],
    ['a string, closed by its quotation mark', '"note":"draft"', { note: 'draft' }],
    ['true, which cannot grow into another value', '"reviewed":true', { reviewed: true }],
    ['an object, closed by its brace', '"meta":{"pages":2}', { meta: { pages: 2 } }],
  ])(
    '[CL-IMP-18] keeps the value that ends the text only when the cut cannot have shortened it: %s',
    (_case, last, members) => {
      const text = `${membersIn([...HEADER_KEYS, 'events'])},${last}`;
      const value = { ...listed([...HEADER_KEYS, 'events']), ...members };

      expect(recoverCut(text)).toStrictEqual(afterList(value, 3));
    },
  );
});
