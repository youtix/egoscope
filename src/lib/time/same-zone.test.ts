import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it, vi } from 'vitest';

import { toEpochMs } from './instant';
import { isSameTimeZone } from './same-zone';
import { isTimeZone, toZoned } from './zones';

import type { EpochMs } from './instant';

const PARIS = 'Europe/Paris';
const BERLIN = 'Europe/Berlin';

const utc = (text: string): EpochMs => toEpochMs(Date.parse(text));

describe('isSameTimeZone', () => {
  const listedZones = Intl.supportedValuesOf('timeZone');
  // A zone that the runtime lists, typed in a random mix of letter cases.
  const anyTypedZone = fc
    .constantFrom(...listedZones)
    .chain((zone) => fc.mixedCase(fc.constant(zone)));

  it.each([
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['UTC', 'Etc/UTC'],
    ['europe/paris', PARIS],
    ['US/Pacific', 'America/Los_Angeles'],
    ['ASIA/KOLKATA', 'asia/calcutta'],
  ])('[IHM-14] finds %s and %s one zone, in either order', (first, second) => {
    expect(isSameTimeZone(first, second)).toBe(true);
    expect(isSameTimeZone(second, first)).toBe(true);
  });

  it('[IHM-14] tells Europe/Paris from Europe/Berlin, two zones whose clocks read alike today but not in July 1979', () => {
    const today = utc('2026-11-18T12:00:00Z');
    const summer1979 = utc('1979-07-01T12:00:00Z');

    expect(toZoned(today, PARIS)).toStrictEqual(toZoned(today, BERLIN));
    expect([toZoned(summer1979, PARIS).time, toZoned(summer1979, BERLIN).time]).toStrictEqual([
      '14:00',
      '13:00',
    ]);
    expect(isSameTimeZone(PARIS, BERLIN)).toBe(false);
    expect(isSameTimeZone(BERLIN, PARIS)).toBe(false);
  });

  it.each([
    ['an empty name', ''],
    ['a city without its area', 'Paris'],
    ['a zone that the database does not have', 'Europe/Atlantis'],
    ['an offset', '+02:00'],
    ['a date and time that names a zone', '2026-11-10T19:30[Europe/Paris]'],
    ['a name with a space in front', ' Europe/Paris'],
    ['a SystemV name, which only ICU still knows', 'SystemV/EST5'],
  ])('[IHM-14] finds no zone in %s, "%s", not even given twice', (_kind, value) => {
    expect(isSameTimeZone(value, value)).toBe(false);
    expect(isSameTimeZone(value, PARIS)).toBe(false);
    expect(isSameTimeZone(PARIS, value)).toBe(false);
  });

  it.each([
    ['EST5EDT', 'America/New_York'],
    ['CST6CDT', 'America/Chicago'],
    ['MST7MDT', 'America/Denver'],
    ['PST8PDT', 'America/Los_Angeles'],
  ])(
    '[IHM-14] tells %s, a name of POSIX rules, from %s, even where Temporal makes them one zone as Bun does',
    (posix, city) => {
      expect(isSameTimeZone(posix, city)).toBe(false);

      vi.spyOn(Temporal.ZonedDateTime.prototype, 'equals').mockReturnValue(true);

      expect(isSameTimeZone(posix, city)).toBe(false);
      expect(isSameTimeZone(city, posix)).toBe(false);
      expect(isSameTimeZone(posix.toLowerCase(), posix)).toBe(true);
    },
  );

  it('[IHM-14] finds each zone that the runtime lists one zone with itself in any letter case, and with no other zone it lists', () => {
    const others = (zone: string): string[] =>
      listedZones.filter((other) => other !== zone && isSameTimeZone(zone, other));

    expect(listedZones.filter((zone) => !isSameTimeZone(zone.toUpperCase(), zone))).toStrictEqual(
      [],
    );
    expect(listedZones.filter((zone) => others(zone).length > 0)).toStrictEqual([]);
  });

  it('[IHM-14] finds one zone only between two names that isTimeZone accepts, without throwing', () => {
    fc.assert(
      fc.property(fc.string(), anyTypedZone, (text, typed) => {
        fc.pre(!isTimeZone(text));

        expect(isSameTimeZone(text, typed)).toBe(false);
        expect(isSameTimeZone(typed, text)).toBe(false);
        expect(isSameTimeZone(text, text)).toBe(false);
      }),
    );
  });
});
