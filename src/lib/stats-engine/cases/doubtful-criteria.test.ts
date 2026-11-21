import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { doubtfulCaseCriteria } from './doubtful-criteria';
import { attachToMeasuredGame } from '../measured-game/attachment';

import type { ContextIndications, DoubtfulCaseCriteriaInput as Input } from './doubtful-criteria';
import type { Attachment, AttachmentEvent } from '../measured-game/attachment';
import type { Participation } from '../performance/participation';
import type { TeamGame } from '../schedule/team-membership';
import type { GamePhase, ScheduleGame } from '../schedule/team-record';
import type { EngineParams } from '../types';

// The registry's defaults. For a return from injury, a run of 4 team games missed, then the
// first 2 games played (SEN-13); for the opponent, shares of 25 % and 75 % of at least 10
// games (SEN-15); neither co-occurrence nor every playoff game doubtful (SEN-06, SEN-14),
// all held once in data/fixtures/stats-engine/engine-params.json. JSON gives the
// baseline phase as a string, which the comparison narrows to a BaselinePhase (types.test.ts).
const PARAMS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

const withSensitivity = (sensitivity: Partial<EngineParams['sensitivity']>): EngineParams => ({
  ...PARAMS,
  sensitivity: { ...PARAMS.sensitivity, ...sensitivity },
});
const CO_OCCURRING_ON = withSensitivity({ coOccurringCasesDoubtful: true });

const HIS_TEAM = 1;
const OPPONENT = 2;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// His first game of the season, at 19:30 New York time on 2 January 2025, then one game
// every other day: the games of the examples are all played in winter time.
const FIRST_GAME = 1_735_864_200_000;

type Played = Participation | null;
type Overrides = Partial<Input>;

/** His team game `index` of the season, its id one more, at home against the opponent. */
function teamGame(index: number, participation: Played, minutes = 30): TeamGame {
  const isFinal = participation !== null;
  return {
    game: {
      id: index + 1,
      phase: 'regular_season',
      status: isFinal ? 'final' : 'scheduled',
      homeTeamId: HIS_TEAM,
      awayTeamId: OPPONENT,
      finalScore: isFinal ? { home: 101, away: 99 } : null,
      scheduledStartAt: FIRST_GAME + 2 * index * DAY,
      homeLinesPublished: isFinal && participation !== 'unknown',
      awayLinesPublished: isFinal,
    },
    teamId: HIS_TEAM,
    participation,
    minutes: participation === 'played' ? minutes : null,
  };
}

const teamGames = (participations: readonly Played[], from = 0): TeamGame[] =>
  participations.map((participation, offset) => teamGame(from + offset, participation));
const times = (participation: Played, count: number): Played[] =>
  Array.from({ length: count }, () => participation);
const TEN_PLAYED = times('played', 10);

/** Final regular-season games of the opponent against a third team: `wins` won, then `losses` lost. */
function resultsOf(wins: number, losses: number, firstId = 1000): ScheduleGame[] {
  return Array.from({ length: wins + losses }, (_, index) => ({
    id: firstId + index,
    phase: 'regular_season',
    status: 'final',
    homeTeamId: OPPONENT,
    awayTeamId: 3,
    finalScore: { home: index < wins ? 110 : 100, away: 105 },
  }));
}

/** The case of `measured`, among his team games `season`; by default no criterion applies to it. */
function caseOf(season: readonly TeamGame[], measured: TeamGame, overrides: Overrides = {}): Input {
  const { id, scheduledStartAt, phase } = measured.game;
  return {
    measuredGame: {
      game: { id, scheduledStartAt, phase, homeTeamId: HIS_TEAM, awayTeamId: OPPONENT },
      teamId: HIS_TEAM,
      minutes: measured.minutes ?? 0,
      isEliminationGame: null,
    },
    seasonTeamGames: season,
    playingTimeThresholdMinutes: 17.5,
    // The opponent at half its other games, and the measured game, which it lost.
    seasonSchedule: [...resultsOf(41, 41), measured.game],
    previousSeasonSchedule: [],
    contextIndications: [{ injuryReturn: 'unknown', gameStakes: 'unknown' }],
    coOccurringTypeIds: [],
    switchedOffCriterion: null,
    ...overrides,
  };
}

/**
 * The case of the game he plays for 30 minutes right after his team games `before`, from
 * the first of the season, and before two games he misses, one of them without a box score.
 */
function caseAfter(before: readonly Played[], overrides: Overrides = {}): Input {
  const measured = teamGame(before.length, 'played');
  const later = teamGames(['not_played', 'unknown'], before.length + 1);
  return caseOf([...teamGames(before), measured, ...later], measured, overrides);
}

const BASE = caseAfter(TEN_PLAYED);
const BASE_MEASURED = teamGame(TEN_PLAYED.length, 'played');
/** The schedule of BASE's season: the opponent at `wins`–`losses`, and the measured game, which it lost. */
const seasonWith = (wins: number, losses: number): ScheduleGame[] => [
  ...resultsOf(wins, losses),
  BASE_MEASURED.game,
];

/** BASE, its measured game moved to `phase`, with the elimination flag `flag`. */
function inPhase(phase: GamePhase, flag: boolean | null, overrides: Overrides = {}): Input {
  const game = { ...BASE.measuredGame.game, phase };
  return {
    ...BASE,
    measuredGame: { ...BASE.measuredGame, game, isEliminationGame: flag },
    ...overrides,
  };
}

const criteria = (input: Input, params = PARAMS): unknown => doubtfulCaseCriteria(input, params);
const triggeredOf = (input: Input, params = PARAMS): unknown =>
  doubtfulCaseCriteria(input, params).triggeredCriteria;

/** A triggered criterion as the criteria list it. */
type Entry = Readonly<{ criterion: string; condition: string | null; triggeringValues: object }>;
const met = (criterion: string, condition: string | null, triggeringValues: object): Entry => ({
  criterion,
  condition,
  triggeringValues,
});
const tooLow = (minutes: number, threshold: number): Entry =>
  met('playing_time_too_low', null, { minutes, threshold });
const FLAGGED_RETURN = met('injury_return', 'flagged', { injuryReturn: 'yes' });
const returnAfter = (runLength: number, gamesWithoutBoxScore = 0): Entry =>
  met('injury_return', 'calculated', { runLength, gamesWithoutBoxScore });
const FLAGGED_STAKES = met('unusual_stakes', 'flagged', { gameStakes: 'high' });
const PLAY_IN_STAKES = met('unusual_stakes', 'calculated', { phase: 'play_in' });
const playoffStakes = (isEliminationGame: boolean | null): Entry =>
  met('unusual_stakes', 'calculated', { phase: 'playoffs', isEliminationGame });
const opponentAt = (wins: number, losses: number, isPreviousSeason = false): Entry =>
  met('opponent_strength', null, { wins, losses, isPreviousSeason });
const coOccurringWith = (...coOccurringTypeIds: string[]): Entry =>
  met('co_occurring', null, { coOccurringTypeIds });

type Notices = Partial<Record<'opponentStrengthNotEvaluable' | 'stakesNotEvaluable', boolean>>;
/** What the criteria give: `entries`, and the notices that `notices` sets. */
const result = (entries: readonly Entry[], notices: Notices = {}): object => ({
  triggeredCriteria: entries,
  opponentStrengthNotEvaluable: false,
  stakesNotEvaluable: false,
  ...notices,
});

const indications = (
  injuryReturn: ContextIndications['injuryReturn'],
  gameStakes: ContextIndications['gameStakes'] = 'unknown',
): ContextIndications => ({ injuryReturn, gameStakes });

/** The attachment of an event that became public an hour after the tip-off of his game `index`. */
function attachAfterGame(index: number, season: readonly TeamGame[]): Attachment {
  // In winter time, the US date of a 19:30 tip-off, and the end of that date in Pacific time.
  const games = season.map((item) => ({
    ...item,
    gameDayOn: new Date(item.game.scheduledStartAt - 5 * HOUR).toISOString().slice(0, 10),
    endOfDayPacificAt: item.game.scheduledStartAt + 7.5 * HOUR,
    isBoxScoreUnavailable: false,
  }));
  const event: AttachmentEvent = {
    kind: 'reference_instant',
    referenceInstantAt: FIRST_GAME + 2 * index * DAY + HOUR,
    referenceInstantOrigin: 'known_instant',
    sources: null,
  };
  const context = { games, now: FIRST_GAME + 365 * DAY, nowGameDayOn: '2026-01-02' };
  return attachToMeasuredGame(event, context, PARAMS);
}

/** The criteria of BASE when he plays `minutes` in a season of playing-time threshold `threshold`. */
const playingTime = (minutes: number, threshold: number): unknown =>
  triggeredOf({
    ...BASE,
    measuredGame: { ...BASE.measuredGame, minutes },
    playingTimeThresholdMinutes: threshold,
  });

/** The criteria of the game he plays after five games missed, then `played` games played. */
const playedAfterRun = (played: number): unknown =>
  triggeredOf(caseAfter([...TEN_PLAYED, ...times('not_played', 5), ...times('played', played)]));

/** The criteria of the case after `before` whose events say `values` of a return from injury. */
const flaggedReturn = (
  values: readonly ContextIndications['injuryReturn'][],
  before = TEN_PLAYED,
): unknown => {
  const contextIndications = values.map((value) => indications(value));
  return triggeredOf(caseAfter(before, { contextIndications }));
};

/** The criteria of `input` whose events say `values` of the game stakes. */
const flaggedStakes = (
  values: readonly ContextIndications['gameStakes'][],
  input = BASE,
): unknown =>
  triggeredOf({ ...input, contextIndications: values.map((value) => indications('no', value)) });

describe('doubtfulCaseCriteria: playing time too low', () => {
  it('[CA-SEN-05] [SEN-12] [SEN-03] excludes for playing time the 14 minutes he plays right after the event, under the 17.5-minute threshold of his 35-minute average, and never measures the next game instead', () => {
    const before = Array.from({ length: 20 }, (_, index) => teamGame(index, 'played', 36));
    const measured = teamGame(20, 'played', 14);
    const season = [...before, measured, teamGame(21, 'played', 36)];

    expect(attachAfterGame(19, season)).toMatchObject({ status: 'attached', measuredGameId: 21 });
    expect(criteria(caseOf(season, measured))).toStrictEqual(result([tooLow(14, 17.5)]));
  });

  it('[SEN-12] [CL-STA-06] finds the playing time too low only below the threshold, whole minutes that reach it being enough', () => {
    expect(playingTime(17, 17.5)).toStrictEqual([tooLow(17, 17.5)]);
    expect(playingTime(17.5, 17.5)).toStrictEqual([]);
    expect(playingTime(14, 15)).toStrictEqual([tooLow(14, 15)]);
    expect(playingTime(15, 15)).toStrictEqual([]);
  });
});

describe('doubtfulCaseCriteria: return from injury', () => {
  it('[CA-SEN-03] [SEN-13] [SEN-03] measures the third game after the event without a return from injury after two games missed, and excludes his return after five', () => {
    const measured = teamGame(12, 'played');
    const twoMissed = [...teamGames(TEN_PLAYED), ...teamGames(times('not_played', 2), 10)];
    const fiveMissed = [...teamGames(times('played', 7)), ...teamGames(times('not_played', 5), 7)];

    expect(attachAfterGame(9, [...twoMissed, measured])).toMatchObject({
      measuredGameId: 13,
      absences: [11, 12],
    });
    expect(triggeredOf(caseOf([...twoMissed, measured], measured))).toStrictEqual([]);
    expect(attachAfterGame(9, [...fiveMissed, measured])).toMatchObject({ measuredGameId: 13 });
    expect(triggeredOf(caseOf([...fiveMissed, measured], measured))).toStrictEqual([
      returnAfter(5),
    ]);
  });

  it('[SEN-13] [CL-SEN-09] [CL-STA-04] counts the games of unknown participation as missed, and says how many games of the run had no box score', () => {
    const input = caseAfter([...TEN_PLAYED, 'unknown', 'not_played', 'unknown', 'not_played']);

    expect(triggeredOf(input)).toStrictEqual([returnAfter(4, 2)]);
  });

  it('[SEN-13] [CL-SEN-09] retains the first two games he plays after a run of games missed, and not the third', () => {
    expect(playedAfterRun(0)).toStrictEqual([returnAfter(5)]);
    expect(playedAfterRun(1)).toStrictEqual([returnAfter(5)]);
    expect(playedAfterRun(2)).toStrictEqual([]);
  });

  it('[SEN-13] [CL-SEN-09] needs four games missed in a row, counted from the first game of the season, and none after the measured game', () => {
    const twoMissed = times('not_played', 2);
    const fromOpeningNight = caseAfter(times('not_played', 4));
    const shorter = caseAfter(times('not_played', 3));

    expect(triggeredOf(fromOpeningNight)).toStrictEqual([returnAfter(4)]);
    expect(triggeredOf(shorter)).toStrictEqual([]);
    expect(
      triggeredOf(caseAfter([...TEN_PLAYED, ...twoMissed, 'played', ...twoMissed])),
    ).toStrictEqual([]);
  });

  it('[SEN-13] [CL-SEN-09] counts a team game not final yet neither as played nor as missed', () => {
    const missed = times('not_played', 2);

    expect(triggeredOf(caseAfter([...TEN_PLAYED, ...missed, null, 'not_played']))).toStrictEqual(
      [],
    );
    expect(triggeredOf(caseAfter([...TEN_PLAYED, ...missed, null, ...missed]))).toStrictEqual([
      returnAfter(4),
    ]);
  });

  it('[SEN-13] [CL-SEN-28] flags a return from injury as soon as one event of the case says yes, never on no or unknown, and before the calculated condition', () => {
    expect(flaggedReturn(['yes'])).toStrictEqual([FLAGGED_RETURN]);
    expect(flaggedReturn(['no', 'unknown', 'yes'])).toStrictEqual([FLAGGED_RETURN]);
    expect(flaggedReturn(['no', 'unknown'])).toStrictEqual([]);
    expect(flaggedReturn(['yes'], [...TEN_PLAYED, ...times('unknown', 6)])).toStrictEqual([
      FLAGGED_RETURN,
      returnAfter(6, 6),
    ]);
  });
});

describe('doubtfulCaseCriteria: unusual stakes', () => {
  it('[CA-SEN-08] [SEN-14] excludes Game 6 of a series that his team trails 2–3, whose loss eliminates it, and not Game 3 at one win apiece without a flag', () => {
    const tied = inPhase('playoffs', false, { contextIndications: [indications('no', 'normal')] });

    expect(criteria(inPhase('playoffs', true))).toStrictEqual(result([playoffStakes(true)]));
    expect(criteria(tied)).toStrictEqual(result([]));
  });

  it.each([null, false, true])(
    '[SEN-14] [CL-STA-18] always retains a play-in game for unusual stakes, its elimination flag %s',
    (isEliminationGame) => {
      expect(criteria(inPhase('play_in', isEliminationGame))).toStrictEqual(
        result([PLAY_IN_STAKES]),
      );
    },
  );

  it('[SEN-14] [CL-SEN-10] [CL-STA-18] notes that the stakes of a playoff game with an unknown elimination flag cannot be evaluated, and still retains a flagged high', () => {
    const high = { contextIndications: [indications('unknown', 'high')] };

    expect(criteria(inPhase('playoffs', null))).toStrictEqual(
      result([], { stakesNotEvaluable: true }),
    );
    expect(criteria(inPhase('playoffs', null, high))).toStrictEqual(
      result([FLAGGED_STAKES], { stakesNotEvaluable: true }),
    );
  });

  it('[SEN-14] treats every playoff game, and no regular-season game, as unusual stakes with sensitivity.allPlayoffGamesUnusualStakes', () => {
    const allPlayoffGames = withSensitivity({ allPlayoffGamesUnusualStakes: true });

    expect(criteria(inPhase('playoffs', false), allPlayoffGames)).toStrictEqual(
      result([playoffStakes(false)]),
    );
    expect(criteria(inPhase('playoffs', null), allPlayoffGames)).toStrictEqual(
      result([playoffStakes(null)]),
    );
    expect(criteria(BASE, allPlayoffGames)).toStrictEqual(result([]));
  });

  it('[SEN-14] [CL-SEN-28] flags unusual stakes as soon as one event says high, in any phase, never on normal or unknown, and before the calculated condition', () => {
    expect(flaggedStakes(['normal', 'high'])).toStrictEqual([FLAGGED_STAKES]);
    expect(flaggedStakes(['normal', 'unknown'])).toStrictEqual([]);
    expect(flaggedStakes(['high'], inPhase('playoffs', true))).toStrictEqual([
      FLAGGED_STAKES,
      playoffStakes(true),
    ]);
  });
});

describe('doubtfulCaseCriteria: opponent strength', () => {
  it('[CA-SEN-09] [SEN-15] [STA-06] excludes a case whose opponent won 18 and lost 58 of its regular-season games without the measured game', () => {
    expect(criteria({ ...BASE, seasonSchedule: seasonWith(18, 58) })).toStrictEqual(
      result([opponentAt(18, 58)]),
    );
  });

  it('[SEN-15] [CL-SEN-10] [CL-STA-19] judges an opponent with fewer than 10 final regular-season games so far on its whole previous regular season, and one without any on nothing', () => {
    const toPlay = resultsOf(0, 3, 2000).map((game): ScheduleGame => ({
      ...game,
      status: 'scheduled',
      finalScore: null,
    }));
    const playoffs = resultsOf(4, 0, 2100).map((game): ScheduleGame => ({
      ...game,
      phase: 'playoffs',
    }));
    const nineGames = { ...BASE, seasonSchedule: [...seasonWith(2, 7), ...toPlay, ...playoffs] };

    expect(
      triggeredOf({ ...nineGames, previousSeasonSchedule: resultsOf(18, 58, 3000) }),
    ).toStrictEqual([opponentAt(18, 58, true)]);
    expect(criteria(nineGames)).toStrictEqual(result([], { opponentStrengthNotEvaluable: true }));
  });

  it('[SEN-15] [CL-SEN-10] judges an opponent on a previous regular season of even one or two final games, which sensitivity.opponentMinGames does not concern', () => {
    const nineGames = { ...BASE, seasonSchedule: seasonWith(2, 7) };

    expect(criteria({ ...nineGames, previousSeasonSchedule: resultsOf(1, 0, 3000) })).toStrictEqual(
      result([opponentAt(1, 0, true)]),
    );
    expect(criteria({ ...nineGames, previousSeasonSchedule: resultsOf(1, 1, 3000) })).toStrictEqual(
      result([]),
    );
  });

  it('[SEN-15] [CL-SEN-10] judges an opponent on its own season from sensitivity.opponentMinGames games on', () => {
    const previousSeasonSchedule = resultsOf(41, 41, 3000);
    const tenGames = { ...BASE, seasonSchedule: seasonWith(1, 9), previousSeasonSchedule };

    expect(triggeredOf(tenGames)).toStrictEqual([opponentAt(1, 9)]);
    expect(triggeredOf(tenGames, withSensitivity({ opponentMinGames: 11 }))).toStrictEqual([]);
  });

  it('[SEN-15] [CL-SEN-10] judges the opponent of a playoff game, and the home team when his team plays away, on the regular season', () => {
    const { measuredGame } = BASE;
    const away = { ...measuredGame.game, homeTeamId: OPPONENT, awayTeamId: HIS_TEAM };
    const seasonSchedule = seasonWith(18, 58);

    expect(triggeredOf({ ...inPhase('playoffs', false), seasonSchedule })).toStrictEqual([
      opponentAt(18, 58),
    ]);
    expect(
      triggeredOf({ ...BASE, measuredGame: { ...measuredGame, game: away }, seasonSchedule }),
    ).toStrictEqual([opponentAt(18, 58)]);
  });

  // At shares of 30 % and 60 %, the defaults (25 % and 75 %) and the mirror of either share
  // (100 % less the other one) each judge one of these records otherwise; the records at
  // exactly 30 % and 60 % are not retained.
  it.each([
    { wins: 7, losses: 18, judged: 'retained' },
    { wins: 3, losses: 7, judged: 'not retained' },
    { wins: 6, losses: 4, judged: 'not retained' },
    { wins: 13, losses: 7, judged: 'retained' },
  ])(
    '[SEN-15] [CL-SEN-10] compares an opponent at $wins–$losses with sensitivity.opponentWinShareLow and sensitivity.opponentWinShareHigh, each strictly: $judged at 30 % and 60 %',
    ({ wins, losses, judged }) => {
      const shares = withSensitivity({ opponentWinShareLow: 30, opponentWinShareHigh: 60 });
      const input = { ...BASE, seasonSchedule: seasonWith(wins, losses) };
      const expected = judged === 'retained' ? [opponentAt(wins, losses)] : [];

      expect(triggeredOf(input, shares)).toStrictEqual(expected);
    },
  );

  it('[SEN-15] [CL-SEN-10] retains the opponent strength exactly when its share of wins without the measured game is strictly below sensitivity.opponentWinShareLow or above sensitivity.opponentWinShareHigh, whatever their values', () => {
    // Both shares over the registry's ranges, and a record either at exactly one of them or
    // of any 10 games or more. A record at exactly a share is not retained.
    const anyOpponent = fc.record({
      low: fc.integer({ min: 0, max: 49 }),
      high: fc.integer({ min: 51, max: 100 }),
      atShare: fc.constantFrom('low', 'high', null),
      record: fc
        .record({ wins: fc.nat({ max: 82 }), losses: fc.nat({ max: 82 }) })
        .filter(({ wins, losses }) => wins + losses >= 10),
    });
    fc.assert(
      fc.property(anyOpponent, ({ low, high, atShare, record }) => {
        const shares = { low, high };
        // In 100 games, every whole percentage is a whole number of wins.
        const { wins, losses } =
          atShare === null ? record : { wins: shares[atShare], losses: 100 - shares[atShare] };
        const share = (100 * wins) / (wins + losses);
        const expected = share < low || share > high ? [opponentAt(wins, losses)] : [];
        const params = withSensitivity({ opponentWinShareLow: low, opponentWinShareHigh: high });

        expect(
          triggeredOf({ ...BASE, seasonSchedule: seasonWith(wins, losses) }, params),
        ).toStrictEqual(expected);
      }),
    );
  });
});

// Every automatic criterion applies to this case, whose stakes cannot be evaluated: a
// playoff game with an unknown elimination flag, flagged high (SEN-11).
const missedFive = caseAfter([...TEN_PLAYED, ...times('not_played', 5)]);
const EVERYTHING: Input = {
  ...missedFive,
  measuredGame: {
    ...missedFive.measuredGame,
    game: { ...missedFive.measuredGame.game, phase: 'playoffs' },
    minutes: 10,
  },
  seasonSchedule: resultsOf(18, 58),
  contextIndications: [indications('yes', 'high')],
  coOccurringTypeIds: ['media-storm'],
};
const EVERY_CRITERION = [
  tooLow(10, 17.5),
  FLAGGED_RETURN,
  returnAfter(5),
  FLAGGED_STAKES,
  opponentAt(18, 58),
  coOccurringWith('media-storm'),
];
const AUTOMATIC_CRITERIA = [
  'playing_time_too_low',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'co_occurring',
] as const;

describe('doubtfulCaseCriteria: the criteria of a case', () => {
  it('[SEN-06] [SEN-11] retains a co-occurring case, with the other types on its game, only while sensitivity.coOccurringCasesDoubtful is on', () => {
    const coOccurring = { ...BASE, coOccurringTypeIds: ['media-storm', 'birthday'] };

    expect(triggeredOf(coOccurring)).toStrictEqual([]);
    expect(triggeredOf(coOccurring, CO_OCCURRING_ON)).toStrictEqual([
      coOccurringWith('media-storm', 'birthday'),
    ]);
    expect(triggeredOf(BASE, CO_OCCURRING_ON)).toStrictEqual([]);
  });

  it('[SEN-11] lists every criterion that applies with the values that trigger it, in the order of the glossary', () => {
    expect(criteria(EVERYTHING, CO_OCCURRING_ON)).toStrictEqual(
      result(EVERY_CRITERION, { stakesNotEvaluable: true }),
    );
  });

  it.each(AUTOMATIC_CRITERIA)(
    '[SEN-11] [CL-SEN-13] never evaluates %s once the type switches it off, and still applies every other criterion',
    (criterion) => {
      const remaining = EVERY_CRITERION.filter((entry) => entry.criterion !== criterion);
      const notices = { stakesNotEvaluable: criterion !== 'unusual_stakes' };

      expect(
        criteria({ ...EVERYTHING, switchedOffCriterion: criterion }, CO_OCCURRING_ON),
      ).toStrictEqual(result(remaining, notices));
    },
  );

  it('[SEN-11] [CL-SEN-13] notes nothing of a criterion that the type switches off', () => {
    const neither = inPhase('playoffs', null, { seasonSchedule: seasonWith(2, 7) });

    expect(criteria(neither)).toStrictEqual(
      result([], { opponentStrengthNotEvaluable: true, stakesNotEvaluable: true }),
    );
    expect(criteria({ ...neither, switchedOffCriterion: 'opponent_strength' })).toStrictEqual(
      result([], { stakesNotEvaluable: true }),
    );
    expect(criteria({ ...neither, switchedOffCriterion: 'unusual_stakes' })).toStrictEqual(
      result([], { opponentStrengthNotEvaluable: true }),
    );
  });
});

/**
 * The calculated return from injury counted forward, as SEN-13 words it: the latest run of
 * at least `minGames` games missed in a row, a game not final skipped, when the game he
 * plays after `before` is among the first `firstGames` games he played after that run.
 */
function forwardReturn(before: readonly Played[], minGames: number, firstGames: number): Entry[] {
  const games = [...before.filter((value) => value !== null), 'played'];
  // The games he played, in order, the measured game last, and the run of games he missed
  // that each of them ends.
  const played = games.map((_, index) => index).filter((index) => games[index] === 'played');
  const runs = played.map((index, rank) => games.slice((played[rank - 1] ?? -1) + 1, index));
  const latest = runs.findLastIndex((run) => run.length >= minGames);
  const run = runs[latest] ?? [];
  const withoutBoxScore = run.filter((value) => value === 'unknown').length;
  return latest !== -1 && played.length - latest <= firstGames
    ? [returnAfter(run.length, withoutBoxScore)]
    : [];
}

const anySeason = fc.record({
  before: fc.array(fc.constantFrom<Played>('played', 'not_played', 'not_played', 'unknown', null), {
    maxLength: 40,
    size: 'medium',
  }),
  minGames: fc.integer({ min: 1, max: 6 }),
  firstGames: fc.integer({ min: 1, max: 4 }),
  shuffle: fc.integer({ min: 1, max: 100 }),
});
// A prime above every game id: multiplying the ids by a number below it, modulo it, gives
// another order of the games.
const SHUFFLE_PRIME = 101;

describe('doubtfulCaseCriteria over any season', () => {
  it('[SEN-13] [CL-SEN-09] [CL-STA-09] retains a calculated return exactly when, counted forward, the measured game is among the first games he played after a long enough run, whatever the order of his team games', () => {
    fc.assert(
      fc.property(anySeason, ({ before, minGames, firstGames, shuffle }) => {
        const input = caseAfter(before);
        const rank = ({ game }: Input['seasonTeamGames'][number]): number =>
          (game.id * shuffle) % SHUFFLE_PRIME;
        const seasonTeamGames = input.seasonTeamGames.toSorted(
          (left, right) => rank(left) - rank(right),
        );
        const params = withSensitivity({
          injuryReturnMinGamesMissed: minGames,
          injuryReturnFirstGames: firstGames,
        });

        expect(triggeredOf({ ...input, seasonTeamGames }, params)).toStrictEqual(
          forwardReturn(before, minGames, firstGames),
        );
      }),
    );
  });

  it("[SEN-11] [VUE-03] reads nothing of the measured game's result: any final score gives the same criteria", () => {
    fc.assert(
      fc.property(fc.nat({ max: 160 }), fc.nat({ max: 160 }), (home, away) => {
        const game = { ...teamGame(TEN_PLAYED.length, 'played').game, finalScore: { home, away } };
        // The opponent at exactly 25 % of its other games.
        const seasonSchedule = [...resultsOf(19, 57), game];

        expect(criteria({ ...BASE, seasonSchedule })).toStrictEqual(result([]));
      }),
    );
  });
});
