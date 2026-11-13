import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it, vi } from 'vitest';

import { compareIsoDates, toIsoDate } from './calendar-date';
import { compareInstants, toEpochMs } from './instant';
import {
  endOfDayPacific,
  endOfLocalDay,
  gameDay,
  gameDayStart,
  localOccurrenceInstant,
  startOfLocalDay,
  toZoned,
  userDay,
} from './zones';

import type { IsoDate } from './calendar-date';
import type { EpochMs } from './instant';

const PARIS = 'Europe/Paris';
const NEW_YORK = 'America/New_York';
const LOS_ANGELES = 'America/Los_Angeles';
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const utc = (text: string): EpochMs => toEpochMs(Date.parse(text));
const day = (text: string): IsoDate => toIsoDate(text);
const isoDateOf = (dayNumber: number): IsoDate =>
  toIsoDate(new Date(dayNumber * DAY_MS).toISOString().slice(0, 10));

/** `count` consecutive calendar dates from `first`. */
function consecutiveDays(first: string, count: number): IsoDate[] {
  const start = Date.parse(`${first}T00:00:00Z`) / DAY_MS;
  return Array.from({ length: count }, (_, index) => isoDateOf(start + index));
}

/** Every minute of `on` in `zone` at which the clock reads `time`. */
function readingsOf(on: IsoDate, time: string, zone: string): EpochMs[] {
  const start = startOfLocalDay(on, zone);
  const minutes = (endOfLocalDay(on, zone) - start) / MINUTE_MS;
  return Array.from({ length: minutes }, (_, index) => toEpochMs(start + index * MINUTE_MS)).filter(
    (at) => toZoned(at, zone).time === time,
  );
}

/** How many hours Paris is ahead of New York at the start of `on`. */
const hoursAhead = (on: IsoDate): number =>
  (startOfLocalDay(on, NEW_YORK) - startOfLocalDay(on, PARIS)) / HOUR_MS;

// From 1980 to 2100 these zones change their clocks only away from midnight, by one hour.
const ZONES = [
  PARIS,
  NEW_YORK,
  LOS_ANGELES,
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
];
const anyZone = fc.constantFrom(...ZONES);
const anyMinute = fc
  .integer({ min: Date.UTC(1980, 0, 1) / MINUTE_MS, max: Date.UTC(2100, 0, 1) / MINUTE_MS })
  .map((minute) => toEpochMs(minute * MINUTE_MS));
const anyDay = fc
  .integer({ min: Date.UTC(1980, 0, 1) / DAY_MS, max: Date.UTC(2099, 11, 31) / DAY_MS })
  .map((dayNumber) => isoDateOf(dayNumber));

describe('comparing an article with a game', () => {
  it('[TRV-69] [CA-TRV-22] finds an article of 00:30 Paris time on 11 November 2026 one hour before a 19:30 New York tip-off of the 10th', () => {
    const tipOff = localOccurrenceInstant(day('2026-11-10'), '19:30', NEW_YORK);
    const article = localOccurrenceInstant(day('2026-11-11'), '00:30', PARIS);

    expect(compareInstants(article, tipOff)).toBeLessThan(0);
    expect(tipOff - article).toBe(HOUR_MS);
    expect(compareIsoDates(userDay(article, PARIS), gameDay(tipOff))).toBeGreaterThan(0);
  });

  it('[TRV-70] [CA-TRV-23] finds an article of 00:45 Paris time on 28 October 2026 after a 19:30 New York tip-off of the 27th, Paris being five hours ahead that week', () => {
    const tipOff = localOccurrenceInstant(day('2026-10-27'), '19:30', NEW_YORK);
    const article = localOccurrenceInstant(day('2026-10-28'), '00:45', PARIS);

    expect(compareInstants(article, tipOff)).toBeGreaterThan(0);
    expect(article - tipOff).toBe(15 * MINUTE_MS);
    expect(toZoned(tipOff, PARIS)).toStrictEqual({ on: '2026-10-28', time: '00:30' });
  });

  it('[TRV-70] puts Paris five hours ahead of New York for three weeks in spring and one week in autumn of 2026, six hours otherwise', () => {
    const year = consecutiveDays('2026-01-01', 365);

    expect(year.filter((on) => hoursAhead(on) === 5)).toStrictEqual([
      ...consecutiveDays('2026-03-09', 21),
      ...consecutiveDays('2026-10-26', 7),
    ]);
    expect(year.filter((on) => hoursAhead(on) === 6)).toHaveLength(365 - 28);
  });
});

describe('the day of an instant', () => {
  it.each([
    [PARIS, '2026-11-11'],
    ['Asia/Tokyo', '2026-11-11'],
    ['Pacific/Kiritimati', '2026-11-11'],
    [NEW_YORK, '2026-11-10'],
    [LOS_ANGELES, '2026-11-10'],
    ['Pacific/Pago_Pago', '2026-11-10'],
  ])(
    '[TRV-72] gives a 19:30 New York game of 10 November 2026 the day 2026-11-10 for an owner in %s, whose own day is %s',
    (zone, ownerDay) => {
      const tipOff = localOccurrenceInstant(day('2026-11-10'), '19:30', NEW_YORK);

      expect(gameDay(tipOff)).toBe('2026-11-10');
      expect(userDay(tipOff, zone)).toBe(ownerDay);
    },
  );

  it('[TRV-72] keeps the New York date of a game played in Europe, even when the date at the venue differs', () => {
    const inParis = localOccurrenceInstant(day('2026-01-22'), '20:00', PARIS);
    const lateInBerlin = localOccurrenceInstant(day('2026-11-12'), '00:30', 'Europe/Berlin');

    expect(gameDay(inParis)).toBe('2026-01-22');
    expect(gameDay(lateInBerlin)).toBe('2026-11-11');
    expect(userDay(lateInBerlin, 'Europe/Berlin')).toBe('2026-11-12');
  });

  it('[TRV-72] gives one instant of New Year’s Eve its own day and time in each zone', () => {
    const at = utc('2026-12-31T23:30:00Z');
    const endOfYear = endOfLocalDay(day('2026-12-31'), PARIS);

    expect(toZoned(at, PARIS)).toStrictEqual({ on: '2027-01-01', time: '00:30' });
    expect(toZoned(at, NEW_YORK)).toStrictEqual({ on: '2026-12-31', time: '18:30' });
    expect(gameDay(at)).toBe('2026-12-31');
    expect(userDay(endOfYear, PARIS)).toBe('2027-01-01');
  });

  it('[TRV-72] counts a leap day as a day of its own, and none in a common year', () => {
    const leapDay = day('2028-02-29');
    const endOfFebruary2027 = endOfLocalDay(day('2027-02-28'), PARIS);

    expect(endOfLocalDay(day('2028-02-28'), PARIS)).toBe(startOfLocalDay(leapDay, PARIS));
    expect(endOfLocalDay(leapDay, NEW_YORK)).toBe(utc('2028-03-01T05:00:00Z'));
    expect(userDay(utc('2028-02-29T23:30:00Z'), PARIS)).toBe('2028-03-01');
    expect(userDay(endOfFebruary2027, PARIS)).toBe('2027-03-01');
  });

  it('reads an instant to the minute, the seconds left out', () => {
    expect(toZoned(utc('2026-11-11T00:30:59.999Z'), PARIS)).toStrictEqual({
      on: '2026-11-11',
      time: '01:30',
    });
  });

  it('throws for a zone that does not exist, which validating the setting rules out', () => {
    expect(() => toZoned(utc('2026-11-11T00:30:00Z'), 'Mars/Olympus')).toThrow(RangeError);
  });

  it('[TRV-72] keeps every instant inside its own day, and days in the order of instants', () => {
    fc.assert(
      fc.property(anyMinute, anyMinute, anyZone, (first, second, zone) => {
        const earlier = toEpochMs(Math.min(first, second));
        const later = toEpochMs(Math.max(first, second));
        const own = userDay(earlier, zone);

        expect(startOfLocalDay(own, zone)).toBeLessThanOrEqual(earlier);
        expect(endOfLocalDay(own, zone)).toBeGreaterThan(earlier);
        expect(compareIsoDates(own, userDay(later, zone))).toBeLessThanOrEqual(0);
      }),
    );
  });
});

describe('the start and the end of a day', () => {
  it.each([
    { zone: PARIS, on: '2026-03-29', start: '2026-03-28T23:00:00Z', end: '2026-03-29T22:00:00Z' },
    { zone: PARIS, on: '2026-10-25', start: '2026-10-24T22:00:00Z', end: '2026-10-25T23:00:00Z' },
    {
      zone: NEW_YORK,
      on: '2026-03-08',
      start: '2026-03-08T05:00:00Z',
      end: '2026-03-09T04:00:00Z',
    },
    {
      zone: NEW_YORK,
      on: '2026-11-01',
      start: '2026-11-01T04:00:00Z',
      end: '2026-11-02T05:00:00Z',
    },
    {
      zone: LOS_ANGELES,
      on: '2026-03-08',
      start: '2026-03-08T08:00:00Z',
      end: '2026-03-09T07:00:00Z',
    },
    {
      zone: LOS_ANGELES,
      on: '2026-11-01',
      start: '2026-11-01T07:00:00Z',
      end: '2026-11-02T08:00:00Z',
    },
  ])(
    '[TRV-70] starts $on in $zone at $start and ends it at $end, a clock change in between',
    ({ zone, on, start, end }) => {
      expect(startOfLocalDay(day(on), zone)).toBe(utc(start));
      expect(endOfLocalDay(day(on), zone)).toBe(utc(end));
    },
  );

  it('[TRV-72] starts a day whose midnight a clock change skips at the end of the gap', () => {
    expect(startOfLocalDay(day('2026-03-08'), 'America/Havana')).toBe(utc('2026-03-08T05:00:00Z'));
  });

  it.each([
    ['2026-03-08', '2026-03-09T07:00:00Z', 23],
    ['2026-11-01', '2026-11-02T08:00:00Z', 25],
    ['2026-11-10', '2026-11-11T08:00:00Z', 24],
  ])(
    '[TRV-70] [TRV-72] ends the date-only day %s at 00:00 Los Angeles time on the next day, %s, after %d hours of Pacific time',
    (on, end, hours) => {
      const dated = day(on);

      expect(endOfDayPacific(dated)).toBe(utc(end));
      expect(endOfDayPacific(dated) - startOfLocalDay(dated, LOS_ANGELES)).toBe(hours * HOUR_MS);
    },
  );

  it('puts a same-evening game on the Pacific coast before the end of a date-only day, and the next day’s game after it', () => {
    const datedOnly = endOfDayPacific(day('2026-03-08'));
    const sameEvening = localOccurrenceInstant(day('2026-03-08'), '19:30', LOS_ANGELES);
    const nextDay = localOccurrenceInstant(day('2026-03-09'), '19:00', NEW_YORK);

    expect(compareInstants(sameEvening, datedOnly)).toBeLessThan(0);
    expect(compareInstants(nextDay, datedOnly)).toBeGreaterThan(0);
  });

  it.each([
    ['2026-11-10', '2026-11-10T05:00:00Z'],
    ['2026-07-04', '2026-07-04T04:00:00Z'],
    ['2026-03-08', '2026-03-08T05:00:00Z'],
  ])(
    '[TRV-72] deems a game of %s whose time is to be determined to start at 00:00 New York time, %s',
    (on, start) => {
      const deemedStart = gameDayStart(day(on));

      expect(deemedStart).toBe(utc(start));
      expect(gameDay(deemedStart)).toBe(on);
    },
  );

  it('[TRV-72] gives every game day a start that belongs to that day', () => {
    fc.assert(
      fc.property(anyDay, (on) => {
        expect(gameDay(gameDayStart(on))).toBe(on);
      }),
    );
  });
});

describe('the instant of a scheduled local time', () => {
  it.each([
    ['16:30', '2026-11-13', '2026-11-13T15:30:00Z'],
    ['16:30', '2026-07-13', '2026-07-13T14:30:00Z'],
    ['23:00:30', '2026-11-13', '2026-11-13T22:00:30Z'],
  ])('[TRV-70] puts %s Paris time on %s at %s', (time, on, expected) => {
    expect(localOccurrenceInstant(day(on), time, PARIS)).toBe(utc(expected));
  });

  it.each([
    { time: '02:30', on: '2026-03-29', zone: PARIS, expected: '2026-03-29T01:00:00Z' },
    { time: '02:30', on: '2026-03-08', zone: NEW_YORK, expected: '2026-03-08T07:00:00Z' },
  ])(
    '[TRV-70] runs $time on $on in $zone, a time the clock skips, exactly once, at 03:00 just after the gap',
    ({ time, on, zone, expected }) => {
      const occurrence = localOccurrenceInstant(day(on), time, zone);

      expect(readingsOf(day(on), time, zone)).toStrictEqual([]);
      expect(occurrence).toBe(utc(expected));
      expect(toZoned(occurrence, zone)).toStrictEqual({ on, time: '03:00' });
    },
  );

  it.each([
    {
      time: '02:30',
      on: '2026-10-25',
      zone: PARIS,
      first: '2026-10-25T00:30:00Z',
      second: '2026-10-25T01:30:00Z',
    },
    {
      time: '01:30',
      on: '2026-11-01',
      zone: NEW_YORK,
      first: '2026-11-01T05:30:00Z',
      second: '2026-11-01T06:30:00Z',
    },
  ])(
    '[TRV-70] runs $time on $on in $zone, a time the clock reads twice, exactly once, at its first occurrence',
    ({ time, on, zone, first, second }) => {
      expect(readingsOf(day(on), time, zone)).toStrictEqual([utc(first), utc(second)]);
      expect(localOccurrenceInstant(day(on), time, zone)).toBe(utc(first));
    },
  );

  it.each([
    ['02:30', PARIS, '2026-03-26'],
    ['02:30', PARIS, '2026-10-22'],
    ['02:30', NEW_YORK, '2026-03-05'],
    ['01:30', NEW_YORK, '2026-10-29'],
  ])(
    '[TRV-70] gives %s in %s one instant inside each day of the week from %s, across its clock change',
    (time, zone, from) => {
      const week = consecutiveDays(from, 7);
      const occurrences = week.map((on) => localOccurrenceInstant(on, time, zone));

      expect(occurrences.map((at) => userDay(at, zone))).toStrictEqual(week);
      expect(occurrences.toSorted(compareInstants)).toStrictEqual(occurrences);
    },
  );

  it('refuses to guess the instant of a skipped time when the zone database knows no clock change after it', () => {
    vi.spyOn(Temporal.ZonedDateTime.prototype, 'getTimeZoneTransition').mockReturnValue(null);

    expect(() => localOccurrenceInstant(day('2026-03-29'), '02:30', PARIS)).toThrow(
      'No clock change follows 2026-03-29T01:30:00+01:00[Europe/Paris].',
    );
  });

  it('[TRV-70] reads every minute back from its local date and time, or from the first of two that repeat it', () => {
    fc.assert(
      fc.property(anyMinute, anyZone, (at, zone) => {
        const local = toZoned(at, zone);
        const occurrence = localOccurrenceInstant(local.on, local.time, zone);

        expect(toZoned(occurrence, zone)).toStrictEqual(local);
        expect([0, HOUR_MS]).toContain(at - occurrence);
      }),
    );
  });
});
