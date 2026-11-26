import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatInstant, parseTimestamp, toEpochMs, toIsoDate } from '@/lib/time';

import {
  checkItem,
  earliestCompatibleInstant,
  isWithinAdmittedAge,
  oldestItemInstant,
  ownerSourceInstant,
  retainedInstant,
} from './dating';

import type { DatedItem } from './dating';
import type { FeedItem } from '@/lib/press-feeds';
import type { EpochMs, ParsedTimestamp } from '@/lib/time';

const PARIS = 'Europe/Paris';
const NEW_YORK = 'America/New_York';
const NO_ZONE = null;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_AGE_MS = 3 * DAY_MS;

/** A feed's date as the port gives it: an instant, a date alone or a wall time. */
function stamp(text: string): ParsedTimestamp {
  const read = parseTimestamp(text);
  if (!read.ok) {
    throw new Error(`Not a timestamp: ${text}`);
  }
  return read.timestamp;
}

/** An instant written in ISO 8601 with its offset, as a test reads it. */
function at(text: string): EpochMs {
  const timestamp = stamp(text);
  if (timestamp.kind !== 'instant') {
    throw new Error(`Not an instant: ${text}`);
  }
  return timestamp.at;
}

const COMPLETE: FeedItem = {
  identifier: 'item-1',
  link: 'https://press.example/article',
  title: 'A guard signs an extension',
  publishedAt: null,
  updatedAt: null,
  language: null,
  originOutlet: null,
  excerpt: null,
};
const UNDATED: DatedItem = { publishedAt: null, updatedAt: null };

const published = (text: string): DatedItem => ({ publishedAt: stamp(text), updatedAt: null });

/** One case of a dating table: the feed's text, the outlet zone, if any, and the instant. */
type DatingCase = Readonly<{ name: string; text: string; zone: string | null; expected: string }>;

const row = ([name, text, zone, expected]: readonly [
  string,
  string,
  string | null,
  string,
]): DatingCase => ({ name, text, zone, expected });

describe('checkItem', () => {
  it.each([
    { name: 'without a link', change: { link: null } },
    { name: 'without a title', change: { title: null } },
    { name: 'with a blank link', change: { link: ' '.repeat(3) } },
    { name: 'with a blank title', change: { title: ' \t ' } },
    { name: 'without a link, in another language', change: { link: null, language: 'de' } },
  ])('[COL-18] rejects an item $name as incomplete', ({ change }) => {
    expect(checkItem({ ...COMPLETE, ...change }, 'en')).toStrictEqual({
      ok: false,
      error: { kind: 'incomplete' },
    });
  });

  it.each(['de', 'es-ES', 'english', 'it'])(
    '[COL-17] rejects an item declared %s as an unsupported language',
    (language) => {
      expect(checkItem({ ...COMPLETE, language }, 'en')).toStrictEqual({
        ok: false,
        error: { kind: 'unsupported_language' },
      });
    },
  );

  it.each([
    { language: 'fr', source: 'en', expected: 'fr' },
    { language: 'en', source: 'fr', expected: 'en' },
    { language: 'en-US', source: 'fr', expected: 'en' },
    { language: 'FR_ca', source: 'en', expected: 'fr' },
    { language: ' en-GB ', source: 'fr', expected: 'en' },
  ] as const)(
    '[COL-17] keeps the language $language that an item declares over its source language $source',
    ({ language, source, expected }) => {
      expect(checkItem({ ...COMPLETE, language }, source)).toStrictEqual({
        ok: true,
        language: expected,
      });
    },
  );

  it.each([null, '', ' '.repeat(2)])(
    '[COL-17] [CL-COL-11] gives an item declared %j its source language, detecting nothing',
    (language) => {
      const english = { ...COMPLETE, title: 'The forward is out for the season', language };
      expect(checkItem(english, 'fr')).toStrictEqual({ ok: true, language: 'fr' });
    },
  );
});

describe('retainedInstant', () => {
  const LATE = at('2026-11-20T00:00:00Z');

  it('[COL-19] takes the publication date before the update date, else the update date', () => {
    const both = {
      publishedAt: stamp('2026-11-10T10:00:00Z'),
      updatedAt: stamp('2026-11-10T11:00:00Z'),
    };
    const updateOnly = { publishedAt: null, updatedAt: stamp('2026-11-10T11:00:00Z') };
    expect(retainedInstant(both, NO_ZONE, LATE).at).toBe(at('2026-11-10T10:00:00Z'));
    expect(retainedInstant(updateOnly, NO_ZONE, LATE)).toStrictEqual({
      at: at('2026-11-10T11:00:00Z'),
      precision: 'exact',
      dateAnomaly: false,
    });
  });

  it.each([
    row([
      'an instant with its offset',
      '2026-11-10T23:10:00-05:00',
      NO_ZONE,
      '2026-11-11T04:10:00Z',
    ]),
    row([
      'a wall time in the outlet zone',
      '2026-11-10T23:10:00',
      NEW_YORK,
      '2026-11-11T04:10:00Z',
    ]),
    row(['a wall time in Paris', '2026-11-10T23:10:00', PARIS, '2026-11-10T22:10:00Z']),
  ])('[COL-20] dates $name exactly', ({ text, zone, expected }) => {
    expect(retainedInstant(published(text), zone, LATE)).toStrictEqual({
      at: at(expected),
      precision: 'exact',
      dateAnomaly: false,
    });
  });

  it.each([
    row(['a date alone in Paris', '2026-11-10', PARIS, '2026-11-10T22:59:59.999Z']),
    row(['a date alone in New York', '2026-11-10', NEW_YORK, '2026-11-11T04:59:59.999Z']),
    row([
      'a date alone without zone, at UTC-12',
      '2026-11-10',
      NO_ZONE,
      '2026-11-11T11:59:59.999Z',
    ]),
    row([
      'a wall time without zone, at UTC-12',
      '2026-11-10T18:00:00',
      NO_ZONE,
      '2026-11-11T06:00:00Z',
    ]),
  ])(
    '[COL-20] [COL-21] dates $name approximately at its latest instant',
    ({ text, zone, expected }) => {
      expect(retainedInstant(published(text), zone, LATE)).toStrictEqual({
        at: at(expected),
        precision: 'approximate',
        dateAnomaly: false,
      });
    },
  );

  it.each([
    row([
      'repeated in Paris takes the later',
      '2026-10-25T02:30:00',
      PARIS,
      '2026-10-25T01:30:00Z',
    ]),
    row([
      'skipped in Paris moves by the gap',
      '2026-03-29T02:30:00',
      PARIS,
      '2026-03-29T01:30:00Z',
    ]),
    row([
      'repeated in New York takes the later',
      '2026-11-01T01:30:00',
      NEW_YORK,
      '2026-11-01T06:30Z',
    ]),
    row([
      'skipped in New York moves by the gap',
      '2026-03-08T02:30:00',
      NEW_YORK,
      '2026-03-08T07:30Z',
    ]),
  ])('[COL-21] [CL-COL-02] a wall time $name instant', ({ text, zone, expected }) => {
    expect(retainedInstant(published(text), zone, LATE)).toStrictEqual({
      at: at(expected),
      precision: 'exact',
      dateAnomaly: false,
    });
  });

  it.each([
    row(['the 25-hour day in Paris', '2026-10-25', PARIS, '2026-10-25T22:59:59.999Z']),
    row(['the 23-hour day in New York', '2026-03-08', NEW_YORK, '2026-03-09T03:59:59.999Z']),
  ])('[COL-21] [CL-COL-02] ends a date alone at the end of $name', ({ text, zone, expected }) => {
    expect(retainedInstant(published(text), zone, LATE).at).toBe(at(expected));
  });

  it('[COL-21] [CL-COL-02] gives an undated item its first-collection instant, of no precision', () => {
    expect(retainedInstant(UNDATED, PARIS, LATE)).toStrictEqual({
      at: LATE,
      precision: 'none',
      dateAnomaly: false,
    });
  });

  it('[COL-22] [CL-COL-03] keeps a candidate equal to the first collection with its precision', () => {
    const firstCollectedAt = at('2026-11-11T04:10:00Z');
    expect(
      retainedInstant(published('2026-11-10T23:10:00'), NEW_YORK, firstCollectedAt),
    ).toStrictEqual({ at: firstCollectedAt, precision: 'exact', dateAnomaly: false });
  });

  it.each([
    row(['an instant after it', '2026-11-11T09:00:01Z', NO_ZONE, '2026-11-11T09:00:00Z']),
    row([
      'a date that starts after it at UTC+14',
      '2026-11-12',
      NO_ZONE,
      '2026-11-11T09:59:59.999Z',
    ]),
    row(['a date that starts after it in Paris', '2026-11-12', PARIS, '2026-11-11T22:30:00Z']),
    row(['a wall time after it in New York', '2026-11-11T09:00:00', NEW_YORK, '2026-11-11T13:00Z']),
    row(['a wall time after it at UTC+14', '2026-11-11T09:00:00', NO_ZONE, '2026-11-10T18:59:00Z']),
  ])(
    '[COL-22] [CL-COL-03] counts $name as a date anomaly at the first collection',
    ({ text, zone, expected }) => {
      expect(retainedInstant(published(text), zone, at(expected))).toStrictEqual({
        at: at(expected),
        precision: 'approximate',
        dateAnomaly: true,
      });
    },
  );

  it.each([
    row(['a date read on its own day', '2026-11-10', NO_ZONE, '2026-11-10T20:00:00Z']),
    row(['a date whose day starts at it at UTC+14', '2026-11-12', NO_ZONE, '2026-11-11T10:00:00Z']),
    row(['a date read just after its start in Paris', '2026-11-12', PARIS, '2026-11-11T23:30:00Z']),
    row([
      'a wall time past it at UTC-12 only',
      '2026-11-11T09:00:00',
      NO_ZONE,
      '2026-11-11T13:00:00Z',
    ]),
    row([
      'the later of a repeated wall time',
      '2026-10-25T02:30:00',
      PARIS,
      '2026-10-25T01:00:00Z',
    ]),
  ])(
    '[COL-22] [CL-COL-03] caps $name at the first collection, approximate and not counted',
    ({ text, zone, expected }) => {
      expect(retainedInstant(published(text), zone, at(expected))).toStrictEqual({
        at: at(expected),
        precision: 'approximate',
        dateAnomaly: false,
      });
    },
  );

  it.each([
    { name: 'with its offset', text: '2026-11-10T23:10:00-05:00', zone: NO_ZONE },
    { name: 'in its outlet zone', text: '2026-11-10T23:10:00', zone: NEW_YORK },
  ])(
    '[CA-COL-06] [COL-19] [COL-20] shows a 23:10 New York item $name as 05:10 the next day in Paris',
    ({ text, zone }) => {
      const retained = retainedInstant(published(text), zone, at('2026-11-11T06:00:00Z'));
      expect(retained.precision).toBe('exact');
      expect(formatInstant(retained.at, PARIS, 'full')).toBe(
        'Wednesday 11 November 2026, 05:10 Paris time',
      );
    },
  );

  it('[CA-COL-07] [COL-21] [COL-22] retains a date-only item of D read on D+1 after a D tip-off', () => {
    const tipOff = at('2026-11-10T19:30:00-05:00');
    const item = published('2026-11-10');
    expect(retainedInstant(item, NO_ZONE, at('2026-11-11T07:00:00Z'))).toStrictEqual({
      at: at('2026-11-11T07:00:00Z'),
      precision: 'approximate',
      dateAnomaly: false,
    });
    const nextDayInNewYork = fc.integer({
      min: at('2026-11-11T05:00:00Z'),
      max: at('2026-11-12T04:59:59.999Z'),
    });
    fc.assert(
      fc.property(nextDayInNewYork, (collected) => {
        expect(retainedInstant(item, NO_ZONE, toEpochMs(collected)).at).toBeGreaterThan(tipOff);
      }),
    );
  });
});

const pad = (value: number): string => String(value).padStart(2, '0');
const OFFSETS = ['Z', '+02:00', '-05:00', '+14:00', '-12:00'];
const ZONES = [NO_ZONE, PARIS, NEW_YORK, 'Asia/Tokyo'];

const anyTimestamp = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    // A date alone, a wall time without offset (''), or an instant with its offset.
    form: fc.constantFrom('date', '', ...OFFSETS),
  })
  .map(({ year, month, day, hour, minute, form }) => {
    const date = `${String(year)}-${pad(month)}-${pad(day)}`;
    const time = `${date}T${pad(hour)}:${pad(minute)}:00`;
    return stamp(form === 'date' ? date : `${time}${form}`);
  });

describe('the first-collection bound', () => {
  it('[COL-22] never retains an instant after the first collection, and flags only real anomalies', () => {
    const shift = fc.integer({ min: -3 * DAY_MS, max: 3 * DAY_MS });
    fc.assert(
      fc.property(anyTimestamp, fc.constantFrom(...ZONES), shift, (timestamp, zone, delta) => {
        const collected = toEpochMs(earliestCompatibleInstant(timestamp, zone) + delta);
        const item = { publishedAt: timestamp, updatedAt: null };
        const retained = retainedInstant(item, zone, collected);
        expect(retained.at).toBeLessThanOrEqual(collected);
        expect(retained.dateAnomaly).toBe(delta < 0);
        expect(retained.precision).not.toBe('none');
      }),
    );
  });

  it('[CL-COL-03] [CL-COL-13] never puts the earliest compatible instant after the cautious one', () => {
    fc.assert(
      fc.property(anyTimestamp, fc.constantFrom(...ZONES), (timestamp, zone) => {
        const cautious = oldestItemInstant([{ publishedAt: timestamp, updatedAt: null }], zone);
        expect(cautious).not.toBeNull();
        expect(earliestCompatibleInstant(timestamp, zone)).toBeLessThanOrEqual(Number(cautious));
      }),
    );
  });
});

describe('earliestCompatibleInstant', () => {
  it.each([
    row(['an instant as it is', '2026-11-10T23:10:00-05:00', NO_ZONE, '2026-11-11T04:10:00Z']),
    row(['a date at 00:00 at UTC+14', '2026-11-10', NO_ZONE, '2026-11-09T10:00:00Z']),
    row(['a date at 00:00 of the 25-hour day in Paris', '2026-10-25', PARIS, '2026-10-24T22:00Z']),
    row([
      'a date at 00:00 of the 23-hour day in New York',
      '2026-03-08',
      NEW_YORK,
      '2026-03-08T05:00Z',
    ]),
    row(['a wall time at UTC+14', '2026-11-10T18:00:00', NO_ZONE, '2026-11-10T04:00:00Z']),
    row(['the first of a repeated time in Paris', '2026-10-25T02:30', PARIS, '2026-10-25T00:30Z']),
    row(['a skipped time in Paris at the gap end', '2026-03-29T02:30', PARIS, '2026-03-29T01:00Z']),
    row([
      'the first of a repeated time in New York',
      '2026-11-01T01:30',
      NEW_YORK,
      '2026-11-01T05:30Z',
    ]),
    row([
      'a skipped time in New York at the gap end',
      '2026-03-08T02:30',
      NEW_YORK,
      '2026-03-08T07:00Z',
    ]),
  ])('[CL-COL-03] gives $name', ({ text, zone, expected }) => {
    expect(earliestCompatibleInstant(stamp(text), zone)).toBe(at(expected));
  });
});

describe('oldestItemInstant', () => {
  it('[CL-COL-13] takes the earliest cautious instant of the dated items, before any cap', () => {
    const items: DatedItem[] = [
      UNDATED,
      published('2026-11-10'),
      published('2026-11-11T08:00:00Z'),
      { publishedAt: stamp('2026-11-11T09:00:00Z'), updatedAt: stamp('2026-11-11T07:00:00Z') },
      published('2026-11-11T10:00:00Z'),
    ];
    expect(oldestItemInstant(items, NO_ZONE)).toBe(at('2026-11-11T08:00:00Z'));
    expect(oldestItemInstant(items.slice(0, 2), NO_ZONE)).toBe(at('2026-11-11T11:59:59.999Z'));
    expect(oldestItemInstant(items.slice(0, 2), PARIS)).toBe(at('2026-11-10T22:59:59.999Z'));
  });

  it('[CL-COL-13] gives no instant to a feed without a dated item', () => {
    expect(oldestItemInstant([], PARIS)).toBeNull();
    expect(oldestItemInstant([UNDATED], PARIS)).toBeNull();
  });
});

describe('isWithinAdmittedAge', () => {
  const readAt = at('2026-11-20T06:00:00Z');
  const isAdmitted = (ageMs: number, admittedAgeMs: number): boolean =>
    isWithinAdmittedAge({ retainedAt: toEpochMs(readAt - ageMs), readAt, admittedAgeMs });

  it('[COL-24] admits an item exactly as old as the maximum age, and none older', () => {
    expect(isAdmitted(MAX_AGE_MS, MAX_AGE_MS)).toBe(true);
    expect(isAdmitted(MAX_AGE_MS + 1, MAX_AGE_MS)).toBe(false);
    expect(isAdmitted(-HOUR_MS, MAX_AGE_MS)).toBe(true);
  });

  it('[COL-45] [CL-COL-04] admits up to 9 days after R six days ago with a 3-day maximum age', () => {
    const catchUp = MAX_AGE_MS + 6 * DAY_MS;
    expect(isAdmitted(8 * DAY_MS, catchUp)).toBe(true);
    expect(isAdmitted(10 * DAY_MS, catchUp)).toBe(false);
  });
});

describe('ownerSourceInstant', () => {
  const WEDNESDAY = toIsoDate('2026-11-11');

  it('[CL-DET-26] dates a Wednesday source given as a date alone at 11:59:59.999 UTC on Thursday', () => {
    expect(ownerSourceInstant({ on: WEDNESDAY, time: null, zone: NO_ZONE })).toStrictEqual({
      at: at('2026-11-12T11:59:59.999Z'),
      precision: 'approximate',
    });
  });

  it.each([
    {
      name: 'a time in its zone, exact',
      time: '20:30',
      zone: PARIS,
      expected: { at: at('2026-11-11T19:30:00Z'), precision: 'exact' },
    },
    {
      name: 'a time without zone at UTC-12, approximate',
      time: '20:30',
      zone: NO_ZONE,
      expected: { at: at('2026-11-12T08:30:00Z'), precision: 'approximate' },
    },
    {
      name: 'a date in its zone at the end of that day, approximate',
      time: null,
      zone: NEW_YORK,
      expected: { at: at('2026-11-12T04:59:59.999Z'), precision: 'approximate' },
    },
  ])('[CL-DET-26] [COL-21] dates $name', ({ time, zone, expected }) => {
    expect(ownerSourceInstant({ on: WEDNESDAY, time, zone })).toStrictEqual(expected);
  });

  it.each([
    row(['repeated in Paris at its later instant', '2026-10-25T02:30', PARIS, '2026-10-25T01:30Z']),
    row(['skipped in Paris moved by the gap', '2026-03-29T02:30', PARIS, '2026-03-29T01:30Z']),
    row([
      'repeated in New York at its later instant',
      '2026-11-01T01:30',
      NEW_YORK,
      '2026-11-01T06:30Z',
    ]),
    row([
      'skipped in New York moved by the gap',
      '2026-03-08T02:30',
      NEW_YORK,
      '2026-03-08T07:30Z',
    ]),
  ])('[CL-DET-26] [CL-COL-02] dates a time $name', ({ text, zone, expected }) => {
    const [on = '', time = ''] = text.split('T', 2);
    expect(ownerSourceInstant({ on: toIsoDate(on), time, zone })).toStrictEqual({
      at: at(expected),
      precision: 'exact',
    });
  });
});
