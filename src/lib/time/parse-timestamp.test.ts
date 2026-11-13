import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toEpochMs } from './instant';
import { parseTimestamp } from './parse-timestamp';

import type { EpochMs } from './instant';

const MINUTE_MS = 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (text: string): EpochMs => toEpochMs(Date.parse(text));
const instant = (on: string, at: EpochMs, offsetMinutes: number): unknown => ({
  ok: true,
  timestamp: { kind: 'instant', on, at, offsetMinutes },
});
const noOffset = (on: string, time: string): unknown => ({
  ok: true,
  timestamp: { kind: 'no_offset', on, time },
});
const refused = (kind: 'malformed' | 'nonexistent'): unknown => ({ ok: false, error: { kind } });

// Every minute from 1900 to 2100, and every offset in quarter hours from −12:00 to +14:00.
const anyMinute = fc
  .integer({ min: Date.UTC(1900, 0, 1) / MINUTE_MS, max: Date.UTC(2100, 0, 1) / MINUTE_MS })
  .map((minute) => toEpochMs(minute * MINUTE_MS));
const anyOffset = fc.integer({ min: -48, max: 56 }).map((quarters) => quarters * 15);

type Written = Readonly<{ on: string; iso: string; rfc: string }>;

/** `at` as the clock of `offsetMinutes` reads it: its date, then in ISO 8601 and RFC 2822. */
function written(at: EpochMs, offsetMinutes: number): Written {
  const wallClock = new Date(at + offsetMinutes * MINUTE_MS);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  const [on = '', time = ''] = wallClock.toISOString().slice(0, 19).split('T', 2);
  const month = MONTHS[wallClock.getUTCMonth()] ?? '';
  const date = `${String(wallClock.getUTCDate())} ${month} ${String(wallClock.getUTCFullYear())}`;
  return {
    on,
    iso: `${on}T${time}${sign}${hours}:${minutes}`,
    rfc: `${date} ${time} ${sign}${hours}${minutes}`,
  };
}

describe('parseTimestamp', () => {
  describe('ISO 8601', () => {
    it.each([
      {
        text: '2026-11-10T19:30:00-05:00',
        on: '2026-11-10',
        at: '2026-11-11T00:30:00Z',
        offset: -300,
      },
      { text: '2026-11-11T00:30:00Z', on: '2026-11-11', at: '2026-11-11T00:30:00Z', offset: 0 },
      { text: '2026-11-11t01:30+01:00', on: '2026-11-11', at: '2026-11-11T00:30:00Z', offset: 60 },
      {
        text: '2026-11-11 01:30:00+0100',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00Z',
        offset: 60,
      },
      { text: '2026-11-11T01:30:00+01', on: '2026-11-11', at: '2026-11-11T00:30:00Z', offset: 60 },
      {
        text: '2026-11-11T14:30:00+14:00',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00Z',
        offset: 840,
      },
      {
        text: '2026-11-11T06:00:00.5+05:30',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00.500Z',
        offset: 330,
      },
      {
        text: '2026-11-11T00:30:00,123456789z',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00.123Z',
        offset: 0,
      },
      {
        text: '2026-11-10T19:30:00-00:00',
        on: '2026-11-10',
        at: '2026-11-10T19:30:00Z',
        offset: 0,
      },
      { text: '  2026-11-11T00:30:00Z\n', on: '2026-11-11', at: '2026-11-11T00:30:00Z', offset: 0 },
    ])(
      'reads "$text" as the instant of $on at $at, with its offset of $offset minutes',
      ({ text, on, at, offset }) => {
        expect(parseTimestamp(text)).toStrictEqual(instant(on, utc(at), offset));
      },
    );

    it('reads a date alone as a date, with no time', () => {
      expect(parseTimestamp('2026-11-10')).toStrictEqual({
        ok: true,
        timestamp: { kind: 'date', on: '2026-11-10' },
      });
    });

    it.each([
      ['2026-11-10T19:30', '2026-11-10', '19:30:00'],
      ['2026-11-10 19:30:15.25', '2026-11-10', '19:30:15.25'],
    ])(
      'never guesses the offset of "%s": its wall clock comes back as written',
      (text, on, time) => {
        expect(parseTimestamp(text)).toStrictEqual(noOffset(on, time));
      },
    );

    it('reads back every instant written with any offset', () => {
      fc.assert(
        fc.property(anyMinute, anyOffset, (at, offsetMinutes) => {
          const { on, iso } = written(at, offsetMinutes);

          expect(parseTimestamp(iso)).toStrictEqual(instant(on, at, offsetMinutes));
        }),
      );
    });
  });

  describe('RFC 822 and RFC 2822, as in RSS feeds', () => {
    it.each([
      {
        text: 'Tue, 10 Nov 2026 19:30:00 -0500',
        on: '2026-11-10',
        at: '2026-11-11T00:30:00Z',
        offset: -300,
      },
      {
        text: 'Wed, 11 Nov 2026 00:30:00 GMT',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00Z',
        offset: 0,
      },
      {
        text: 'Tue, 10 Nov 2026 19:30:00 EST',
        on: '2026-11-10',
        at: '2026-11-11T00:30:00Z',
        offset: -300,
      },
      {
        text: 'Tue, 3 Nov 2026 18:30:00 CST',
        on: '2026-11-03',
        at: '2026-11-04T00:30:00Z',
        offset: -360,
      },
      {
        text: 'Tue, 10 Nov 2026 16:30:00 PST',
        on: '2026-11-10',
        at: '2026-11-11T00:30:00Z',
        offset: -480,
      },
      {
        text: 'Sat, 4 Jul 2026 19:00:00 EDT',
        on: '2026-07-04',
        at: '2026-07-04T23:00:00Z',
        offset: -240,
      },
      { text: '11 Nov 2026 01:30 +0100', on: '2026-11-11', at: '2026-11-11T00:30:00Z', offset: 60 },
      {
        text: 'Wed, 11 Nov 26 00:30:00 UT',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00Z',
        offset: 0,
      },
      {
        text: 'Fri, 10 Nov 95 19:30:00 Z',
        on: '1995-11-10',
        at: '1995-11-10T19:30:00Z',
        offset: 0,
      },
      {
        text: 'wed, 11 nov 2026 00:30:00 gmt',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00Z',
        offset: 0,
      },
      {
        text: 'Wed,  11 Nov 2026  01:30:00 +0100 (CET)',
        on: '2026-11-11',
        at: '2026-11-11T00:30:00Z',
        offset: 60,
      },
    ])(
      'reads "$text" as the instant of $on at $at, with its offset of $offset minutes',
      ({ text, on, at, offset }) => {
        expect(parseTimestamp(text)).toStrictEqual(instant(on, utc(at), offset));
      },
    );

    it.each([
      'Tue, 10 Nov 2026 19:30:00',
      'Tue, 10 Nov 2026 19:30:00 CET',
      'Tue, 10 Nov 2026 19:30:00 R',
    ])('never guesses an offset that "%s" does not give reliably', (text) => {
      expect(parseTimestamp(text)).toStrictEqual(noOffset('2026-11-10', '19:30:00'));
    });

    it('reads back every instant written with any numeric zone', () => {
      fc.assert(
        fc.property(anyMinute, anyOffset, (at, offsetMinutes) => {
          const { on, rfc } = written(at, offsetMinutes);

          expect(parseTimestamp(rfc)).toStrictEqual(instant(on, at, offsetMinutes));
        }),
      );
    });
  });

  it.each([
    '2026-02-29',
    '2026-02-30T10:00:00Z',
    '2026-11-10T24:00:00Z',
    '2026-11-10T19:60:00Z',
    '2026-11-10T19:30:60Z',
    '2026-11-10T19:30:00+24:00',
    '2026-11-10T19:30:00+05:60',
    '31 Feb 2026 10:00:00 GMT',
    'Tue, 10 Nov 2026 25:00:00 GMT',
    'Tue, 10 Nov 2026 19:30:00 +2400',
  ])('refuses "%s", whose day, time or offset does not exist', (text) => {
    expect(parseTimestamp(text)).toStrictEqual(refused('nonexistent'));
  });

  it.each([
    '',
    'yesterday',
    '10/11/2026',
    '2026-11-10T19',
    '2026-11-10T19:30:00 -05:00',
    '2026-11-10T19:30:00+5',
    '20261110T193000Z',
    'Tue, 10 Foo 2026 19:30:00 GMT',
    'Tue, 10 Nov 2026 19:30:00 -05:00',
    'Tue, 10 Nov 2026',
  ])('refuses "%s", which is in none of the accepted forms', (text) => {
    expect(parseTimestamp(text)).toStrictEqual(refused('malformed'));
  });
});
