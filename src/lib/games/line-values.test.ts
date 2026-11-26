import { describe, expect, it } from 'vitest';

import { differencesOf, isPlayed, isUnchanged, valuesOf } from './line-values';

import type { BoxScoreRow } from './types';
import type { SourceBoxScore } from '@/lib/stats-source';

const COUNTS = {
  points: 21,
  fieldGoalsMade: 8,
  fieldGoalsAttempted: 17,
  threePointersMade: 2,
  freeThrowsMade: 3,
  freeThrowsAttempted: 4,
  offensiveRebounds: 1,
  defensiveRebounds: 6,
  assists: 5,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  personalFouls: 3,
} as const;
const ZERO_COUNTS: SourceBoxScore['counts'] = {
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  personalFouls: 0,
};
const LINE: SourceBoxScore = {
  game: 'g1',
  player: 'p01',
  team: '1',
  opponent: '6',
  isHome: true,
  didNotPlay: false,
  playingTime: { precision: 'whole_minutes', minutes: 50 },
  counts: COUNTS,
  ejected: null,
};
const TEAM_ID = 7;

/** The stored row of the line, as ingestion writes it. */
function rowOf(overtimeCount: number | null): BoxScoreRow {
  return {
    ...valuesOf(LINE, TEAM_ID, overtimeCount),
    id: 1,
    playerId: 'player',
    gameId: 1,
    statsSource: 'sportsdataverse_espn',
    fetchedAt: new Date(0),
  };
}

describe('the values of a source line', () => {
  it('[STA-08] tells a played line from a did-not-play line and from a line of zeros', () => {
    expect(isPlayed(LINE)).toBe(true);
    expect(isPlayed({ ...LINE, didNotPlay: true })).toBe(false);
    expect(isPlayed({ ...LINE, counts: ZERO_COUNTS, playingTime: null })).toBe(false);
    expect(isPlayed({ ...LINE, playingTime: { precision: 'whole_minutes', minutes: 0 } })).toBe(
      true,
    );
  });

  it('[STA-08] checks the minutes against the game overtimes, unknown overtimes skipping the bound', () => {
    expect(valuesOf(LINE, TEAM_ID, 0)).toMatchObject({
      status: 'suspect',
      failedChecks: ['minutes_above_game_length'],
      teamId: TEAM_ID,
      minutes: 50,
      seconds: null,
      hasRoundedMinutes: true,
    });
    expect(valuesOf(LINE, TEAM_ID, 1)).toMatchObject({ status: 'complete', failedChecks: [] });
    expect(valuesOf(LINE, TEAM_ID, null)).toMatchObject({ status: 'complete' });
  });

  it('[STA-33] lists each traced element that differs, an absent line reading as nulls', () => {
    const stored = rowOf(1);
    const next = valuesOf({ ...LINE, counts: { ...COUNTS, assists: 7 } }, TEAM_ID + 1, 1);

    expect(differencesOf(stored, next)).toStrictEqual([
      { element: 'team', oldValue: TEAM_ID, newValue: TEAM_ID + 1 },
      { element: 'assists', oldValue: 5, newValue: 7 },
    ]);
    expect(differencesOf(undefined, null)).toStrictEqual([]);
    expect(differencesOf(stored, null)).toHaveLength(15);
  });

  it('[STA-33] sees a change of status, mention or ejection that no traced element shows', () => {
    const stored = rowOf(0);

    expect(isUnchanged(stored, valuesOf(LINE, TEAM_ID, 0))).toBe(true);
    expect(isUnchanged(stored, valuesOf(LINE, TEAM_ID, 1))).toBe(false);
    expect(isUnchanged(stored, valuesOf({ ...LINE, ejected: true }, TEAM_ID, 0))).toBe(false);
    expect(isUnchanged(stored, { ...valuesOf(LINE, TEAM_ID, 0), sourcePlayerRef: 'p99' })).toBe(
      false,
    );
    expect(isUnchanged(stored, { ...valuesOf(LINE, TEAM_ID, 0), hasRoundedMinutes: false })).toBe(
      false,
    );
  });
});
