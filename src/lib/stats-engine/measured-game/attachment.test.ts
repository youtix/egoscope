import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { attachEvent } from './attachment';

import type { Participation } from '../performance/participation';
import type { EngineParams } from '../types';
import type { Attachment, AttachmentContext, AttachmentEvent, AttachmentGame } from './attachment';
import type { PrecedenceSource } from './precedence';

// The registry's defaults, a window of 10 days among them (SEN-04).
const DEFAULTS: EngineParams = {
  games: {
    minutesFloor: 15,
    minutesAverageShare: 50,
    minBaselineGames: 10,
    postseasonBaseline: 'postseason',
    partialBaselineShare: 20,
    dailyUpdateDelayHours: 3,
    correctionWindowDays: 7,
    boxScoreUnavailableAfterDays: 30,
    retryFirstDelayHours: 1,
    retryIntervalHours: 4,
    incidentAfterHours: 12,
    quotaReserveShare: 10,
  },
  sensitivity: {
    maxAttachmentDays: 10,
    coOccurringCasesDoubtful: false,
    injuryReturnMinGamesMissed: 4,
    injuryReturnFirstGames: 2,
    allPlayoffGamesUnusualStakes: false,
    opponentWinShareLow: 25,
    opponentWinShareHigh: 75,
    opponentMinGames: 10,
    minValidCases: 5,
    possibleSignalToNoise: 2,
    possibleMeanGap: 0.25,
    probableSignalToNoise: 3,
    probableMeanGap: 0.4,
    confidenceMediumFromCases: 8,
    confidenceHighFromCases: 15,
    confidenceDispersionDrop: 1.5,
    confidenceDoubtfulShareDrop: 30,
    trendMinPlayers: 3,
    trendMaxTopShare: 50,
    countsBelowCases: 20,
  },
  tracking: { categoryThreshold: 0.25, minTrackedCasesForAssessment: 10 },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// The default window, 10 days counted in hours (SEN-04).
const WINDOW = 240 * HOUR;

// Hours behind UTC of New York and Los Angeles, in winter and in summer.
type Season = 'winter' | 'summer';
const BEHIND_UTC: Readonly<Record<Season, Readonly<{ newYork: number; losAngeles: number }>>> = {
  winter: { newYork: 5, losAngeles: 8 },
  summer: { newYork: 4, losAngeles: 7 },
};

/** The parts of a date written YYYY-MM-DD. */
const partsOf = (dayOn: string): number[] => dayOn.split('-').map(Number);

/** The instant of New York wall time `time`, written HH:MM, on `dayOn`. */
function easternAt(dayOn: string, time: string, season: Season = 'winter'): number {
  const [year = 0, month = 0, date = 0] = partsOf(dayOn);
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, date, hours + BEHIND_UTC[season].newYork, minutes);
}

/** The end of `dayOn` in Pacific time, 00:00 Los Angeles time the next day (SEN-01). */
function endOfDayPacific(dayOn: string, season: Season = 'winter'): number {
  const [year = 0, month = 0, date = 0] = partsOf(dayOn);
  return Date.UTC(year, month - 1, date + 1, BEHIND_UTC[season].losAngeles);
}

type GameSpec = Readonly<{
  /** New York wall time; 00:00 for a time to be determined, its deemed start. */
  time?: string;
  participation?: Participation | null;
  isBoxScoreUnavailable?: boolean;
  season?: Season;
}>;

/** His team game `id` on the US date `dayOn`, by default at 19:30 New York time and played. */
function gameOn(id: number, dayOn: string, spec: GameSpec = {}): AttachmentGame {
  const { time = '19:30', participation = 'played', season = 'winter' } = spec;
  const isFinal = participation !== null;
  return {
    game: {
      id,
      phase: 'regular_season',
      status: isFinal ? 'final' : 'scheduled',
      homeTeamId: 1,
      awayTeamId: 2,
      finalScore: isFinal ? { home: 101, away: 99 } : null,
      scheduledStartAt: easternAt(dayOn, time, season),
      homeLinesPublished: isFinal && participation !== 'unknown',
      awayLinesPublished: isFinal,
    },
    teamId: 1,
    participation,
    minutes: participation === 'played' ? 31 : null,
    gameDayOn: dayOn,
    endOfDayPacificAt: endOfDayPacific(dayOn, season),
    isBoxScoreUnavailable: spec.isBoxScoreUnavailable ?? false,
  };
}

/** `teamGame` moved to start at `scheduledStartAt`. */
const startingAt = (teamGame: AttachmentGame, scheduledStartAt: number): AttachmentGame => ({
  ...teamGame,
  game: { ...teamGame.game, scheduledStartAt },
});

type Evaluation = Omit<AttachmentContext, 'games'>;

/** The evaluation at `now`, a winter instant, with its US date. */
const at = (now: number): Evaluation => ({
  now,
  nowGameDayOn: new Date(now - BEHIND_UTC.winter.newYork * HOUR).toISOString().slice(0, 10),
});
// An evaluation after every game of the examples.
const LATER = at(easternAt('2020-04-01', '12:00'));

const attach = (
  event: AttachmentEvent,
  games: readonly AttachmentGame[],
  evaluation = LATER,
): Attachment => attachEvent(event, { games, ...evaluation }, DEFAULTS);

/** Where an attachment ends: its status, its reason, none once attached, and its game. */
type End = readonly [Attachment['status'], string | null, number | null];

function endOf(event: AttachmentEvent, games: readonly AttachmentGame[], evaluation = LATER): End {
  const attachment = attach(event, games, evaluation);
  const reason = attachment.status === 'attached' ? null : attachment.reason;
  return [attachment.status, reason, attachment.measuredGameId];
}

/** A detected event, or a historical one with `sources`, searched from `referenceInstantAt`. */
const fromInstant = (
  referenceInstantAt: number,
  sources: readonly PrecedenceSource[] | null = null,
): AttachmentEvent => ({
  kind: 'reference_instant',
  referenceInstantAt,
  referenceInstantOrigin: 'known_instant',
  sources,
});
const knownOn = (
  eventOn: string,
  sources: readonly PrecedenceSource[] | null = null,
): AttachmentEvent => ({ kind: 'known_in_advance', eventOn, sources });
const derived = (derivedGame: AttachmentGame): AttachmentEvent => ({
  kind: 'calendar_derived',
  derivedGame,
});
const dated = (publicationDateOn: string): PrecedenceSource => ({
  publicationDateOn,
  publicationAt: null,
});
const timed = (dayOn: string, time: string): PrecedenceSource => ({
  publicationDateOn: dayOn,
  publicationAt: easternAt(dayOn, time),
});

// The status and reason of the ends that the examples reach, as endOf gives them.
const ATTACHED = ['attached', null] as const;
const NOT_PLAYED_YET = ['awaiting_game', 'game_not_played_yet'] as const;
const PENDING = ['awaiting_game', 'statistics_pending'] as const;
const NO_GAME = ['not_measurable', 'no_game_within_window'] as const;
const UNAVAILABLE = ['not_measurable', 'box_score_unavailable'] as const;

describe('attachEvent from a reference instant', () => {
  const MORNING = fromInstant(easternAt('2020-01-14', '09:00'));

  it('[SEN-03] [CA-SEN-02] measures the next game he plays, never the game that started at 19:30 Eastern before the event became public at 22:10', () => {
    const publicAt = easternAt('2020-01-15', '22:10');
    const missed = gameOn(2, '2020-01-17', { participation: 'not_played' });
    const games = [gameOn(1, '2020-01-15'), missed, gameOn(3, '2020-01-19')];

    expect(attach(fromInstant(publicAt), games)).toStrictEqual({
      status: 'attached',
      measuredGameId: 3,
      referenceInstantAt: publicAt,
      referenceInstantOrigin: 'known_instant',
      absences: [2],
      precedence: null,
    });
  });

  it('[SEN-03] [CL-SEN-02] measures a game only for an event public strictly before its scheduled start', () => {
    const tipOff = easternAt('2020-01-15', '19:30');
    const games = [gameOn(1, '2020-01-15'), gameOn(2, '2020-01-17')];

    expect(endOf(fromInstant(tipOff), games)).toStrictEqual([...ATTACHED, 2]);
    expect(endOf(fromInstant(tipOff - 1), games)).toStrictEqual([...ATTACHED, 1]);
  });

  it('[SEN-03] [CL-SEN-05] measures the first game he played whatever his minutes, and never slides past it', () => {
    const games = [{ ...gameOn(1, '2020-01-15'), minutes: 1.5 }, gameOn(2, '2020-01-17')];

    expect(endOf(MORNING, games)).toStrictEqual([...ATTACHED, 1]);
  });

  it('[SEN-03] [CL-SEN-05] stops at a game not yet final: "game not yet played" before its start, "statistics pending" from it', () => {
    const coming = gameOn(2, '2020-01-17', { participation: null });
    const games = [gameOn(1, '2020-01-15', { participation: 'not_played' }), coming];
    const tipOff = coming.game.scheduledStartAt;

    expect(attach(MORNING, games, at(tipOff - 1))).toMatchObject({ absences: [1] });
    expect(endOf(MORNING, games, at(tipOff - 1))).toStrictEqual([...NOT_PLAYED_YET, 2]);
    expect(endOf(MORNING, games, at(tipOff))).toStrictEqual([...PENDING, 2]);
  });

  it('[SEN-03] [CL-STA-04] stops at a game of unknown participation: "statistics pending", then "box score unavailable" once it is unavailable, never sliding past it', () => {
    const unknown = gameOn(2, '2020-01-17', { participation: 'unknown' });
    const unavailable = { ...unknown, isBoxScoreUnavailable: true };
    const later = gameOn(3, '2020-01-19');

    expect(endOf(MORNING, [unknown, later])).toStrictEqual([...PENDING, 2]);
    expect(endOf(MORNING, [unavailable, later])).toStrictEqual([...UNAVAILABLE, 2]);
  });

  it('[SEN-04] [CL-SEN-05] measures a game that starts 240 hours after the reference instant, and ends the walk at one that starts later, final or not', () => {
    const reference = easternAt('2020-01-14', '19:30');
    const event = fromInstant(reference);
    const missed = gameOn(1, '2020-01-16', { participation: 'not_played' });
    const atTheEnd = gameOn(2, '2020-01-24');
    const pastTheEnd = startingAt(atTheEnd, reference + WINDOW + 1);
    const notFinal = { ...pastTheEnd, participation: null };

    expect(endOf(event, [missed, atTheEnd])).toStrictEqual([...ATTACHED, 2]);
    expect(endOf(event, [missed, pastTheEnd])).toStrictEqual([...NO_GAME, null]);
    expect(attach(event, [missed, pastTheEnd]).absences).toStrictEqual([1]);
    expect(endOf(event, [notFinal], at(reference + HOUR))).toStrictEqual([...NO_GAME, null]);
  });

  it('[SEN-04] counts the window from sensitivity.maxAttachmentDays', () => {
    const sensitivity = { ...DEFAULTS.sensitivity, maxAttachmentDays: 3 };
    const threeDays: EngineParams = { ...DEFAULTS, sensitivity };
    const context = { games: [gameOn(1, '2020-01-17')], ...LATER };
    const reference = easternAt('2020-01-14', '19:30');

    expect(attachEvent(fromInstant(reference), context, threeDays).status).toBe('attached');
    expect(attachEvent(fromInstant(reference - 1), context, threeDays).status).toBe(
      'not_measurable',
    );
    expect(attachEvent(fromInstant(reference - 1), context, DEFAULTS).status).toBe('attached');
  });

  it('[SEN-04] [CA-SEN-04] makes an event of 5 July whose next game is in October not measurable, "no game played within the window"', () => {
    // A date-only public date: public from 00:00 Los Angeles time on 6 July (SEN-01).
    const reference = endOfDayPacific('2019-07-05', 'summer');
    const event: AttachmentEvent = {
      kind: 'reference_instant',
      referenceInstantAt: reference,
      referenceInstantOrigin: 'date_only',
      sources: null,
    };
    const opener = gameOn(1, '2019-10-23', { season: 'summer' });

    expect(attach(event, [opener], at(reference + DAY))).toStrictEqual({
      status: 'not_measurable',
      reason: 'no_game_within_window',
      measuredGameId: null,
      referenceInstantAt: reference,
      referenceInstantOrigin: 'date_only',
      absences: [],
      precedence: null,
    });
  });

  it('[SEN-04] [CA-SEN-04] [CL-SEN-05] awaits a game while no further game is stored, until 240 hours have passed', () => {
    const reference = endOfDayPacific('2019-07-05', 'summer');
    const event = fromInstant(reference);

    expect(endOf(event, [], at(reference + WINDOW))).toStrictEqual([...NOT_PLAYED_YET, null]);
    expect(endOf(event, [], at(reference + WINDOW + 1))).toStrictEqual([...NO_GAME, null]);
  });

  it('[SEN-03] [CL-STA-14] compares a game whose time is to be determined by its deemed start, 00:00 New York time on its US date', () => {
    // Public on 14 January, date only: from 00:00 Los Angeles time on 15 January.
    const event = fromInstant(endOfDayPacific('2020-01-14'));
    const toBeDetermined = gameOn(1, '2020-01-15', { time: '00:00' });
    const later = gameOn(2, '2020-01-17');

    expect(endOf(event, [toBeDetermined, later])).toStrictEqual([...ATTACHED, 2]);
    expect(endOf(event, [gameOn(1, '2020-01-15'), later])).toStrictEqual([...ATTACHED, 1]);
  });

  it('[SEN-03] [CL-STA-09] walks his team games by scheduled start, then by id, whatever their order', () => {
    const late = gameOn(9, '2020-01-17');
    const missedLowerId = gameOn(5, '2020-01-15', { participation: 'not_played' });
    const missedHigherId = gameOn(7, '2020-01-15', { participation: 'not_played' });
    const lowerIdMissed = [late, gameOn(7, '2020-01-15'), missedLowerId];
    const higherIdMissed = [late, missedHigherId, gameOn(5, '2020-01-15')];

    expect(attach(MORNING, lowerIdMissed)).toMatchObject({ measuredGameId: 7, absences: [5] });
    expect(attach(MORNING, higherIdMissed)).toMatchObject({ measuredGameId: 5, absences: [] });
  });
});

describe('attachEvent of an event known in advance', () => {
  const EVENT = knownOn('2020-02-25');
  const missed = [
    gameOn(1, '2020-02-25', { participation: 'not_played' }),
    gameOn(2, '2020-03-01', { participation: 'not_played' }),
  ];

  it('[SEN-02] [CL-SEN-04] measures the first game he plays from the US date of the event on, that day included', () => {
    const games = [gameOn(1, '2020-02-24'), gameOn(2, '2020-02-25', { time: '21:00' })];

    expect(attach(EVENT, games)).toStrictEqual({
      status: 'attached',
      measuredGameId: 2,
      referenceInstantAt: null,
      referenceInstantOrigin: 'known_in_advance',
      absences: [],
      precedence: null,
    });
  });

  it('[SEN-02] [CL-SEN-04] skips the games he did not play as absences and measures a game up to 10 calendar days after the event, never later', () => {
    const lastDay = gameOn(3, '2020-03-06', { time: '22:30' });
    const dayAfter = gameOn(3, '2020-03-07', { time: '12:00' });

    expect(attach(EVENT, [...missed, lastDay]).absences).toStrictEqual([1, 2]);
    expect(endOf(EVENT, [...missed, lastDay])).toStrictEqual([...ATTACHED, 3]);
    expect(endOf(EVENT, [...missed, dayAfter])).toStrictEqual([...NO_GAME, null]);
  });

  it('[SEN-02] [CL-SEN-04] [CL-SEN-05] awaits a game past the last stored one until the US date of now is past the event plus 10 days', () => {
    const lastEvening = at(easternAt('2020-03-06', '23:59'));
    const nextMorning = at(easternAt('2020-03-07', '00:00'));

    expect(endOf(EVENT, missed, lastEvening)).toStrictEqual([...NOT_PLAYED_YET, null]);
    expect(endOf(EVENT, missed, nextMorning)).toStrictEqual([...NO_GAME, null]);
  });
});

describe('attachEvent of a calendar-derived event', () => {
  const later = gameOn(9, '2020-01-20');

  it('[CL-SEN-03] measures the derived game he played, with no reference instant', () => {
    const derivedGame = gameOn(4, '2020-01-16');

    expect(attach(derived(derivedGame), [derivedGame, later])).toStrictEqual({
      status: 'attached',
      measuredGameId: 4,
      referenceInstantAt: null,
      referenceInstantOrigin: 'known_in_advance',
      absences: [],
      precedence: null,
    });
  });

  it('[CL-SEN-03] makes the case not measurable, "did not play the derived game", when he did not play it, never sliding to a later game', () => {
    const derivedGame = gameOn(4, '2020-01-16', { participation: 'not_played' });
    const end = ['not_measurable', 'derived_game_missed', 4];

    expect(endOf(derived(derivedGame), [derivedGame, later])).toStrictEqual(end);
  });

  it('[CL-SEN-03] [CL-STA-04] waits at the derived game while his participation is unknown, and makes the case not measurable once its box score is unavailable', () => {
    const coming = gameOn(4, '2020-01-16', { participation: null });
    const tipOff = coming.game.scheduledStartAt;
    const unknown = gameOn(4, '2020-01-16', { participation: 'unknown' });
    const unavailable = { ...unknown, isBoxScoreUnavailable: true };

    expect(endOf(derived(coming), [], at(tipOff - 1))).toStrictEqual([...NOT_PLAYED_YET, 4]);
    expect(endOf(derived(coming), [], at(tipOff))).toStrictEqual([...PENDING, 4]);
    expect(endOf(derived(unknown), [])).toStrictEqual([...PENDING, 4]);
    expect(endOf(derived(unavailable), [])).toStrictEqual([...UNAVAILABLE, 4]);
  });
});

describe('attachEvent of a historical event, with the precedence of its sources', () => {
  const REFERENCE = easternAt('2020-01-14', '12:00');
  const SHIFTED = endOfDayPacific('2020-01-15');
  const measured = gameOn(1, '2020-01-15');
  const missed = gameOn(2, '2020-01-16', { participation: 'not_played' });
  const next = gameOn(3, '2020-01-17');
  const SAME_DAY_SOURCE = fromInstant(REFERENCE, [dated('2020-01-15')]);

  it('[IMP-18] [SEN-44] keeps the measured game when a source precedes its tip-off', () => {
    const attachment = attach(fromInstant(REFERENCE, [timed('2020-01-15', '18:00')]), [measured]);

    expect(attachment).toMatchObject({ status: 'attached', measuredGameId: 1 });
    expect(attachment).toMatchObject({ referenceInstantAt: REFERENCE, precedence: 'established' });
  });

  it('[IMP-18] [SEN-44] makes the event not measurable, "precedence not established", when every source follows the tip-off', () => {
    const event = fromInstant(REFERENCE, [timed('2020-01-15', '22:10'), dated('2020-01-16')]);
    const attachment = attach(event, [measured, next]);
    const end = ['not_measurable', 'precedence_not_established', null];

    expect(endOf(event, [measured, next])).toStrictEqual(end);
    expect(attachment).toMatchObject({
      referenceInstantAt: REFERENCE,
      precedence: 'not_established',
    });
  });

  it('[SEN-44] [CL-SEN-07] shifts an uncertain precedence once, to the end of the US date of the game in Pacific time, measures the next game he plays from there and never classifies again', () => {
    const coming = gameOn(3, '2020-01-17', { participation: null });

    expect(attach(SAME_DAY_SOURCE, [measured, missed, next])).toStrictEqual({
      status: 'attached',
      measuredGameId: 3,
      referenceInstantAt: SHIFTED,
      referenceInstantOrigin: 'uncertain_precedence_shift',
      absences: [2],
      precedence: 'uncertain',
    });
    expect(endOf(SAME_DAY_SOURCE, [measured, coming])).toStrictEqual([...PENDING, 3]);
    expect(attach(SAME_DAY_SOURCE, [measured, coming]).precedence).toBe('uncertain');
  });

  it('[SEN-44] [CL-SEN-07] counts the window again from the shifted instant', () => {
    const atTheEnd = startingAt(next, SHIFTED + WINDOW);
    const pastTheEnd = startingAt(next, SHIFTED + WINDOW + 1);

    expect(endOf(SAME_DAY_SOURCE, [measured, atTheEnd])).toStrictEqual([...ATTACHED, 3]);
    expect(endOf(SAME_DAY_SOURCE, [measured, pastTheEnd])).toStrictEqual([...NO_GAME, null]);
    expect(attach(SAME_DAY_SOURCE, [measured, pastTheEnd]).referenceInstantAt).toBe(SHIFTED);
  });

  it('[IMP-18] [CL-IMP-17] leaves the precedence to verify while the walk reaches no game he played, unless a source precedes the first game after the event', () => {
    const coming = gameOn(1, '2020-01-15', { participation: null });
    const beforeIt = at(easternAt('2020-01-15', '12:00'));
    const dayBeforeSource = fromInstant(REFERENCE, [dated('2020-01-14')]);

    expect(endOf(SAME_DAY_SOURCE, [coming], beforeIt)).toStrictEqual([...NOT_PLAYED_YET, 1]);
    expect(attach(SAME_DAY_SOURCE, [coming], beforeIt).precedence).toBe('to_verify');
    expect(attach(dayBeforeSource, [coming], beforeIt).precedence).toBe('established');
    expect(attach(dayBeforeSource, [], beforeIt).precedence).toBe('to_verify');
  });

  it('[SEN-02] [SEN-44] [CL-SEN-07] classifies the precedence of a historical event known in advance as that of any historical event', () => {
    const event = knownOn('2020-01-15', [dated('2020-01-15')]);

    expect(attach(event, [measured, missed, next])).toMatchObject({
      measuredGameId: 3,
      referenceInstantAt: SHIFTED,
      referenceInstantOrigin: 'uncertain_precedence_shift',
      precedence: 'uncertain',
    });
  });
});

// Generated situations over the 41 days from 1 January 2020: games, sources and instants
// at a few times of New York's day, so that they often meet, and instants at any time.
const FIRST_DAY = Date.UTC(2020, 0, 1);
const dayOn = (index: number): string =>
  new Date(FIRST_DAY + index * DAY).toISOString().slice(0, 10);
const dayIndexOf = (day: string): number => {
  const [year = 0, month = 0, date = 0] = partsOf(day);
  return (Date.UTC(year, month - 1, date) - FIRST_DAY) / DAY;
};
const anyDayIndex = fc.integer({ min: 0, max: 40 });
const anyTime = fc.constantFrom('00:00', '12:00', '19:30', '22:10');
const anyTeamGame = fc
  .record({
    id: fc.integer({ min: 1, max: 60 }),
    dayIndex: anyDayIndex,
    time: anyTime,
    participation: fc.constantFrom<Participation | null>('played', 'not_played', 'unknown', null),
    isBoxScoreUnavailable: fc.boolean(),
  })
  .map(({ id, dayIndex, ...spec }) => gameOn(id, dayOn(dayIndex), spec));
const anyTeamGames = fc.uniqueArray(anyTeamGame, {
  selector: ({ game }) => game.id,
  maxLength: 15,
});
const anyInstant = fc.oneof(
  fc.tuple(anyDayIndex, anyTime).map(([index, time]) => easternAt(dayOn(index), time)),
  fc.integer({ min: FIRST_DAY - 2 * DAY, max: FIRST_DAY + 42 * DAY }),
);
const anySource = fc.oneof(
  anyDayIndex.map((index) => dated(dayOn(index))),
  fc.tuple(anyDayIndex, anyTime).map(([index, time]) => timed(dayOn(index), time)),
);
const anySituation = fc.record({
  games: anyTeamGames,
  reference: anyInstant,
  now: anyInstant,
  sources: fc.option(fc.array(anySource, { maxLength: 3 }), { nil: null }),
});

/** By scheduled start, then by id (CL-STA-09). */
function inOrder(left: AttachmentGame, right: AttachmentGame): number {
  const byStart = left.game.scheduledStartAt - right.game.scheduledStartAt;
  return byStart === 0 ? left.game.id - right.game.id : byStart;
}

/**
 * Checks that the absences of `attachment` are the first of `candidates` in order, all
 * games he did not play, and that the game it stops at, if any, comes right after them;
 * gives the game it measured, if any.
 */
function measuredAfterAbsences(
  candidates: readonly AttachmentGame[],
  attachment: Attachment,
): AttachmentGame | undefined {
  const ordered = candidates.toSorted(inOrder);
  const skipped = ordered.slice(0, attachment.absences.length);
  const next = ordered[skipped.length];

  expect(skipped.map(({ game }) => game.id)).toStrictEqual(attachment.absences);
  expect(skipped.every(({ participation }) => participation === 'not_played')).toBe(true);
  expect(attachment.measuredGameId ?? next?.game.id).toBe(next?.game.id);
  return attachment.status === 'attached' ? next : undefined;
}

describe('attachEvent over any team games', () => {
  it('[SEN-03] [SEN-04] [CL-SEN-05] measures only a game he played, after the reference instant and within its window, and never slides past another game', () => {
    fc.assert(
      fc.property(anySituation, ({ games, reference, now, sources }) => {
        const attachment = attach(fromInstant(reference, sources), games, at(now));
        const from = attachment.referenceInstantAt ?? NaN;
        const after = games.filter(({ game }) => game.scheduledStartAt > from);
        const measured = measuredAfterAbsences(after, attachment);

        expect(from).toBeGreaterThanOrEqual(reference);
        expect(measured?.participation ?? 'played').toBe('played');
        expect(measured?.game.scheduledStartAt ?? from).toBeLessThanOrEqual(from + WINDOW);
      }),
    );
  });

  it('[SEN-02] [CL-SEN-04] measures an event known in advance only on a game he played from its US date to 10 days later', () => {
    const anyKnownInAdvance = fc.record({
      games: anyTeamGames,
      eventIndex: anyDayIndex,
      now: anyInstant,
    });
    fc.assert(
      fc.property(anyKnownInAdvance, ({ games, eventIndex, now }) => {
        const eventOn = dayOn(eventIndex);
        const attachment = attach(knownOn(eventOn), games, at(now));
        const fromItsDay = games.filter(({ gameDayOn }) => gameDayOn >= eventOn);
        const measured = measuredAfterAbsences(fromItsDay, attachment);

        expect(measured?.participation ?? 'played').toBe('played');
        expect(dayIndexOf(measured?.gameDayOn ?? eventOn)).toBeLessThanOrEqual(eventIndex + 10);
      }),
    );
  });

  it('[SEN-03] [CL-STA-09] gives the same attachment whatever the order of his team games', () => {
    const anyShuffled = anySituation.chain((situation) =>
      fc.record({
        situation: fc.constant(situation),
        shuffled: fc.shuffledSubarray(situation.games, { minLength: situation.games.length }),
      }),
    );
    fc.assert(
      fc.property(anyShuffled, ({ situation, shuffled }) => {
        const event = fromInstant(situation.reference, situation.sources);
        const evaluation = at(situation.now);

        expect(attach(event, shuffled, evaluation)).toStrictEqual(
          attach(event, situation.games, evaluation),
        );
      }),
    );
  });
});
