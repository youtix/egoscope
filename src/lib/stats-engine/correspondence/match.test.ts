import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classify, duplicatesInResult } from './match';

import type { ComparedEvent, DuplicateKind, EventOrigin, ReferenceDate } from './match';

// The correspondence window by default, imports.duplicateMaxDateGapDays (H-IMP-02).
const WINDOW = 2;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PLAYER_A = '3f2b8c1e-6d4a-4e7b-9a10-5c2d8e4f1a01';
const PLAYER_B = '3f2b8c1e-6d4a-4e7b-9a10-5c2d8e4f1a02';
const HUMILIATION = 'public-humiliation';
const MEDIA_STORM = 'media-storm';
const ARTICLE = 'https://media-national.example/basketball/2021/01/14/article';
const OTHER_ARTICLE = 'https://other-outlet.example/news/2021/01/15/report';
const THIRD_ARTICLE = 'https://third-outlet.example/sport/column';

type Changes = Partial<Omit<ComparedEvent, 'referenceDate'>>;

/** An event of player A, historical and of the public-humiliation type unless changed. */
function eventOn(referenceDate: ReferenceDate, changes: Changes = {}): ComparedEvent {
  return {
    playerId: PLAYER_A,
    eventTypeId: HUMILIATION,
    origin: 'historical',
    referenceDate,
    cleanedUrls: [],
    ...changes,
  };
}

/** An event dated without a time. */
const dated = (day: string, changes?: Changes): ComparedEvent => eventOn({ on: day }, changes);

/** The kind that two events of one player and one type, without links, make. */
const kindOfSameType = (isWithin: boolean): DuplicateKind => (isWithin ? 'duplicate' : 'none');

// --- Dates as offsets, for the properties --------------------------------------------

// Offsets count days and milliseconds from 2019-10-01, 00:00 UTC.
const ORIGIN = Date.UTC(2019, 9, 1);

/** The date `offset` days after 2019-10-01, written YYYY-MM-DD. */
function dayAt(offset: number): string {
  return new Date(ORIGIN + offset * DAY).toISOString().slice(0, 10);
}

// Every offset from UTC−12 to UTC+14 by quarters of an hour, the steps of the world's zones.
const ZONE_OFFSETS = Array.from({ length: 105 }, (_, step) => -12 * HOUR + step * 15 * MINUTE);

/** Whether a zone from UTC−12 to UTC+14 gives `instant` a date at most `windowDays` from day `day`. */
function isWithinWindowInSomeZone(instant: number, day: number, windowDays: number): boolean {
  const zonedDates = new Set(
    ZONE_OFFSETS.map((offset) => new Date(instant + offset).toISOString().slice(0, 10)),
  );
  const datesAround = Array.from({ length: 2 * windowDays + 1 }, (_, step) =>
    dayAt(day - windowDays + step),
  );
  return datesAround.some((date) => zonedDates.has(date));
}

const windows = fc.integer({ min: 0, max: 7 });
const referenceDates: fc.Arbitrary<ReferenceDate> = fc.oneof(
  fc.integer({ min: 0, max: 20 }).map((offset) => ({ on: dayAt(offset) })),
  fc.integer({ min: 0, max: 21 * DAY }).map((ms) => ({ at: ORIGIN + ms })),
);
const comparedEvents: fc.Arbitrary<ComparedEvent> = fc.record({
  playerId: fc.constantFrom(PLAYER_A, PLAYER_B),
  eventTypeId: fc.constantFrom(HUMILIATION, MEDIA_STORM),
  origin: fc.constantFrom<EventOrigin>('historical', 'detected', 'calendar'),
  referenceDate: referenceDates,
  cleanedUrls: fc.subarray([ARTICLE, OTHER_ARTICLE, THIRD_ARTICLE]),
});

// The reference date of the instant `ms` after 2019-10-01, 00:00 UTC: with its time, or
// its date without one.
const withTime = (ms: number): ReferenceDate => ({ at: ORIGIN + ms });
const withoutTime = (ms: number): ReferenceDate => ({ on: dayAt(Math.floor(ms / DAY)) });
const dateForms = fc.constantFrom(withTime, withoutTime);

// The pairs whose outcome the window decides: two historical events of player A without
// links, of one type or two, each dated with or without a time, at most 8 days apart.
const closePairs: fc.Arbitrary<readonly [ComparedEvent, ComparedEvent]> = fc
  .record({
    ms: fc.integer({ min: 8 * DAY, max: 21 * DAY }),
    gap: fc.integer({ min: -8 * DAY, max: 8 * DAY }),
    firstForm: dateForms,
    secondForm: dateForms,
    secondType: fc.constantFrom(HUMILIATION, MEDIA_STORM),
  })
  .map(({ ms, gap, firstForm, secondForm, secondType }) => [
    eventOn(firstForm(ms)),
    eventOn(secondForm(ms + gap), { eventTypeId: secondType }),
  ]);

/**
 * The positions of a result whose entry breaks IMP-26, by which each event duplicates
 * the first earlier event that is kept and that it corresponds to, or is kept.
 */
function breachesOf(
  events: readonly ComparedEvent[],
  duplicateOf: readonly (number | undefined)[],
  windowDays: number,
): readonly number[] {
  const indexed = events.map((event, position) => ({ event, position }));
  return indexed
    .filter(({ event, position }) => {
      const original = indexed.find(
        (earlier) =>
          earlier.position < position &&
          duplicateOf[earlier.position] === undefined &&
          classify(earlier.event, event, windowDays) === 'duplicate',
      );
      return duplicateOf[position] !== original?.position;
    })
    .map(({ position }) => position);
}

describe('classify', () => {
  // 2021-01-14, 12:00 UTC.
  const NOON = Date.UTC(2021, 0, 14, 12);

  it.each([
    { gap: '48 hours', windowDays: WINDOW, ms: 48 * HOUR, expected: 'duplicate' },
    { gap: '48 hours and 1 ms', windowDays: WINDOW, ms: 48 * HOUR + 1, expected: 'none' },
    { gap: '24 hours', windowDays: 1, ms: 24 * HOUR, expected: 'duplicate' },
    { gap: '24 hours and 1 ms', windowDays: 1, ms: 24 * HOUR + 1, expected: 'none' },
    { gap: '0 ms', windowDays: 0, ms: 0, expected: 'duplicate' },
    { gap: '1 ms', windowDays: 0, ms: 1, expected: 'none' },
  ] as const)(
    '[IMP-25] [CL-IMP-12] [CL-IMP-34] matches two instants $gap apart with a window of $windowDays days: $expected',
    ({ windowDays, ms, expected }) => {
      const earlier = eventOn({ at: NOON });
      const later = eventOn({ at: NOON + ms });

      expect(classify(earlier, later, windowDays)).toBe(expected);
      expect(classify(later, earlier, windowDays)).toBe(expected);
    },
  );

  it('[IMP-25] [CL-IMP-12] compares the instants of two timed values, not their dates', () => {
    // 49 hours apart, on 14 and 16 January.
    const earlier = eventOn({ at: NOON });
    const later = eventOn({ at: NOON + 49 * HOUR });

    expect(classify(earlier, later, WINDOW)).toBe('none');
  });

  it.each([
    { day: '2021-01-14', otherDay: '2021-01-14', windowDays: WINDOW, expected: 'duplicate' },
    { day: '2021-01-14', otherDay: '2021-01-15', windowDays: WINDOW, expected: 'duplicate' },
    { day: '2021-01-14', otherDay: '2021-01-16', windowDays: WINDOW, expected: 'duplicate' },
    { day: '2021-01-14', otherDay: '2021-01-17', windowDays: WINDOW, expected: 'none' },
    { day: '2021-02-27', otherDay: '2021-03-01', windowDays: WINDOW, expected: 'duplicate' },
    { day: '2020-02-27', otherDay: '2020-03-01', windowDays: WINDOW, expected: 'none' },
    { day: '2020-12-31', otherDay: '2021-01-02', windowDays: WINDOW, expected: 'duplicate' },
    { day: '2020-12-30', otherDay: '2021-01-02', windowDays: WINDOW, expected: 'none' },
    { day: '2021-01-14', otherDay: '2021-01-17', windowDays: 3, expected: 'duplicate' },
    { day: '2021-01-14', otherDay: '2021-01-15', windowDays: 0, expected: 'none' },
  ] as const)(
    '[IMP-25] [CL-IMP-12] [CL-IMP-34] matches the dates $day and $otherDay, without times, with a window of $windowDays calendar days: $expected',
    ({ day, otherDay, windowDays, expected }) => {
      expect(classify(dated(day), dated(otherDay), windowDays)).toBe(expected);
      expect(classify(dated(otherDay), dated(day), windowDays)).toBe(expected);
    },
  );

  // 11:30 UTC is 23:30 the day before at UTC−12, and 01:30 the next day at UTC+14.
  const HALF_PAST_ELEVEN = Date.UTC(2021, 0, 14, 11, 30);
  // From 12:00 UTC, it is the same day at UTC−12; before 10:00, the same day at UTC+14.
  const TEN = Date.UTC(2021, 0, 14, 10);

  it.each([
    { instant: '11:30', at: HALF_PAST_ELEVEN, day: '2021-01-11', expected: 'duplicate' },
    { instant: '11:30', at: HALF_PAST_ELEVEN, day: '2021-01-10', expected: 'none' },
    { instant: '11:30', at: HALF_PAST_ELEVEN, day: '2021-01-17', expected: 'duplicate' },
    { instant: '11:30', at: HALF_PAST_ELEVEN, day: '2021-01-18', expected: 'none' },
    { instant: '12:00', at: NOON, day: '2021-01-12', expected: 'duplicate' },
    { instant: '12:00', at: NOON, day: '2021-01-11', expected: 'none' },
    { instant: '09:59:59.999', at: TEN - 1, day: '2021-01-16', expected: 'duplicate' },
    { instant: '09:59:59.999', at: TEN - 1, day: '2021-01-17', expected: 'none' },
    { instant: '10:00', at: TEN, day: '2021-01-17', expected: 'duplicate' },
  ] as const)(
    '[IMP-25] [CL-IMP-12] matches 14 January 2021 at $instant UTC, which stands for its dates from UTC−12 to UTC+14, and the date $day: $expected',
    ({ at, day, expected }) => {
      expect(classify(eventOn({ at }), dated(day), WINDOW)).toBe(expected);
      expect(classify(dated(day), eventOn({ at }), WINDOW)).toBe(expected);
    },
  );

  it('[IMP-25] [CL-IMP-12] [CL-IMP-13] makes a possible duplicate of a detected event of 1 March and a result event of another type dated 2 March', () => {
    // The reference date of the detected event, an instant: 1 March, 20:00 UTC.
    const detected = eventOn({ at: Date.UTC(2026, 2, 1, 20) }, { origin: 'detected' });
    const fromResult = dated('2026-03-02', { eventTypeId: MEDIA_STORM });

    expect(classify(fromResult, detected, WINDOW)).toBe('possible_duplicate');
    expect(classify(detected, fromResult, WINDOW)).toBe('possible_duplicate');
  });

  it.each([
    { pair: 'of one type within the window', second: dated('2021-01-15'), expected: 'duplicate' },
    {
      pair: 'of one type with a common link, months apart',
      second: dated('2021-05-03', { cleanedUrls: [OTHER_ARTICLE] }),
      expected: 'duplicate',
    },
    {
      pair: 'of two types within the window',
      second: dated('2021-01-15', { eventTypeId: MEDIA_STORM }),
      expected: 'possible_duplicate',
    },
    {
      pair: 'of two types with a common link, months apart',
      second: dated('2021-05-03', { eventTypeId: MEDIA_STORM, cleanedUrls: [OTHER_ARTICLE] }),
      expected: 'possible_duplicate',
    },
    {
      pair: 'of one type, months apart, without a common link',
      second: dated('2021-05-03', { cleanedUrls: [THIRD_ARTICLE] }),
      expected: 'none',
    },
    {
      pair: 'of two types, months apart, without links',
      second: dated('2021-05-03', { eventTypeId: MEDIA_STORM }),
      expected: 'none',
    },
  ] as const)(
    '[IMP-25] [CL-IMP-13] classifies two events of one player $pair: $expected',
    ({ second, expected }) => {
      const first = dated('2021-01-14', { cleanedUrls: [ARTICLE, OTHER_ARTICLE] });

      expect(classify(first, second, WINDOW)).toBe(expected);
      expect(classify(second, first, WINDOW)).toBe(expected);
    },
  );

  it('[IMP-25] [CL-IMP-14] compares cleaned links exactly, so that http and https make no common link', () => {
    const first = dated('2021-01-14', { cleanedUrls: [ARTICLE] });
    const second = dated('2021-05-03', { cleanedUrls: [ARTICLE.replace('https:', 'http:')] });

    expect(classify(first, second, WINDOW)).toBe('none');
  });

  it.each(['historical', 'detected'] as const)(
    '[IMP-25] [CL-IMP-29] never matches a calendar-derived event and a %s one, of one type on one day',
    (origin) => {
      const derived = dated('2021-01-14', { origin: 'calendar' });
      const reported = dated('2021-01-14', { origin });

      expect(classify(derived, reported, WINDOW)).toBe('none');
      expect(classify(reported, derived, WINDOW)).toBe('none');
    },
  );

  it('[IMP-25] never matches the events of two players', () => {
    const first = dated('2021-01-14', { cleanedUrls: [ARTICLE] });
    const second = dated('2021-01-14', { playerId: PLAYER_B, cleanedUrls: [ARTICLE] });

    expect(classify(first, second, WINDOW)).toBe('none');
  });

  it('[IMP-25] [CL-IMP-12] matches two dates without times when at most the window apart in calendar days', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: -9, max: 9 }),
        windows,
        (offset, gap, windowDays) => {
          const kind = classify(dated(dayAt(offset)), dated(dayAt(offset + gap)), windowDays);

          expect(kind).toBe(kindOfSameType(Math.abs(gap) <= windowDays));
        },
      ),
    );
  });

  it('[IMP-25] [CL-IMP-12] matches an instant and a date when a zone from UTC−12 to UTC+14 gives the instant a date at most the window from it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 * DAY }),
        fc.integer({ min: 0, max: 30 }),
        windows,
        (ms, day, windowDays) => {
          const instant = ORIGIN + ms;
          const kind = classify(eventOn({ at: instant }), dated(dayAt(day)), windowDays);

          expect(kind).toBe(kindOfSameType(isWithinWindowInSomeZone(instant, day, windowDays)));
        },
      ),
    );
  });

  it('[IMP-25] gives the same answer whichever event comes first', () => {
    fc.assert(
      fc.property(comparedEvents, comparedEvents, windows, (first, second, windowDays) => {
        expect(classify(first, second, windowDays)).toBe(classify(second, first, windowDays));
      }),
    );
  });

  it('[IMP-25] [CL-IMP-34] never loses a match to a wider window', () => {
    const widenings = fc.record({ windowDays: windows, widening: fc.integer({ min: 1, max: 7 }) });

    fc.assert(
      fc.property(closePairs, widenings, ([first, second], window) => {
        const kind = classify(first, second, window.windowDays);
        const widerKind = classify(first, second, window.windowDays + window.widening);

        // Only a pair that was none may become a duplicate or a possible duplicate.
        expect(kind === 'none' || widerKind === kind).toBe(true);
      }),
    );
  });
});

describe('duplicatesInResult', () => {
  it('[IMP-26] keeps the first of two corresponding events of a result and makes the later one its duplicate', () => {
    const events = [dated('2021-01-14'), dated('2021-01-15')];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, 0]);
  });

  it('[IMP-26] [CL-IMP-13] keeps both events of different types that share a link and a day', () => {
    const events = [
      dated('2021-01-14', { cleanedUrls: [ARTICLE] }),
      dated('2021-01-14', { eventTypeId: MEDIA_STORM, cleanedUrls: [ARTICLE] }),
    ];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, undefined]);
  });

  it('[IMP-26] makes an event the duplicate of the first kept event it corresponds to', () => {
    // The third corresponds to the first by its date, and to the second by a common link.
    const events = [
      dated('2021-01-14', { cleanedUrls: [ARTICLE] }),
      dated('2021-05-03', { cleanedUrls: [OTHER_ARTICLE] }),
      dated('2021-01-15', { cleanedUrls: [OTHER_ARTICLE] }),
    ];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, undefined, 0]);
  });

  it('[IMP-26] gives the index in the result of the event that a duplicate joins', () => {
    // 15 January duplicates 14 January; 4 May duplicates 3 May, the third event.
    const events = [
      dated('2021-01-14'),
      dated('2021-01-15'),
      dated('2021-05-03'),
      dated('2021-05-04'),
    ];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, 0, undefined, 2]);
  });

  it('[IMP-26] keeps an event that corresponds only to a duplicate', () => {
    // 16 January duplicates 14 January; 18 January is 4 days from 14 January.
    const events = [dated('2021-01-14'), dated('2021-01-16'), dated('2021-01-18')];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, 0, undefined]);
  });

  it('[IMP-26] keeps an event that shares a link only with a duplicate, whose links stay its own', () => {
    // 15 January duplicates 14 January by its date; 3 May shares a link with 15 January only.
    const events = [
      dated('2021-01-14', { cleanedUrls: [ARTICLE] }),
      dated('2021-01-15', { cleanedUrls: [OTHER_ARTICLE] }),
      dated('2021-05-03', { cleanedUrls: [OTHER_ARTICLE] }),
    ];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, 0, undefined]);
  });

  it('[IMP-26] [CL-IMP-34] finds the duplicates of the window it is given', () => {
    const events = [dated('2021-01-14'), dated('2021-01-17')];

    expect(duplicatesInResult(events, WINDOW)).toStrictEqual([undefined, undefined]);
    expect(duplicatesInResult(events, 3)).toStrictEqual([undefined, 0]);
  });

  it('[IMP-26] finds no duplicate in an empty result', () => {
    expect(duplicatesInResult([], WINDOW)).toStrictEqual([]);
  });

  it('[IMP-26] makes each event the duplicate of the first earlier kept event it corresponds to, or keeps it', () => {
    fc.assert(
      fc.property(fc.array(comparedEvents, { maxLength: 8 }), windows, (events, windowDays) => {
        const duplicateOf = duplicatesInResult(events, windowDays);

        expect(duplicateOf).toHaveLength(events.length);
        expect(breachesOf(events, duplicateOf, windowDays)).toStrictEqual([]);
      }),
    );
  });
});
