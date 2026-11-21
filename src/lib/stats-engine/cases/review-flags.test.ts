import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { applyManualDecisions } from './manual-decisions';
import { caseReviewFlags } from './review-flags';

import type { TeamGame } from '../schedule/team-membership';
import type { ManualDecision } from './manual-decisions';
import type { ReviewFlag } from './review-flags';

const HOUR = 3_600_000;
// 19:30 in New York in winter, 00:30 UTC on the next day.
const TIP_OFF_AFTER_MIDNIGHT_UTC = 24.5 * HOUR;

// Two invented teams he plays for, and their opponents.
const OLD_TEAM = 11;
const NEW_TEAM = 12;
const OPPONENT = 30;

/** His team game `id` of `teamId`, final, on the US date `dayOn` at 19:30 New York time. */
function teamGame(id: number, dayOn: string, teamId: number): TeamGame {
  const [year = 0, month = 0, day = 0] = dayOn.split('-').map(Number);
  return {
    game: {
      id,
      phase: 'regular_season',
      status: 'final',
      homeTeamId: teamId,
      awayTeamId: OPPONENT,
      finalScore: { home: 104, away: 97 },
      scheduledStartAt: Date.UTC(year, month - 1, day) + TIP_OFF_AFTER_MIDNIGHT_UTC,
      homeLinesPublished: true,
      awayLinesPublished: true,
    },
    teamId,
    participation: 'played',
    minutes: 28,
  };
}

/** The game `played` as a game he did not play. */
const missed = (played: TeamGame): TeamGame => ({
  ...played,
  participation: 'not_played',
  minutes: null,
});

/** The game `played` before it is played: not final, his participation not known yet (CL-STA-04). */
const upcoming = (played: TeamGame): TeamGame => ({
  game: {
    ...played.game,
    status: 'scheduled',
    finalScore: null,
    homeLinesPublished: false,
    awayLinesPublished: false,
  },
  teamId: played.teamId,
  participation: null,
  minutes: null,
});

// His games of January 2024: two for his old team, then, after a trade, one for his new
// team that he missed, then two that he played for it.
const OLD_FIRST = teamGame(1, '2024-01-03', OLD_TEAM);
const OLD_LAST = teamGame(2, '2024-01-05', OLD_TEAM);
const NEW_MISSED = missed(teamGame(3, '2024-01-08', NEW_TEAM));
const NEW_FIRST = teamGame(4, '2024-01-10', NEW_TEAM);
const NEW_SECOND = teamGame(5, '2024-01-12', NEW_TEAM);
const TRADED = [OLD_FIRST, OLD_LAST, NEW_MISSED, NEW_FIRST, NEW_SECOND];

/** The decision `id` of `kind` on the game `measuredGameId`, made `id` hours into 2024. */
const decision = (
  id: number,
  kind: ManualDecision['kind'],
  measuredGameId: number,
): ManualDecision => ({ id, kind, decidedAt: Date.UTC(2024, 0, 1) + id * HOUR, measuredGameId });

/** What the source says of an ejection from the measured game, and the case's decisions. */
type CaseMarks = Readonly<{
  ejected?: boolean | null;
  decisions?: readonly ManualDecision[];
}>;

/** The review flags of a case on `measured`, among his team games `teamGames`. */
const flagsOf = (
  measured: TeamGame,
  teamGames: readonly TeamGame[],
  { ejected = null, decisions = [] }: CaseMarks = {},
): readonly ReviewFlag[] =>
  caseReviewFlags({ measuredGame: { id: measured.game.id, ejected }, teamGames, decisions });

describe('caseReviewFlags', () => {
  it("[SEN-16] [CL-SEN-11] flags the first game he played for a team other than his previous game's", () => {
    expect(flagsOf(NEW_FIRST, TRADED)).toStrictEqual(['first_game_with_new_team']);
  });

  it('[SEN-16] [CL-SEN-11] [CL-STA-05] compares with his previous game played, never with a game he missed', () => {
    expect(flagsOf(NEW_FIRST, [OLD_LAST, NEW_MISSED, NEW_FIRST])).toStrictEqual([
      'first_game_with_new_team',
    ]);
    expect(flagsOf(NEW_FIRST, [NEW_MISSED, NEW_FIRST])).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-11] flags it whatever the season: his previous game played was a season earlier', () => {
    const lastOfSeason = teamGame(6, '2023-04-09', OLD_TEAM);
    const opener = (teamId: number): TeamGame => teamGame(7, '2023-10-25', teamId);
    expect(flagsOf(opener(NEW_TEAM), [lastOfSeason, opener(NEW_TEAM)])).toStrictEqual([
      'first_game_with_new_team',
    ]);
    expect(flagsOf(opener(OLD_TEAM), [lastOfSeason, opener(OLD_TEAM)])).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-11] does not flag his second game for the new team, nor any game of his old team', () => {
    expect(flagsOf(NEW_SECOND, TRADED)).toStrictEqual([]);
    expect(flagsOf(OLD_LAST, TRADED)).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-11] flags his first game back with a team he played for before', () => {
    const back = teamGame(6, '2024-01-15', OLD_TEAM);
    expect(flagsOf(back, [...TRADED, back])).toStrictEqual(['first_game_with_new_team']);
  });

  it('[SEN-16] [CL-SEN-11] flags nothing on the first game he ever played, which follows no game', () => {
    expect(flagsOf(OLD_FIRST, TRADED)).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-11] flags nothing on a measured game he has not played: not final yet, or missed', () => {
    const next = upcoming(teamGame(6, '2024-01-15', NEW_TEAM));
    expect(flagsOf(next, [OLD_LAST, next])).toStrictEqual([]);
    expect(flagsOf(NEW_MISSED, TRADED)).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-11] [CL-SEN-12] flags nothing on a case whose walk reached no game', () => {
    const decisions = [decision(1, 'exclude', NEW_FIRST.game.id)];
    expect(caseReviewFlags({ measuredGame: null, teamGames: TRADED, decisions })).toStrictEqual([]);
  });

  it('[SEN-16] [CL-SEN-11] flags an ejection when the source reports one', () => {
    expect(flagsOf(NEW_SECOND, TRADED, { ejected: true })).toStrictEqual(['ejection']);
  });

  it.each([false, null])(
    '[SEN-16] [CL-SEN-11] never infers an ejection nor shows "not ejected": nothing when the source says %s',
    (ejected) => {
      const fewMinutes: TeamGame = { ...NEW_SECOND, minutes: 3 };
      expect(flagsOf(fewMinutes, [...TRADED.slice(0, -1), fewMinutes], { ejected })).toStrictEqual(
        [],
      );
    },
  );

  it('[CL-SEN-12] flags a manual decision to review once the measured game changed', () => {
    const decisions = [decision(1, 'exclude', NEW_FIRST.game.id)];
    expect(flagsOf(NEW_SECOND, TRADED, { decisions })).toStrictEqual(['manual_decision_to_review']);
  });

  it('[CL-SEN-12] flags it on a new measured game that blocks the walk, not played yet', () => {
    const next = upcoming(teamGame(6, '2024-01-15', NEW_TEAM));
    const decisions = [decision(1, 'exclude', NEW_SECOND.game.id)];
    expect(flagsOf(next, [...TRADED, next], { decisions })).toStrictEqual([
      'manual_decision_to_review',
    ]);
  });

  it('[CL-SEN-12] flags nothing once the owner decided again on the new game, nor without a decision', () => {
    const decisions = [
      decision(1, 'exclude', NEW_FIRST.game.id),
      decision(2, 'reinstate', NEW_SECOND.game.id),
    ];
    expect(flagsOf(NEW_SECOND, TRADED, { decisions: decisions.toReversed() })).toStrictEqual([]);
    expect(flagsOf(NEW_SECOND, TRADED)).toStrictEqual([]);
  });

  it('[CL-SEN-12] flags a case back on its first game while the latest decision was made on the other one', () => {
    const exclusion = decision(1, 'exclude', NEW_FIRST.game.id);
    const decisions = [exclusion, decision(2, 'reinstate', NEW_SECOND.game.id)];
    const caseItem = { status: 'measured', measuredGameId: NEW_FIRST.game.id } as const;
    expect(flagsOf(NEW_FIRST, TRADED, { decisions })).toStrictEqual([
      'first_game_with_new_team',
      'manual_decision_to_review',
    ]);
    expect(applyManualDecisions(caseItem, decisions)).toStrictEqual({
      status: 'excluded',
      decision: exclusion,
    });
  });

  it('[SEN-16] [CL-SEN-11] [CL-SEN-12] lists every flag that holds, in the order of the glossary', () => {
    const decisions = [decision(1, 'reinstate', OLD_LAST.game.id)];
    expect(flagsOf(NEW_FIRST, TRADED, { ejected: true, decisions })).toStrictEqual([
      'first_game_with_new_team',
      'ejection',
      'manual_decision_to_review',
    ]);
  });

  it('[SEN-16] [CL-SEN-11] [CL-SEN-12] excludes nothing: a case flagged for every reason keeps the status of its criteria', () => {
    const decisions = [decision(1, 'exclude', OLD_LAST.game.id)];
    const caseItem = { status: 'measured', measuredGameId: NEW_FIRST.game.id } as const;
    expect(flagsOf(NEW_FIRST, TRADED, { ejected: true, decisions })).toHaveLength(3);
    expect(applyManualDecisions(caseItem, decisions)).toStrictEqual({
      status: 'measured',
      decision: null,
    });
  });
});

// His January games, with two games at one scheduled start, one for each team, so that
// only their ids order them, and a shuffled copy.
const SAME_START_OLD = teamGame(8, '2024-01-07', OLD_TEAM);
const SAME_START_NEW = teamGame(9, '2024-01-07', NEW_TEAM);
const WITH_TIE = [...TRADED, SAME_START_OLD, SAME_START_NEW];
const anyOrder = fc.shuffledSubarray(WITH_TIE, {
  minLength: WITH_TIE.length,
  maxLength: WITH_TIE.length,
});

describe('caseReviewFlags, whatever the order of his team games', () => {
  it('[SEN-16] [CL-SEN-11] [CL-STA-09] reads his games in the fixed order of scheduled start, then id', () => {
    fc.assert(
      fc.property(anyOrder, (teamGames) => {
        expect(flagsOf(SAME_START_NEW, teamGames)).toStrictEqual(['first_game_with_new_team']);
        expect(flagsOf(NEW_FIRST, teamGames)).toStrictEqual([]);
        expect(flagsOf(OLD_LAST, teamGames)).toStrictEqual([]);
      }),
    );
  });
});
