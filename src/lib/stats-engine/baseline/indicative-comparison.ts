// The indicative comparison of a measured game while its season baseline is building
// (STA-23, CL-STA-13, H-STA-09): its performance index against the final baseline of the
// player's most recent regular season that precedes the game, over all the usable games
// of that season, in units of that baseline's standard deviation. The result of a tracked
// game shows it, labeled indicative (SUI-20). It is never a case's normalized gap and
// enters no calculation: it carries no gap status, and nothing in the core reads it.

import { firstYearOf } from '../schedule/seasons';
import { seasonBaseline } from './season-baseline';

import type { PhaseState } from '../schedule/phase-state';
import type { GamePhase } from '../schedule/team-record';
import type { EngineParams, GameId } from '../types';
import type { BaselineGame, SeasonBaselineStatus } from './season-baseline';

/** One of the player's regular seasons that a measured game may be compared with (CL-STA-13). */
export type IndicativeSeason = Readonly<{
  /** The season, written `2024-25`. */
  season: string;
  /** His final team games of the season, of every phase, as seasonBaseline reads them. */
  games: readonly BaselineGame[];
  /** The league-wide state of the season's regular season (phaseState). */
  phaseState: PhaseState;
}>;

/** What an indicative comparison is made from (STA-23, CL-STA-13). */
export type IndicativeComparisonInput = Readonly<{
  /** The measured game: its season, written `2024-25`, its phase and its index. */
  measuredGame: Readonly<{
    gameId: GameId;
    season: string;
    phase: GamePhase;
    performanceIndex: number;
  }>;
  /** The status of the measured game's own baseline (seasonBaseline). */
  baselineStatus: SeasonBaselineStatus;
  /** His regular seasons, in any order, each once; those after the measured game are passed over. */
  seasons: readonly IndicativeSeason[];
}>;

/**
 * An indicative comparison (STA-23, SUI-20): the regular season it was made with, and the
 * measured game's index minus that season's mean index, divided by its standard
 * deviation, never rounded. It is always labeled indicative.
 */
export type IndicativeComparison = Readonly<{
  kind: 'indicative';
  season: string;
  indicativeGap: number;
}>;

type ComparedBaseline = Readonly<{ season: string; mean: number; standardDeviation: number }>;

/**
 * Whether the regular season `season` precedes the measured game (CL-STA-13): a season
 * before the game's own, or, for a play-in or playoff game, its own season too, whose
 * regular season is over by then.
 */
function isBeforeGame(
  season: string,
  measuredGame: IndicativeComparisonInput['measuredGame'],
): boolean {
  const seasonsBefore = firstYearOf(measuredGame.season) - firstYearOf(season);
  return measuredGame.phase === 'regular_season' ? seasonsBefore > 0 : seasonsBefore >= 0;
}

/**
 * The final regular-season baseline of the most recent of `input.seasons` that precedes
 * the measured game, over all its usable games, or null when none is final (CL-STA-13).
 */
function mostRecentFinalBaseline(
  input: IndicativeComparisonInput,
  params: EngineParams,
): ComparedBaseline | null {
  const { measuredGame } = input;
  const preceding = input.seasons
    .filter(({ season }) => isBeforeGame(season, measuredGame))
    .toSorted((left, right) => firstYearOf(right.season) - firstYearOf(left.season));
  for (const { season, games, phaseState } of preceding) {
    // The measured game is no game of an earlier regular season, so none is left out.
    const baseline = seasonBaseline(
      { games, phase: 'regular_season', excludedGameId: measuredGame.gameId, phaseState },
      params,
    );
    if (baseline.status === 'final') {
      return { season, mean: baseline.mean, standardDeviation: baseline.standardDeviation };
    }
  }
  return null;
}

/**
 * The indicative comparison of a measured game (STA-23, CL-STA-13, H-STA-09, SUI-20),
 * made only while its own baseline is building, and null otherwise or when no regular
 * season that precedes the game has a final baseline. It compares the game with the final
 * baseline of the most recent regular season that precedes it: for a play-in or playoff
 * game, the regular season of its own season once final, otherwise the one before; for a
 * regular-season game, the previous season's; a season whose baseline is not final is
 * passed over. That baseline averages all the usable games of its regular season. The
 * comparison is labeled indicative and is never stored as a case's normalized gap.
 */
export function indicativeComparison(
  input: IndicativeComparisonInput,
  params: EngineParams,
): IndicativeComparison | null {
  if (input.baselineStatus !== 'building') {
    return null;
  }
  const compared = mostRecentFinalBaseline(input, params);
  if (compared === null) {
    return null;
  }
  return {
    kind: 'indicative',
    season: compared.season,
    indicativeGap:
      (input.measuredGame.performanceIndex - compared.mean) / compared.standardDeviation,
  };
}
