import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalValue, isAbsent, parseExchangeDate } from './conventions';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const DAY_MS = 86_400_000;

// Every day from 0001-01-01 to 9999-12-31, as days since 1970-01-01.
const anyDayNumber = fc.integer({ min: -719_162, max: 2_932_896 });
// The same days but the first and the last, so that a local time in any offset stays in
// the years 0001 to 9999.
const anyInnerDayNumber = fc.integer({ min: -719_161, max: 2_932_895 });
// The offsets of the zones in use, from UTC-12:00 to UTC+14:00, in minutes.
const anyOffset = fc.integer({ min: -12 * MINUTES_PER_HOUR, max: 14 * MINUTES_PER_HOUR });

const two = (value: number): string => String(value).padStart(2, '0');

/** `at`, in whole minutes, written YYYY-MM-DDTHH:MM±HH:MM in the offset `offsetMinutes`. */
function writtenInOffset(at: number, offsetMinutes: number): string {
  const local = new Date(at + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 16);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const size = Math.abs(offsetMinutes);
  return `${local}${sign}${two(Math.trunc(size / MINUTES_PER_HOUR))}:${two(size % MINUTES_PER_HOUR)}`;
}

describe('parseExchangeDate', () => {
  it.each(['2021-03-05', '2024-02-29', '2000-02-29', '0020-01-01', '9999-12-31'])(
    '[IMP-12] reads %s as a date',
    (text) => {
      expect(parseExchangeDate(text)).toStrictEqual({ ok: true, date: { kind: 'date', on: text } });
    },
  );

  it.each([
    ['2021-01-14T18:30-05:00', Date.UTC(2021, 0, 14, 23, 30), -300],
    ['2021-01-14T23:30+05:30', Date.UTC(2021, 0, 14, 18, 0), 330],
    ['2021-01-14T00:00+00:00', Date.UTC(2021, 0, 14), 0],
    ['2021-01-14T23:59-00:00', Date.UTC(2021, 0, 14, 23, 59), 0],
    ['2020-12-31T23:30-23:59', Date.UTC(2021, 0, 1, 23, 29), -1439],
    ['2021-01-01T00:15+14:00', Date.UTC(2020, 11, 31, 10, 15), 840],
  ])(
    '[IMP-12] reads %s as the instant it names, with its date as written and its offset',
    (text, at, offsetMinutes) => {
      const date = { kind: 'instant', on: text.slice(0, 10), at, offsetMinutes };

      expect(parseExchangeDate(text)).toStrictEqual({ ok: true, date });
    },
  );

  it.each([
    '2021-02-30',
    '2100-02-29',
    '2021-04-31',
    '2021-13-01',
    '2021-00-10',
    '2021-01-00',
    '2021-02-30T12:00+00:00',
    '2021-01-14T24:00+00:00',
    '2021-01-14T12:60+00:00',
    '2021-01-14T12:00+24:00',
    '2021-01-14T12:00-05:60',
  ])('[IMP-12] refuses %s as a day, time or offset that does not exist', (text) => {
    expect(parseExchangeDate(text)).toStrictEqual({ ok: false, error: { kind: 'nonexistent' } });
  });

  it.each([
    '',
    '2021-3-5',
    '2021/03/05',
    '05-03-2021',
    '20210305',
    '+02021-03-05',
    ' 2021-03-05',
    '2021-03-05 ',
    'March 5, 2021',
    '2021-03-05T10:00',
    ' 2021-03-05T10:00+01:00',
    '2021-03-05T10:00+01:00 ',
    '2021-03-05T10:00Z',
    '2021-03-05T10:00:00+01:00',
    '2021-03-05 10:00+01:00',
    '2021-03-05t10:00+01:00',
    '2021-03-05T10:00+0100',
    '2021-03-05T10:00+01',
    '2021-03-05T1000+01:00',
  ])('[IMP-12] refuses "%s", written in neither form of the formats, as malformed', (text) => {
    expect(parseExchangeDate(text)).toStrictEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it('[IMP-12] reads back every day that the calendar has', () => {
    fc.assert(
      fc.property(anyDayNumber, (dayNumber) => {
        const on = new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

        expect(parseExchangeDate(on)).toStrictEqual({ ok: true, date: { kind: 'date', on } });
      }),
    );
  });

  it('[IMP-12] reads back every instant written in any offset, whole minutes', () => {
    fc.assert(
      fc.property(
        anyInnerDayNumber,
        fc.nat(1439),
        anyOffset,
        (dayNumber, minute, offsetMinutes) => {
          const at = dayNumber * DAY_MS + minute * MS_PER_MINUTE;
          const text = writtenInOffset(at, offsetMinutes);
          const date = { kind: 'instant', on: text.slice(0, 10), at, offsetMinutes };

          expect(parseExchangeDate(text)).toStrictEqual({ ok: true, date });
        },
      ),
    );
  });
});

describe('canonicalValue', () => {
  const CONFIDENCES = ['high', 'medium', 'low'] as const;

  it.each([
    ['high', 'high'],
    [' High ', 'high'],
    ['HIGH', 'high'],
    ['hígh', 'high'],
    ['\tMédium\n', 'medium'],
  ])('[IMP-15] reads %j as the canonical value %s', (read, canonical) => {
    expect(canonicalValue(read, CONFIDENCES)).toBe(canonical);
  });

  it('[IMP-11] gives back the canonical spelling, never the one read', () => {
    expect(canonicalValue(' req-2026-0007', ['REQ-2026-0007'])).toBe('REQ-2026-0007');
    expect(canonicalValue('Public-Humiliation', ['public-humiliation'])).toBe('public-humiliation');
  });

  it.each([
    ['an underscore for a hyphen', 'public_humiliation'],
    ['an inner space', 'public -humiliation'],
    ['a dotless i, which only looks like an i', 'publıc-humiliation'],
    ['another value', 'public-humiliation-2'],
  ])('[IMP-11] tells apart a value with %s', (_difference, read) => {
    expect(canonicalValue(read, ['public-humiliation'])).toBeUndefined();
  });

  it.each([1, true, null, undefined, ['high'], { high: true }])(
    '[IMP-15] finds no value in %j, which is no text',
    (read) => {
      expect(canonicalValue(read, CONFIDENCES)).toBeUndefined();
    },
  );
});

describe('isAbsent', () => {
  it.each([undefined, null, '', ' '.repeat(3), '\n\t'])('takes %j for an absent field', (value) => {
    expect(isAbsent(value)).toBe(true);
  });

  it.each(['x', ' x ', 0, false, [], {}])('takes %j for a present field', (value) => {
    expect(isAbsent(value)).toBe(false);
  });
});
