import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { localOccurrenceInstant, toEpochMs, toIsoDate, toZoned } from '@/lib/time';

import {
  capDecision,
  catchUpDueAt,
  digestLines,
  groupPass,
  isCountedTowardCap,
  isUrgent,
  nextAttempt,
  quietPeriodAt,
  releaseAt,
} from './restraint';

import type { NotificationMessageRow } from './types';
import type { TimeRange } from '@/lib/params';
import type { EpochMs } from '@/lib/time';

type Kind = NotificationMessageRow['kind'];
type FactKind = Parameters<typeof digestLines>[0][number]['kind'];
type Fact = Readonly<{
  id: number;
  kind: FactKind;
  tipOff: EpochMs | undefined;
  createdAt: EpochMs;
}>;
type Message = Readonly<{ id: number; kind: Kind; isUrgent: boolean }>;

const PARIS = 'Europe/Paris';
const NEW_YORK = 'America/New_York';
const UTC = 'UTC';
const NIGHT: TimeRange = { start: '23:00', end: '08:00' };
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const SCAN_HOURS = 26;
const AROUND_CHANGE_MINUTES = 48 * 60;
const ALERT_THRESHOLD = 3;
const MAX_DETAILED = 10;
const MOST_DETAILED = 50;
const DAILY_CAP = 20;
const RETRY_INTERVALS = [1, 5, 15, 30, 60];
const CATCH_UP_MINUTES = 60;

function at(day: string, time: string, zone = PARIS): EpochMs {
  return localOccurrenceInstant(toIsoDate(day), time, zone);
}

function plusMinutes(instant: EpochMs, minutes: number): EpochMs {
  return toEpochMs(instant + minutes * MS_PER_MINUTE);
}

function changes(zone: string, days: readonly string[]): { zone: string; day: string }[] {
  return days.map((day) => ({ zone, day }));
}

function isWallClockInside(instant: EpochMs, range: TimeRange, zone: string): boolean {
  const { time } = toZoned(instant, zone);
  return range.start < range.end
    ? range.start <= time && time < range.end
    : range.start <= time || time < range.end;
}

/** The first whole hour after `instant` whose wall clock reads the end or jumps over it. */
function firstEndAfter(instant: EpochMs, range: TimeRange, zone: string): EpochMs | undefined {
  const firstHour = instant - (instant % MS_PER_HOUR) + MS_PER_HOUR;
  const hours = Array.from({ length: SCAN_HOURS }, (_, index) =>
    toEpochMs(firstHour + index * MS_PER_HOUR),
  );
  return hours.find((hour) => {
    const before = toZoned(toEpochMs(hour - MS_PER_HOUR), zone).time;
    const { time } = toZoned(hour, zone);
    return time === range.end || (before < range.end && range.end < time);
  });
}

function message(id: number, kind: Kind, isUrgentMessage = false): Message {
  return { id, kind, isUrgent: isUrgentMessage };
}

function ids(items: readonly Readonly<{ id: number }>[]): number[] {
  return items.map(({ id }) => id);
}

const FACT_BASE = at('2026-01-15', '09:00');

function fact(
  id: number,
  kind: FactKind,
  timing: Readonly<{ tipOff?: string | undefined; createdMinute?: number }> = {},
): Fact {
  return {
    id,
    kind,
    tipOff: timing.tipOff === undefined ? undefined : at('2026-01-16', timing.tipOff),
    createdAt: plusMinutes(FACT_BASE, timing.createdMinute ?? 0),
  };
}

describe('quietPeriodAt', () => {
  it('[TEL-20] [CL-TEL-22] holds 23:00, excludes 08:00 and reads a range across midnight as one period', () => {
    const period = { start: at('2026-01-14', '23:00'), end: at('2026-01-15', '08:00') };
    expect(quietPeriodAt(at('2026-01-14', '23:00'), NIGHT, PARIS)).toStrictEqual(period);
    expect(quietPeriodAt(at('2026-01-15', '02:00'), NIGHT, PARIS)).toStrictEqual(period);
    expect(quietPeriodAt(at('2026-01-15', '07:59'), NIGHT, PARIS)).toStrictEqual(period);
    expect(quietPeriodAt(at('2026-01-14', '22:59'), NIGHT, PARIS)).toBeUndefined();
    expect(quietPeriodAt(at('2026-01-15', '08:00'), NIGHT, PARIS)).toBeUndefined();
  });

  it('[TEL-20] reads a range within one day from its start to its end only', () => {
    const afternoon: TimeRange = { start: '13:00', end: '15:00' };
    expect(quietPeriodAt(at('2026-01-14', '14:00'), afternoon, PARIS)).toStrictEqual({
      start: at('2026-01-14', '13:00'),
      end: at('2026-01-14', '15:00'),
    });
    expect(quietPeriodAt(at('2026-01-14', '10:00'), afternoon, PARIS)).toBeUndefined();
    expect(quietPeriodAt(at('2026-01-14', '16:00'), afternoon, PARIS)).toBeUndefined();
  });

  it('[TEL-20] has no quiet hours when the start equals the end', () => {
    const none: TimeRange = { start: '23:00', end: '23:00' };
    expect(quietPeriodAt(at('2026-01-14', '23:00'), none, PARIS)).toBeUndefined();
    expect(quietPeriodAt(at('2026-01-15', '03:00'), none, PARIS)).toBeUndefined();
  });

  it('[TEL-20] reads the range in the zone of the owner', () => {
    expect(quietPeriodAt(at('2026-01-15', '03:00', UTC), NIGHT, NEW_YORK)).toBeUndefined();
    expect(quietPeriodAt(at('2026-01-15', '05:00', UTC), NIGHT, NEW_YORK)).toStrictEqual({
      start: at('2026-01-15', '04:00', UTC),
      end: at('2026-01-15', '13:00', UTC),
    });
  });

  it('[TEL-20] [TRV-70] lasts 8 hours on the night clocks go forward and 10 on the night they go back', () => {
    expect(quietPeriodAt(at('2026-03-29', '01:00'), NIGHT, PARIS)).toStrictEqual({
      start: at('2026-03-28', '22:00', UTC),
      end: at('2026-03-29', '06:00', UTC),
    });
    expect(quietPeriodAt(at('2026-10-25', '01:00'), NIGHT, PARIS)).toStrictEqual({
      start: at('2026-10-24', '21:00', UTC),
      end: at('2026-10-25', '07:00', UTC),
    });
  });

  it('[TEL-20] [TRV-70] ends at the end of the gap when the clock change skips the end', () => {
    const range: TimeRange = { start: '22:00', end: '02:30' };
    expect(quietPeriodAt(at('2026-03-08', '06:00', UTC), range, NEW_YORK)).toStrictEqual({
      start: at('2026-03-08', '03:00', UTC),
      end: at('2026-03-08', '07:00', UTC),
    });
  });

  // Zones whose offsets and clock changes are whole hours, each with the dates of its 2026
  // changes, so that a range of whole hours can be checked against the wall clock.
  const zonesAndChanges = fc.constantFrom(
    ...changes(PARIS, ['2026-03-29', '2026-10-25']),
    ...changes('Europe/London', ['2026-03-29', '2026-10-25']),
    ...changes(NEW_YORK, ['2026-03-08', '2026-11-01']),
    ...changes('America/Los_Angeles', ['2026-03-08', '2026-11-01']),
    ...changes('Australia/Sydney', ['2026-04-05', '2026-10-04']),
    ...changes('Pacific/Auckland', ['2026-04-05', '2026-09-27']),
    ...changes('Asia/Tokyo', ['2026-06-15']),
    ...changes(UTC, ['2026-06-15']),
  );
  const wholeHour = fc
    .integer({ min: 0, max: HOURS_PER_DAY - 1 })
    .map((hour) => `${String(hour).padStart(2, '0')}:00`);
  const drawn = fc
    .record({
      place: zonesAndChanges,
      start: wholeHour,
      end: wholeHour,
      offsetMinutes: fc.integer({ min: -AROUND_CHANGE_MINUTES, max: AROUND_CHANGE_MINUTES }),
    })
    .filter(({ start, end }) => start !== end)
    .map(({ place, start, end, offsetMinutes }) => ({
      zone: place.zone,
      range: { start, end },
      instant: plusMinutes(at(place.day, '00:00', UTC), offsetMinutes),
    }));

  it('[TEL-20] [TRV-70] holds exactly the instants whose wall clock is in the range, around clock changes', () => {
    fc.assert(
      fc.property(drawn, ({ zone, range, instant }) => {
        const period = quietPeriodAt(instant, range, zone);
        expect(period !== undefined).toBe(isWallClockInside(instant, range, zone));
      }),
    );
  });

  it('[TEL-20] [TRV-70] ends at the first instant whose wall clock reaches the end, around clock changes', () => {
    fc.assert(
      fc.property(
        drawn.filter(({ zone, range, instant }) => isWallClockInside(instant, range, zone)),
        ({ zone, range, instant }) => {
          const period = quietPeriodAt(instant, range, zone);
          expect(period?.end).toBe(firstEndAfter(instant, range, zone));
          expect(period?.start).toBeLessThanOrEqual(instant);
        },
      ),
    );
  });
});

describe('releaseAt', () => {
  it('[TEL-20] [CA-TEL-06] holds a message produced at 06:00 until 08:00 and lets one go at once outside quiet hours', () => {
    expect(releaseAt(at('2026-01-15', '06:00'), NIGHT, PARIS)).toBe(at('2026-01-15', '08:00'));
    expect(releaseAt(at('2026-01-15', '09:15'), NIGHT, PARIS)).toBe(at('2026-01-15', '09:15'));
  });
});

describe('isUrgent', () => {
  const lateEvening = { at: at('2026-01-14', '23:30'), quietHours: NIGHT, zone: PARIS };
  const on = { ...lateEvening, urgentException: true };
  const alert = { kind: 'alert', tipOff: at('2026-01-15', '01:30'), isLate: false } as const;

  it('[TEL-21] [CA-TEL-07] makes urgent at 23:30 an alert about a game at 01:30', () => {
    expect(isUrgent(alert, on)).toBe(true);
  });

  it('[TEL-21] [CA-TEL-08] keeps a 20:00 game of the next day waiting for 08:00', () => {
    const eveningGame = { ...alert, tipOff: at('2026-01-15', '20:00') };
    expect(isUrgent(eveningGame, on)).toBe(false);
    expect(releaseAt(on.at, NIGHT, PARIS)).toBe(at('2026-01-15', '08:00'));
  });

  it('[TEL-21] [CL-TEL-18] makes urgent only requests, deadline changes, reminders, alerts and their updates', () => {
    const kinds: readonly Kind[] = [
      'backtest_request_to_do',
      'deadline_changed',
      'deadline_reminder',
      'alert',
      'alert_update',
      'tracked_game_result',
      'new_type_proposal',
      'incident_start',
      'test_message',
      'pass_digest',
      'catch_up',
    ];
    expect(kinds.filter((kind) => isUrgent({ ...alert, kind }, on))).toStrictEqual([
      'backtest_request_to_do',
      'deadline_changed',
      'deadline_reminder',
      'alert',
      'alert_update',
    ]);
  });

  it('[TEL-21] [CL-TEL-13] never makes a late alert urgent', () => {
    expect(isUrgent({ ...alert, isLate: true }, on)).toBe(false);
  });

  it('[TEL-21] defers everything when the urgent exception is off', () => {
    expect(isUrgent(alert, { ...lateEvening, urgentException: false })).toBe(false);
  });

  it('[TEL-21] is urgent only for a game that has not started and tips off before quiet hours end', () => {
    expect(isUrgent({ ...alert, tipOff: undefined }, on)).toBe(false);
    expect(isUrgent({ ...alert, tipOff: at('2026-01-14', '23:15') }, on)).toBe(false);
    expect(isUrgent({ ...alert, tipOff: at('2026-01-14', '23:30') }, on)).toBe(false);
    expect(isUrgent({ ...alert, tipOff: at('2026-01-15', '08:00') }, on)).toBe(false);
    expect(isUrgent({ ...alert, tipOff: at('2026-01-15', '07:59') }, on)).toBe(true);
  });

  it('[TEL-21] is never urgent outside quiet hours', () => {
    const afternoon = { ...on, at: at('2026-01-14', '15:00') };
    expect(isUrgent({ ...alert, tipOff: at('2026-01-14', '16:00') }, afternoon)).toBe(false);
  });

  it('[TEL-21] [CL-TEL-22] makes urgent at 23:00 a message about a game before 08:00', () => {
    expect(isUrgent(alert, { ...on, at: at('2026-01-14', '23:00') })).toBe(true);
  });
});

describe('groupPass', () => {
  it('[TEL-19] [CL-TEL-11] sends up to 3 alerts one by one and groups the other messages', () => {
    const pass = [
      message(1, 'alert'),
      message(2, 'backtest_request_to_do'),
      message(3, 'alert'),
      message(4, 'tracked_game_result'),
      message(5, 'alert'),
    ];
    const grouping = groupPass(pass, ALERT_THRESHOLD);
    expect(ids(grouping.alone)).toStrictEqual([1, 3, 5]);
    expect(ids(grouping.digest)).toStrictEqual([2, 4]);
  });

  it('[TEL-19] [CL-TEL-11] puts every alert of the pass in its digest beyond the threshold', () => {
    const pass = [
      message(1, 'alert'),
      message(2, 'alert'),
      message(3, 'new_type_proposal'),
      message(4, 'alert'),
      message(5, 'alert'),
    ];
    const grouping = groupPass(pass, ALERT_THRESHOLD);
    expect(ids(grouping.alone)).toStrictEqual([]);
    expect(ids(grouping.digest)).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('[TEL-19] [CL-TEL-11] [TEL-21] lets an urgent message leave alone, beyond the threshold too', () => {
    const pass = [
      message(1, 'alert'),
      message(2, 'alert', true),
      message(3, 'alert'),
      message(4, 'alert'),
      message(5, 'backtest_request_to_do', true),
    ];
    const grouping = groupPass(pass, ALERT_THRESHOLD);
    expect(ids(grouping.alone)).toStrictEqual([2, 5]);
    expect(ids(grouping.digest)).toStrictEqual([1, 3, 4]);
  });

  it('[TEL-19] [CA-TEL-09] groups two backtest requests and a type proposal into one digest', () => {
    const pass = [
      message(1, 'backtest_request_to_do'),
      message(2, 'backtest_request_to_do'),
      message(3, 'new_type_proposal'),
    ];
    const grouping = groupPass(pass, ALERT_THRESHOLD);
    expect(ids(grouping.alone)).toStrictEqual([]);
    expect(ids(grouping.digest)).toStrictEqual([1, 2, 3]);
  });

  it('[TEL-19] lets a single other message leave alone', () => {
    const pass = [message(1, 'alert'), message(2, 'tracked_game_result'), message(3, 'alert')];
    const grouping = groupPass(pass, ALERT_THRESHOLD);
    expect(ids(grouping.alone)).toStrictEqual([1, 2, 3]);
    expect(ids(grouping.digest)).toStrictEqual([]);
  });

  it('[TEL-20] [CA-TEL-06] groups three tracked results held during quiet hours into one digest', () => {
    const held = [1, 2, 3].map((id) => message(id, 'tracked_game_result'));
    expect(ids(groupPass(held, ALERT_THRESHOLD).digest)).toStrictEqual([1, 2, 3]);
  });
});

describe('digestLines', () => {
  it('[TEL-19] [CL-TEL-11] orders the lines by kind, then the nearest game, then creation', () => {
    const facts = [
      fact(1, 'incident_start', { createdMinute: 1 }),
      fact(2, 'new_type_proposal', { createdMinute: 2 }),
      fact(3, 'tracked_game_result', { tipOff: '02:00', createdMinute: 3 }),
      fact(4, 'deadline_reminder', { tipOff: '03:00', createdMinute: 4 }),
      fact(5, 'backtest_request_to_do', { tipOff: '01:00', createdMinute: 5 }),
      fact(6, 'alert_update', { tipOff: '04:00', createdMinute: 6 }),
      fact(7, 'alert', { tipOff: '04:00', createdMinute: 5 }),
      fact(8, 'alert', { tipOff: '02:00', createdMinute: 9 }),
      fact(9, 'export_reminder'),
      fact(10, 'deadline_changed'),
      fact(11, 'incident_end'),
    ];
    const lines = digestLines(facts, MAX_DETAILED + 1);
    expect(ids(lines.detailed)).toStrictEqual([8, 7, 6, 5, 4, 10, 3, 2, 9, 11, 1]);
    expect(lines.moreCount).toBe(0);
  });

  it('[TEL-19] details at most the set number of facts and sums up the rest', () => {
    const facts = Array.from({ length: 14 }, (_, index) =>
      fact(index + 1, 'tracked_game_result', { createdMinute: index }),
    );
    const lines = digestLines(facts, MAX_DETAILED);
    expect(ids(lines.detailed)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(lines.moreCount).toBe(4);
    expect(digestLines(facts.slice(0, MAX_DETAILED), MAX_DETAILED).moreCount).toBe(0);
  });

  it('[TEL-19] keeps every fact once, detailed or summed up, whatever the limit', () => {
    const kinds: readonly FactKind[] = ['alert', 'tracked_game_result', 'incident_start'];
    const drawnFact = fc.record({
      kind: fc.constantFrom(...kinds),
      tipOff: fc.option(fc.constantFrom('01:00', '02:00'), { nil: undefined }),
      createdMinute: fc.integer({ min: 0, max: 5 }),
    });
    fc.assert(
      fc.property(
        fc.array(drawnFact, { size: 'medium' }),
        fc.integer({ min: 1, max: MOST_DETAILED }),
        (drawnFacts, max) => {
          const facts = drawnFacts.map(({ kind, ...timing }, index) => fact(index, kind, timing));
          const lines = digestLines(facts, max);
          expect(lines.detailed).toHaveLength(Math.min(max, facts.length));
          expect(lines.detailed.length + lines.moreCount).toBe(facts.length);
        },
      ),
    );
  });
});

describe('the daily cap', () => {
  it('[TEL-22] [CL-TEL-07] counts every sent message once, a digest and the test message too, never the link confirmation nor the cap message', () => {
    const sent: readonly Kind[] = [
      'pass_digest',
      'alert',
      'test_message',
      'link_confirmation',
      'catch_up',
      'daily_cap_reached',
      'chat_unlinked_notice',
    ];
    expect(sent.filter((kind) => isCountedTowardCap(kind))).toStrictEqual([
      'pass_digest',
      'alert',
      'test_message',
      'catch_up',
      'chat_unlinked_notice',
    ]);
  });

  it('[TEL-22] [CL-TEL-07] sends below the cap, then the cap message once, then nothing, urgent ones included', () => {
    const fresh = { sentCount: DAILY_CAP - 1, capMessageExists: false };
    const reached = { sentCount: DAILY_CAP, capMessageExists: false };
    const capped = { sentCount: DAILY_CAP, capMessageExists: true };
    expect(capDecision('alert', fresh, DAILY_CAP)).toBe('send');
    expect(capDecision('alert', reached, DAILY_CAP)).toBe('send_cap_message');
    expect(capDecision('deadline_reminder', capped, DAILY_CAP)).toBe('discard');
    expect(capDecision('pass_digest', { ...capped, sentCount: DAILY_CAP + 1 }, DAILY_CAP)).toBe(
      'discard',
    );
  });

  it('[TEL-22] [CL-TEL-07] always sends the link confirmation and the cap message', () => {
    const capped = { sentCount: DAILY_CAP, capMessageExists: true };
    const reached = { ...capped, capMessageExists: false };
    expect(capDecision('link_confirmation', capped, DAILY_CAP)).toBe('send');
    expect(capDecision('daily_cap_reached', reached, DAILY_CAP)).toBe('send');
  });

  it('[TEL-22] [CL-TEL-19] refuses the test message at the cap', () => {
    const reached = { sentCount: DAILY_CAP, capMessageExists: false };
    expect(capDecision('test_message', reached, DAILY_CAP)).toBe('refused');
    expect(capDecision('test_message', { ...reached, sentCount: 0 }, DAILY_CAP)).toBe('send');
  });
});

describe('nextAttempt', () => {
  const failedAt = at('2026-01-15', '10:00');
  const failure = (failureCount: number, retryAfterMs?: number) => ({
    failedAt,
    failureCount,
    retryAfterMs,
  });

  it('[TEL-35] waits 1, 5, 15, 30 then 60 minutes, then fails the message', () => {
    const attempts = RETRY_INTERVALS.map((_, index) =>
      nextAttempt(failure(index + 1), RETRY_INTERVALS),
    );
    expect(attempts).toStrictEqual(
      RETRY_INTERVALS.map((minutes) => ({ kind: 'retry', at: plusMinutes(failedAt, minutes) })),
    );
    expect(nextAttempt(failure(RETRY_INTERVALS.length + 1), RETRY_INTERVALS)).toStrictEqual({
      kind: 'failed',
    });
  });

  it('[TEL-35] waits the delay Telegram asks for when it is longer than the interval', () => {
    const twoMinutes = 2 * MS_PER_MINUTE;
    expect(nextAttempt(failure(1, twoMinutes), RETRY_INTERVALS)).toStrictEqual({
      kind: 'retry',
      at: plusMinutes(failedAt, 2),
    });
    expect(nextAttempt(failure(2, twoMinutes), RETRY_INTERVALS)).toStrictEqual({
      kind: 'retry',
      at: plusMinutes(failedAt, 5),
    });
  });
});

describe('catchUpDueAt', () => {
  const createdAt = at('2026-01-15', '10:00');
  const context = {
    now: at('2026-01-15', '10:05'),
    catchUpIntervalMinutes: CATCH_UP_MINUTES,
    quietHours: NIGHT,
    zone: PARIS,
  };

  it('[TEL-36] [CL-TEL-12] tries a catch-up that never failed at once', () => {
    const state = { createdAt, lastFailureAt: undefined, lastSuccessAt: undefined };
    expect(catchUpDueAt(state, context)).toBe(context.now);
    expect(catchUpDueAt(state, { ...context, now: plusMinutes(createdAt, -1) })).toBe(createdAt);
  });

  it('[TEL-36] [CL-TEL-12] tries again one interval after its last failure', () => {
    const lastFailureAt = at('2026-01-15', '10:04');
    const state = { createdAt, lastFailureAt, lastSuccessAt: at('2026-01-15', '10:02') };
    expect(catchUpDueAt(state, context)).toBe(at('2026-01-15', '11:04'));
  });

  it('[TEL-36] [CL-TEL-12] tries right after another send succeeds', () => {
    const state = {
      createdAt,
      lastFailureAt: at('2026-01-15', '10:01'),
      lastSuccessAt: at('2026-01-15', '10:03'),
    };
    expect(catchUpDueAt(state, context)).toBe(context.now);
  });

  it('[TEL-36] [CL-TEL-12] [TEL-20] waits for the end of quiet hours, when the quiet-hours digest leaves', () => {
    const lastFailureAt = at('2026-01-14', '22:30');
    const state = { createdAt, lastFailureAt, lastSuccessAt: undefined };
    const night = { ...context, now: at('2026-01-14', '23:10') };
    const end = at('2026-01-15', '08:00');
    expect(catchUpDueAt(state, night)).toBe(end);
    expect(catchUpDueAt(state, night)).toBe(releaseAt(night.now, NIGHT, PARIS));
    const success = { ...state, lastSuccessAt: at('2026-01-15', '02:00') };
    expect(catchUpDueAt(success, { ...night, now: at('2026-01-15', '02:01') })).toBe(end);
  });
});
