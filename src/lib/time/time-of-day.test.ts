import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toIsoDate } from './calendar-date';
import { parseTimeOfDay } from './time-of-day';
import { endOfLocalDay, localOccurrenceInstant, startOfLocalDay, toZoned } from './zones';

const DAY_MS = 86_400_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

const twoDigits = (value: number): string => String(value).padStart(2, '0');
const written = (hour: number, minute: number): string => `${twoDigits(hour)}:${twoDigits(minute)}`;

// Zones of every kind of offset: whole hours with clock changes, half and quarter
// hours, a clock change of half an hour, an offset of 12:45, UTC−12 and UTC.
const ZONES = [
  'Europe/Paris',
  'America/New_York',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Etc/GMT+12',
  'UTC',
];
// Every text of the form HH:MM up to 29:69, of which about two in three are times of day.
const nearlyATime = fc
  .tuple(fc.integer({ min: 0, max: 29 }), fc.integer({ min: 0, max: 69 }))
  .map(([hour, minute]) => written(hour, minute));
const anyDay = fc
  .integer({ min: Date.UTC(1980, 0, 1) / DAY_MS, max: Date.UTC(2099, 11, 31) / DAY_MS })
  .map((dayNumber) => toIsoDate(new Date(dayNumber * DAY_MS).toISOString().slice(0, 10)));

describe('parseTimeOfDay', () => {
  it.each([
    ['00:00', 0, 0],
    ['09:05', 9, 5],
    ['16:30', 16, 30],
    ['23:59', 23, 59],
  ])('[TRV-27] reads %s as hour %d and minute %d', (text, hour, minute) => {
    expect(parseTimeOfDay(text)).toStrictEqual({ ok: true, hour, minute });
  });

  it.each(['24:00', '23:60', '99:99'])(
    '[TRV-27] refuses %s, written HH:MM but shown by no clock, as nonexistent',
    (text) => {
      expect(parseTimeOfDay(text)).toStrictEqual({ ok: false, error: { kind: 'nonexistent' } });
    },
  );

  it.each([
    ['a one-digit hour', '9:05'],
    ['seconds', '16:30:00'],
    ['a dot', '16.30'],
    ['a space in front', ' 16:30'],
    ['a space after', '16:30 '],
    ['a line break after', '16:30\n'],
    ['no colon', '1630'],
    ['an empty text', ''],
    ['a one-digit minute', '16:3'],
    ['a twelve-hour time', '4:30 PM'],
    ['digits of another script', '١٦:٣٠'],
  ])('[TRV-27] refuses %s as malformed: "%s"', (_kind, text) => {
    expect(parseTimeOfDay(text)).toStrictEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it('[TRV-27] accepts exactly the 1,440 minutes of a day among the 10,000 texts written HH:MM, with their hour and minute', () => {
    const texts = Array.from({ length: 10_000 }, (_, index) =>
      written(Math.floor(index / 100), index % 100),
    );
    const minutes = Array.from({ length: MINUTES_PER_DAY }, (_, index) => ({
      hour: Math.floor(index / MINUTES_PER_HOUR),
      minute: index % MINUTES_PER_HOUR,
    }));
    const accepted = texts.filter((text) => parseTimeOfDay(text).ok);

    expect(accepted).toStrictEqual(minutes.map(({ hour, minute }) => written(hour, minute)));
    expect(accepted.map((text) => parseTimeOfDay(text))).toStrictEqual(
      minutes.map((time) => ({ ok: true, ...time })),
    );
  });

  it('[TRV-27] accepts only times that localOccurrenceInstant schedules and reads back unchanged, on a day without a clock change', () => {
    fc.assert(
      fc.property(nearlyATime, anyDay, fc.constantFrom(...ZONES), (text, on, zone) => {
        fc.pre(parseTimeOfDay(text).ok);
        fc.pre(endOfLocalDay(on, zone) - startOfLocalDay(on, zone) === DAY_MS);
        const occurrence = localOccurrenceInstant(on, text, zone);

        expect(toZoned(occurrence, zone)).toStrictEqual({ on, time: text });
      }),
    );
  });

  it('[TRV-27] answers whatever the text, without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(typeof parseTimeOfDay(text).ok).toBe('boolean');
      }),
    );
  });
});
