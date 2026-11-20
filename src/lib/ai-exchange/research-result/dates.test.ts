import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { calendarDate, firstUnsorted, isSorted, readDate } from './dates';

import type { DateReading, DateWarning } from './dates';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

type ReadDate = Extract<DateReading, { ok: true }>;

/** A date read as its date alone. */
const onlyDate = (text: string, on: string): ReadDate => ({
  ok: true,
  text,
  date: { kind: 'date', on },
  warning: undefined,
});

/** A date read as the instant `at`, written in the offset `offsetMinutes`. */
const instant = (text: string, at: number, offsetMinutes: number): ReadDate => ({
  ok: true,
  text,
  date: { kind: 'instant', on: text.slice(0, 10), at, offsetMinutes },
  warning: undefined,
});

const warned = (reading: ReadDate, warning: DateWarning): ReadDate => ({ ...reading, warning });

const refused = (kind: 'malformed' | 'nonexistent', text: string): DateReading => ({
  ok: false,
  error: { kind, text },
});

const two = (value: number): string => String(value).padStart(2, '0');

/** An offset in minutes, written ±HHMM. */
function compactOffset(offsetMinutes: number): string {
  const size = Math.abs(offsetMinutes);
  const sign = offsetMinutes < 0 ? '-' : '+';
  return `${sign}${two(Math.trunc(size / MINUTES_PER_HOUR))}${two(size % MINUTES_PER_HOUR)}`;
}

// The minutes from 0001-01-02T00:00Z to 9999-12-30T23:59Z, as minutes since 1970-01-01, so
// that a local time in any offset stays in the years 0001 to 9999.
const anyMinute = fc.integer({ min: -1_035_591_840, max: 4_223_370_239 });
// Any instant of those minutes but their first millisecond, so that no local time is
// midnight exactly.
const anyInstant = fc
  .tuple(anyMinute, fc.integer({ min: 1, max: MS_PER_MINUTE - 1 }))
  .map(([minute, milliseconds]) => minute * MS_PER_MINUTE + milliseconds);
// The offsets of the zones in use, from UTC-12:00 to UTC+14:00, in minutes.
const anyOffset = fc.integer({ min: -12 * MINUTES_PER_HOUR, max: 14 * MINUTES_PER_HOUR });

describe('readDate', () => {
  it.each([
    ['2021-01-14', onlyDate('2021-01-14', '2021-01-14')],
    ['0050-03-01', onlyDate('0050-03-01', '0050-03-01')],
    [
      '2021-01-14T23:10-05:00',
      instant('2021-01-14T23:10-05:00', Date.UTC(2021, 0, 15, 4, 10), -300),
    ],
    ['2021-01-14T18:30+05:30', instant('2021-01-14T18:30+05:30', Date.UTC(2021, 0, 14, 13), 330)],
    ['2021-01-14T23:59-00:00', instant('2021-01-14T23:59-00:00', Date.UTC(2021, 0, 14, 23, 59), 0)],
  ])(
    '[IMP-12] [CL-IMP-08] reads %s, written as the format writes a date, as written',
    (text, read) => {
      expect(readDate(text)).toStrictEqual(read);
    },
  );

  it.each([
    ['2021-01-14T23:10Z', Date.UTC(2021, 0, 14, 23, 10), 0],
    ['2021-01-14t23:10z', Date.UTC(2021, 0, 14, 23, 10), 0],
    ['2021-01-14 23:10+00:00', Date.UTC(2021, 0, 14, 23, 10), 0],
    ['2021-01-14T23:10-0500', Date.UTC(2021, 0, 15, 4, 10), -300],
    ['2021-01-14T23:10+0530', Date.UTC(2021, 0, 14, 17, 40), 330],
    ['2021-01-14T23:10-05', Date.UTC(2021, 0, 15, 4, 10), -300],
    ['2021-01-14T23:10+14', Date.UTC(2021, 0, 14, 9, 10), 840],
    ['2021-01-14T23:10:45-05:00', Date.UTC(2021, 0, 15, 4, 10, 45), -300],
    ['2021-01-14T23:59:59Z', Date.UTC(2021, 0, 14, 23, 59, 59), 0],
    ['2021-01-14T23:10:45.5Z', Date.UTC(2021, 0, 14, 23, 10, 45, 500), 0],
    ['2021-01-14T23:10:45.123987+01:00', Date.UTC(2021, 0, 14, 22, 10, 45, 123), 60],
    ['2021-01-14T00:00:00.001Z', Date.UTC(2021, 0, 14, 0, 0, 0, 1), 0],
    ['2021-01-14T00:00:00.0001Z', Date.UTC(2021, 0, 14), 0],
    ['2021-01-14T00:00:30Z', Date.UTC(2021, 0, 14, 0, 0, 30), 0],
    ['2021-01-14T00:30Z', Date.UTC(2021, 0, 14, 0, 30), 0],
    ['2021-01-14T01:00Z', Date.UTC(2021, 0, 14, 1), 0],
  ])(
    '[CL-IMP-08] reads %s, a spelling that names one instant without doubt, as that instant, with non_standard_date',
    (text, at, offsetMinutes) => {
      expect(readDate(text)).toStrictEqual(
        warned(instant(text, at, offsetMinutes), 'non_standard_date'),
      );
    },
  );

  it('[CL-IMP-08] reads any instant written with seconds, their fraction and a compact offset as that instant, to the millisecond', () => {
    fc.assert(
      fc.property(anyInstant, anyOffset, (at, offsetMinutes) => {
        const local = new Date(at + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 23);
        const text = `${local}${compactOffset(offsetMinutes)}`;

        expect(readDate(text)).toStrictEqual(
          warned(instant(text, at, offsetMinutes), 'non_standard_date'),
        );
      }),
    );
  });

  it.each([
    '2021-01-14T23:10',
    '2021-01-14 23:10:45.5',
    '2021-01-14t08:00',
    '2021-01-14T00:00+01:00',
    '2021-01-14T00:00Z',
    '2021-01-14 00:00',
    '2021-01-14T00:00:00-05:00',
    '2021-01-14T00:00:00.000+14:00',
  ])(
    '[CL-IMP-08] reads %s, a time without an offset or at midnight exactly, as its date alone, with time_ignored',
    (text) => {
      expect(readDate(text)).toStrictEqual(warned(onlyDate(text, '2021-01-14'), 'time_ignored'));
    },
  );

  it.each([
    '2021-02-30',
    '2100-02-29',
    '2021-13-01',
    '2021-02-30T12:00Z',
    '2021-02-29T00:00Z',
    '2021-02-29T12:00',
    '2021-01-14T24:00Z',
    '2021-01-14T23:60Z',
    '2021-01-14T23:59:60Z',
    '2021-01-14T25:00',
    '2021-01-14T12:00+24',
    '2021-01-14T12:00+0560',
    '2021-01-14T12:00-12:60',
  ])('[IMP-12] [CL-IMP-08] refuses %s, whose day, time or offset cannot exist', (text) => {
    expect(readDate(text)).toStrictEqual(refused('nonexistent', text));
  });

  it.each([
    'March 2, 2021',
    '14/01/2021',
    '01-14-2021',
    '2021/01/14',
    '20210114',
    '2021-1-14',
    '02021-01-14',
    ' 2021-01-14',
    '2021-01-14 ',
    '2021-01-14T',
    '2021-01-14T23',
    '2021-01-14T2310Z',
    '2021-01-14T23:1Z',
    '2021-01-14T23:10:4Z',
    '2021-01-14T23:10:45.Z',
    '2021-01-14T23:10:45,5Z',
    '2021-01-14T23:10+5',
    '2021-01-14T23:10+053',
    '2021-01-14T23:10+05:3',
    '2021-01-14T23:10 Z',
    '2021-01-14  23:10Z',
    '2021-01-14_23:10Z',
    '2021-01-14T23:10ZZ',
    '2021-01-14T23:10GMT',
    'x2021-01-14T23:10Z',
    '2021-01-14T23:105',
    '2021-01-14T23:10Z\nfrom the report',
  ])('[IMP-12] [CL-IMP-08] refuses %s, in no spelling that the import reads', (text) => {
    expect(readDate(text)).toStrictEqual(refused('malformed', text));
  });

  it.each([
    undefined,
    null,
    '',
    ' '.repeat(3),
    20_210_114,
    true,
    ['2021-01-14'],
    { on: '2021-01-14' },
  ])('[CL-IMP-06] reads %j, left out, null, blank or no text, as a missing date', (value) => {
    expect(readDate(value)).toStrictEqual({ ok: false, error: { kind: 'missing' } });
  });
});

describe('calendarDate', () => {
  it.each([
    ['2021-01-14', '2021-01-14'],
    ['2021-01-14T23:10-05:00', '2021-01-14'],
    ['2021-01-14 23:10', '2021-01-14'],
    ['2021-02-30', undefined],
    ['2021-1-14', undefined],
    ['March 2, 2021', undefined],
    [20_210_114, undefined],
    [null, undefined],
  ])(
    '[CL-BKT-15] [CL-IMP-09] gives %j the calendar date %j, its date part as written',
    (value, day) => {
      expect(calendarDate(value)).toBe(day);
    },
  );
});

describe('firstUnsorted', () => {
  it.each([
    [[], undefined],
    [['2021-01-14'], undefined],
    [['2021-01-14', '2021-01-14', '2021-03-02'], undefined],
    [[undefined, '2021-01-14', undefined, '2021-03-02', undefined], undefined],
    [['2021-03-02', '2021-01-14'], 1],
    [['2021-01-14', '2021-03-02', '2021-03-02', '2021-02-01'], 3],
    [[undefined, '2021-03-02', undefined, '2021-01-14'], 3],
    [['2021-03-02', undefined, '2021-04-01', '2021-01-14', '2021-01-01'], 3],
  ])(
    '[CL-BKT-15] [CL-IMP-19] finds in %j, the undefined dates left out, the first date out of order at %j',
    (days, index) => {
      expect(firstUnsorted(days)).toBe(index);
      expect(isSorted(days)).toBe(index === undefined);
    },
  );
});
