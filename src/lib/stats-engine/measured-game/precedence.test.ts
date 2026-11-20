import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { classifyPrecedence } from './precedence';

import type { Precedence, PrecedenceGame, PrecedenceSource } from './precedence';

// New York is five hours behind UTC in winter.
const NEW_YORK_WINTER_OFFSET_HOURS = 5;

/** The instant of New York wall time `time`, written HH:MM, on `dayOn` in winter. */
function easternAt(dayOn: string, time: string): number {
  const [year = 0, month = 0, date = 0] = dayOn.split('-').map(Number);
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, date, hours + NEW_YORK_WINTER_OFFSET_HOURS, minutes);
}

const dated = (publicationDateOn: string): PrecedenceSource => ({
  publicationDateOn,
  publicationAt: null,
});
const timed = (dayOn: string, time: string): PrecedenceSource => ({
  publicationDateOn: dayOn,
  publicationAt: easternAt(dayOn, time),
});
const gameAt = (gameDayOn: string, time: string): PrecedenceGame => ({
  scheduledStartAt: easternAt(gameDayOn, time),
  gameDayOn,
});

// The measured game G: tip-off at 19:30 New York time on its US date, 15 January 2021.
const GAME = gameAt('2021-01-15', '19:30');

const againstGame = (sources: readonly PrecedenceSource[], game = GAME): Precedence =>
  classifyPrecedence(sources, { measuredGame: game, firstTeamGame: null });

describe('classifyPrecedence against the measured game', () => {
  it.each<[string, readonly PrecedenceSource[], Precedence]>([
    [
      'a source timed before the tip-off of the same day',
      [timed('2021-01-15', '12:00')],
      'established',
    ],
    ['a source timed one minute before the tip-off', [timed('2021-01-15', '19:29')], 'established'],
    ['a source timed at the tip-off itself', [timed('2021-01-15', '19:30')], 'not_established'],
    ['a source timed during the game', [timed('2021-01-15', '22:10')], 'not_established'],
    ['a source timed the evening before', [timed('2021-01-14', '21:00')], 'established'],
    ['a date-only source of the day before', [dated('2021-01-14')], 'established'],
    ['a date-only source of the game day', [dated('2021-01-15')], 'uncertain'],
    ['a date-only source of the day after', [dated('2021-01-16')], 'not_established'],
    ['a source timed the day after', [timed('2021-01-16', '09:00')], 'not_established'],
    ['no source at all', [], 'not_established'],
  ])('[IMP-18] [CL-IMP-17] classifies %s', (_case, sources, expected) => {
    expect(againstGame(sources)).toBe(expected);
  });

  it.each<[string, readonly PrecedenceSource[], Precedence]>([
    [
      'a same-day undated source and a later one',
      [timed('2021-01-16', '09:00'), dated('2021-01-15')],
      'uncertain',
    ],
    [
      'a same-day undated source and one that precedes',
      [dated('2021-01-15'), dated('2021-01-13')],
      'established',
    ],
    [
      'a late source and one timed before the tip-off',
      [timed('2021-01-15', '23:00'), timed('2021-01-15', '08:15')],
      'established',
    ],
    ['two late sources', [dated('2021-01-17'), timed('2021-01-15', '21:45')], 'not_established'],
  ])('[IMP-18] [CL-IMP-17] classifies from every source %s', (_case, sources, expected) => {
    expect(againstGame(sources)).toBe(expected);
  });

  it('[IMP-18] [CL-STA-14] compares a game whose time is to be determined with its deemed start, 00:00 New York time on its US date', () => {
    const toBeDetermined = gameAt('2021-01-15', '00:00');

    expect(againstGame([timed('2021-01-15', '10:00')], toBeDetermined)).toBe('not_established');
    expect(againstGame([timed('2021-01-15', '10:00')])).toBe('established');
    expect(againstGame([timed('2021-01-14', '23:59')], toBeDetermined)).toBe('established');
    expect(againstGame([dated('2021-01-15')], toBeDetermined)).toBe('uncertain');
  });
});

const beforeGame = (
  sources: readonly PrecedenceSource[],
  firstTeamGame: PrecedenceGame | null,
): Precedence => classifyPrecedence(sources, { measuredGame: null, firstTeamGame });

describe('classifyPrecedence before the measured game is known', () => {
  // The first official game of his teams after the event, two days before G.
  const FIRST = gameAt('2021-01-13', '20:00');

  it('[IMP-18] [CL-IMP-17] is to verify while no game after the event is known', () => {
    expect(beforeGame([dated('2020-12-01'), timed('2021-01-02', '10:00')], null)).toBe('to_verify');
  });

  it('[IMP-18] [CL-IMP-17] is established as soon as a source precedes the first game of his teams after the event', () => {
    expect(beforeGame([dated('2021-01-12')], FIRST)).toBe('established');
    expect(beforeGame([timed('2021-01-16', '10:00'), timed('2021-01-13', '19:00')], FIRST)).toBe(
      'established',
    );
  });

  it('[IMP-18] [CL-IMP-17] stays to verify while no source precedes that first game, even one of its own day', () => {
    expect(beforeGame([dated('2021-01-13')], FIRST)).toBe('to_verify');
    expect(beforeGame([timed('2021-01-13', '20:00'), dated('2021-01-14')], FIRST)).toBe(
      'to_verify',
    );
    expect(beforeGame([], FIRST)).toBe('to_verify');
  });

  it('[IMP-18] [CL-IMP-17] classifies against the measured game once it is known, the first game aside', () => {
    const sources = [dated('2021-01-15')];

    expect(classifyPrecedence(sources, { measuredGame: GAME, firstTeamGame: FIRST })).toBe(
      'uncertain',
    );
    expect(beforeGame(sources, FIRST)).toBe('to_verify');
  });
});

// Generated situations over January 2021: days 9 to 18, at any minute of New York time.
const anyDay = fc
  .integer({ min: 9, max: 18 })
  .map((date) => `2021-01-${String(date).padStart(2, '0')}`);
const anyTime = fc
  .integer({ min: 0, max: 24 * 60 - 1 })
  .map((minute) => `${String(Math.floor(minute / 60))}:${String(minute % 60)}`);
const anySource: fc.Arbitrary<PrecedenceSource> = fc.oneof(
  anyDay.map((dayOn) => dated(dayOn)),
  fc.tuple(anyDay, anyTime).map(([dayOn, time]) => timed(dayOn, time)),
);
const anyGame: fc.Arbitrary<PrecedenceGame> = fc
  .tuple(anyDay, anyTime)
  .map(([dayOn, time]) => gameAt(dayOn, time));
const isNotBefore = (later: PrecedenceGame, earlier: PrecedenceGame): boolean =>
  later.scheduledStartAt >= earlier.scheduledStartAt && later.gameDayOn >= earlier.gameDayOn;

// The precedences against a known game, from the lowest to the highest.
const RANKS: readonly Precedence[] = ['not_established', 'uncertain', 'established'];
const rankOf = (precedence: Precedence): number => RANKS.indexOf(precedence);

describe('classifyPrecedence over any sources', () => {
  it('[IMP-18] [CL-IMP-17] never decides before the measured game a precedence that this game contradicts', () => {
    fc.assert(
      fc.property(fc.array(anySource), anyGame, anyGame, (sources, first, measured) => {
        fc.pre(isNotBefore(measured, first));
        const early = classifyPrecedence(sources, { measuredGame: null, firstTeamGame: first });
        const late = classifyPrecedence(sources, { measuredGame: measured, firstTeamGame: first });

        expect(early === 'to_verify' || late === early).toBe(true);
      }),
    );
  });

  it('[IMP-18] [CL-IMP-17] reads every source whatever their order, and never ranks a precedence lower for one more source', () => {
    fc.assert(
      fc.property(fc.array(anySource), anySource, anyGame, (sources, added, game) => {
        const precedence = againstGame(sources, game);

        expect(againstGame(sources.toReversed(), game)).toBe(precedence);
        expect(rankOf(againstGame([...sources, added], game))).toBeGreaterThanOrEqual(
          rankOf(precedence),
        );
      }),
    );
  });
});
