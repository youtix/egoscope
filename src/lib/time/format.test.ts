import { Temporal } from 'temporal-polyfill';
import { describe, expect, it, vi } from 'vitest';

import { toIsoDate } from './calendar-date';
import {
  formatDate,
  formatGameTime,
  formatInstant,
  formatZoneName,
  formatZoneStatement,
} from './format';
import { toEpochMs } from './instant';
import { gameDayStart, localOccurrenceInstant } from './zones';

import type { TipOff } from './format';
import type { EpochMs } from './instant';

const PARIS = 'Europe/Paris';
const NEW_YORK = 'America/New_York';
const LOS_ANGELES = 'America/Los_Angeles';

const utc = (text: string): EpochMs => toEpochMs(Date.parse(text));
const day = toIsoDate;
const timed = (on: string, time: string, zone: string): TipOff => ({
  scheduledStartAt: localOccurrenceInstant(day(on), time, zone),
  isStartTimeTbd: false,
});

describe('formatGameTime', () => {
  it('[TRV-71] [TRV-72] [CA-TRV-36] shows a 19:30 Los Angeles game of Tuesday 10 November 2026 at 04:30 Paris time, with its US day', () => {
    expect(formatGameTime(timed('2026-11-10', '19:30', LOS_ANGELES), PARIS, 'full')).toBe(
      'Wednesday 11 November 2026, 04:30 Paris time — Tuesday evening in the US',
    );
  });

  it('[TRV-71] [CA-IHM-15] shows a 19:30 New York game of Tuesday 17 November 2026 at 01:30 on the Wednesday, with its US day', () => {
    const game = timed('2026-11-17', '19:30', NEW_YORK);

    expect(formatGameTime(game, PARIS, 'short')).toBe(
      'Wed 18 Nov 2026, 01:30 — Tuesday evening in the US',
    );
    expect(formatGameTime(game, PARIS, 'full')).toBe(
      'Wednesday 18 November 2026, 01:30 Paris time — Tuesday evening in the US',
    );
  });

  it.each([
    [PARIS, 'Wed 11 Nov 2026, 01:30 — Tuesday evening in the US'],
    ['Asia/Tokyo', 'Wed 11 Nov 2026, 09:30 — Tuesday evening in the US'],
    [NEW_YORK, 'Tue 10 Nov 2026, 19:30'],
    [LOS_ANGELES, 'Tue 10 Nov 2026, 16:30'],
  ])(
    '[TRV-71] [TRV-72] shows a 19:30 New York game of 10 November 2026 to an owner in %s as "%s"',
    (zone, shown) => {
      expect(formatGameTime(timed('2026-11-10', '19:30', NEW_YORK), zone, 'short')).toBe(shown);
    },
  );

  it.each([
    ['11:59', 'Wed 11 Nov 2026, 01:59 — Tuesday morning in the US'],
    ['12:00', 'Wed 11 Nov 2026, 02:00 — Tuesday afternoon in the US'],
    ['16:59', 'Wed 11 Nov 2026, 06:59 — Tuesday afternoon in the US'],
    ['17:00', 'Wed 11 Nov 2026, 07:00 — Tuesday evening in the US'],
  ])('[TRV-71] names the part of day of a %s New York start: "%s" in Tokyo', (time, shown) => {
    expect(formatGameTime(timed('2026-11-10', time, NEW_YORK), 'Asia/Tokyo', 'short')).toBe(shown);
  });

  it('[TRV-71] recalls a US day later than the owner’s, for an owner west of New York', () => {
    expect(
      formatGameTime(timed('2026-11-11', '00:30', NEW_YORK), 'Pacific/Pago_Pago', 'short'),
    ).toBe('Tue 10 Nov 2026, 18:30 — Wednesday morning in the US');
  });

  it('[TRV-71] [TRV-72] shows a game played in Europe in the owner’s zone, with its New York day when that differs', () => {
    const inParis = timed('2026-01-22', '20:00', PARIS);

    expect(formatGameTime(inParis, PARIS, 'short')).toBe('Thu 22 Jan 2026, 20:00');
    expect(formatGameTime(inParis, 'Asia/Tokyo', 'short')).toBe(
      'Fri 23 Jan 2026, 04:00 — Thursday afternoon in the US',
    );
  });

  it.each([
    [PARIS, 'short', 'Wed 18 Nov 2026, time TBD'],
    [LOS_ANGELES, 'short', 'Wed 18 Nov 2026, time TBD'],
    ['Asia/Tokyo', 'full', 'Wednesday 18 November 2026, time TBD'],
  ] as const)(
    '[TRV-71] [TRV-72] shows a game of 18 November 2026 whose time is to be determined to an owner in %s with its day and "time TBD", never 00:00',
    (zone, form, shown) => {
      const tbd: TipOff = {
        scheduledStartAt: gameDayStart(day('2026-11-18')),
        isStartTimeTbd: true,
      };

      expect(formatGameTime(tbd, zone, form)).toBe(shown);
    },
  );
});

describe('formatInstant', () => {
  it.each([
    ['2026-11-18T00:30:00Z', PARIS, 'Wednesday 18 November 2026, 01:30 Paris time'],
    ['2026-11-11T04:10:00Z', PARIS, 'Wednesday 11 November 2026, 05:10 Paris time'],
    ['2026-11-01T05:30:00Z', NEW_YORK, 'Sunday 1 November 2026, 01:30 New York time'],
    ['2026-12-31T23:30:00Z', PARIS, 'Friday 1 January 2027, 00:30 Paris time'],
    ['2028-02-29T22:59:00Z', PARIS, 'Tuesday 29 February 2028, 23:59 Paris time'],
  ])('[TRV-71] shows %s in %s as "%s", naming the zone in the full form', (at, zone, shown) => {
    expect(formatInstant(utc(at), zone, 'full')).toBe(shown);
  });

  it.each([
    ['2026-11-18T00:30:00Z', PARIS, 'Wed 18 Nov 2026, 01:30'],
    ['2026-07-04T23:00:00Z', NEW_YORK, 'Sat 4 Jul 2026, 19:00'],
    ['2026-09-30T22:00:00Z', PARIS, 'Thu 1 Oct 2026, 00:00'],
  ])(
    '[TRV-71] shows %s in %s as "%s" in the short form, under the zone statement',
    (at, zone, shown) => {
      expect(formatInstant(utc(at), zone, 'short')).toBe(shown);
    },
  );
});

describe('formatDate', () => {
  it.each([
    ['2026-01-05', 'Mon 5 Jan 2026', 'Monday 5 January 2026'],
    ['2026-02-10', 'Tue 10 Feb 2026', 'Tuesday 10 February 2026'],
    ['2026-03-11', 'Wed 11 Mar 2026', 'Wednesday 11 March 2026'],
    ['2026-04-16', 'Thu 16 Apr 2026', 'Thursday 16 April 2026'],
    ['2026-05-22', 'Fri 22 May 2026', 'Friday 22 May 2026'],
    ['2026-06-27', 'Sat 27 Jun 2026', 'Saturday 27 June 2026'],
    ['2026-07-05', 'Sun 5 Jul 2026', 'Sunday 5 July 2026'],
    ['2026-08-03', 'Mon 3 Aug 2026', 'Monday 3 August 2026'],
    ['2026-09-08', 'Tue 8 Sep 2026', 'Tuesday 8 September 2026'],
    ['2026-10-14', 'Wed 14 Oct 2026', 'Wednesday 14 October 2026'],
    ['2026-11-18', 'Wed 18 Nov 2026', 'Wednesday 18 November 2026'],
    ['2026-12-31', 'Thu 31 Dec 2026', 'Thursday 31 December 2026'],
    ['2028-02-29', 'Tue 29 Feb 2028', 'Tuesday 29 February 2028'],
  ])('shows %s as "%s", or "%s" in full, without a time or a zone', (on, short, full) => {
    expect(formatDate(day(on), 'short')).toBe(short);
    expect(formatDate(day(on), 'full')).toBe(full);
  });

  it('shows a date in the short form when no form is given', () => {
    expect(formatDate(day('2026-11-18'))).toBe('Wed 18 Nov 2026');
  });

  it('refuses to show a weekday that the calendar does not have', () => {
    vi.spyOn(Temporal.PlainDate.prototype, 'dayOfWeek', 'get').mockReturnValue(8);

    expect(() => formatDate(day('2026-11-18'), 'short')).toThrow('No name at position 8.');
  });
});

describe('the zone', () => {
  it.each([
    [PARIS, 'Paris time'],
    [NEW_YORK, 'New York time'],
    ['America/Argentina/Buenos_Aires', 'Buenos Aires time'],
    ['europe/paris', 'Paris time'],
    ['UTC', 'UTC time'],
  ])('[TRV-71] names %s "%s"', (zone, name) => {
    expect(formatZoneName(zone)).toBe(name);
  });

  it('[TRV-71] states the zone of a screen that shows times in the short form', () => {
    expect(formatZoneStatement(PARIS)).toBe('Times in Paris time');
  });

  it('throws for a zone that does not exist, which validating the setting rules out', () => {
    expect(() => formatZoneName('Mars/Olympus')).toThrow(RangeError);
  });
});
