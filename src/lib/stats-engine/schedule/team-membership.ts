// A player's team membership and his team games (STA-27, CL-STA-05): a team's official
// game is one of his team games when he belongs to that team at its scheduled start. His
// membership comes from his own box-score lines and from his team history (players.md
// section 1.4), never from the season player directory (CL-JOU-18) nor from his current
// team (STA-25), so that it judges a past game and his next game alike (CL-STA-25). The
// team games feed the attachment walk (SEN-03), the absence counts (STA-46, SEN-13) and
// the calendar derivation (CL-TAX-18).

import { byScheduledStart, isCounted } from './series';
import { hasTeam } from './team-record';
import { verifyBoxScore } from '../performance/box-score';
import { participationOf } from '../performance/participation';

import type { BoxScoreLine } from '../performance/box-score';
import type { Participation } from '../performance/participation';
import type { EpochMs, GameId, TeamId } from '../types';
import type { ScheduleGame } from './team-record';

/**
 * One of his box-score lines (STA-08): its game, that game's scheduled start, and the
 * team he played for, under its id that survives a relocation (CL-JOU-18).
 */
export type PlayerLine = Readonly<{
  gameId: GameId;
  scheduledStartAt: EpochMs;
  teamId: TeamId;
  line: BoxScoreLine;
}>;

/**
 * A row of his team history (JOU-13, players.md section 1.4): `observed`, from a game he
 * played or from the source's current-season player file, or `entered` by the owner, the
 * row of his addition included, whose origin turns `observed` when the player file gives
 * the team chosen; the team he belongs to from `changedAt` on, null for a release.
 */
export type PlayerTeamChange = Readonly<{
  id: number;
  changedAt: EpochMs;
  newTeamId: TeamId | null;
  origin: 'entered' | 'observed';
}>;

/**
 * A period during which he belonged to one team (CL-STA-05): from an instant, included,
 * until another, excluded, or null while it lasts.
 */
export type TeamStint = Readonly<{ teamId: TeamId; from: EpochMs; until: EpochMs | null }>;

/**
 * A game of the stored schedule, with its scheduled start and, for each of its teams,
 * whether the source has published that team's player lines (CL-STA-04).
 */
export type LinesGame = ScheduleGame &
  Readonly<{ scheduledStartAt: EpochMs; homeLinesPublished: boolean; awayLinesPublished: boolean }>;

/**
 * One of his team games (STA-27): the game; the team he belonged to at its start; his
 * participation once the game is final, null before (CL-STA-04); and his decimal minutes
 * when he played it with a time on court above zero, null otherwise (STA-12).
 */
export type TeamGame = Readonly<{
  game: LinesGame;
  teamId: TeamId;
  participation: Participation | null;
  minutes: number | null;
}>;

/** A fact of the membership walk: a game he played, or a row of his team history. */
type Evidence = Readonly<{
  kind: 'played' | PlayerTeamChange['origin'];
  at: EpochMs;
  id: number;
  teamId: TeamId | null;
}>;

/** From `at` on, he belongs to `teamId`, or to no team when it is null. */
type Switch = Readonly<{ at: EpochMs; teamId: TeamId | null }>;

// At one instant, the game he played comes before the rows of his history, so that a
// game at the very instant of an entry is not "after" it.
const RANK_AT_ONE_INSTANT: Readonly<Record<Evidence['kind'], number>> = {
  played: 0,
  entered: 1,
  observed: 1,
};

/** Whether he played the game of `line` (CL-STA-04). */
function isPlayed({ line }: PlayerLine): boolean {
  // His own line is one of his team's lines, so they are published: he played unless
  // the line says he did not.
  return participationOf(line, true) !== 'not_played';
}

/** By instant, the games he played first at one instant, then by game or row id (CL-STA-09). */
function inWalkOrder(left: Evidence, right: Evidence): number {
  if (left.at !== right.at) {
    return left.at - right.at;
  }
  const byRank = RANK_AT_ONE_INSTANT[left.kind] - RANK_AT_ONE_INSTANT[right.kind];
  return byRank === 0 ? left.id - right.id : byRank;
}

function evidenceOf(
  lines: readonly PlayerLine[],
  history: readonly PlayerTeamChange[],
): readonly Evidence[] {
  const played = lines.filter((line) => isPlayed(line));
  return [
    ...played.map(({ gameId, scheduledStartAt, teamId }) => ({
      kind: 'played' as const,
      at: scheduledStartAt,
      id: gameId,
      teamId,
    })),
    ...history.map(({ id, changedAt, newTeamId, origin }) => ({
      kind: origin,
      at: changedAt,
      id,
      teamId: newTeamId,
    })),
  ].toSorted(inWalkOrder);
}

function teamAfter(switches: readonly Switch[]): TeamId | null {
  return switches.at(-1)?.teamId ?? null;
}

/**
 * His switches once he belongs to `teamId` from `at` on: of two changes at one instant
 * the later stands, and a change to the team he belongs to changes nothing.
 */
function withSwitch(
  switches: readonly Switch[],
  at: EpochMs,
  teamId: TeamId | null,
): readonly Switch[] {
  const before = switches.at(-1)?.at === at ? switches.slice(0, -1) : switches;
  return teamAfter(before) === teamId ? before : [...before, { at, teamId }];
}

/**
 * The game that judges the entry at `index` (CL-JOU-03): the first game he played after
 * it. There is none while he has played none since, nor when an observed change, such
 * as one read from the player file, comes first: that change is applied as every
 * recorded change is, and the game is then compared with the team the file gives, as
 * any game with his team. Other entries in between wait for the same game.
 */
function judgingGame(evidence: readonly Evidence[], index: number): Evidence | undefined {
  const next = evidence.slice(index + 1).find((fact) => fact.kind !== 'entered');
  return next?.kind === 'played' ? next : undefined;
}

/**
 * His switches after an entry (CL-JOU-03, CL-STA-05): at its instant, it ends his stint
 * with the team he leaves, his membership then, and, unless it is a release, starts the
 * entered team's. The game that judges it confirms the entered team when it is for that
 * team; for the team he left, when that is not the entered team, it makes the entry
 * void, so that stint never ended; for a third team, the entered stint ends unconfirmed:
 * he belongs to no team from the entry to that game, whose team his line then gives him.
 */
function afterEntry(
  switches: readonly Switch[],
  entry: Evidence,
  judge: Evidence | undefined,
): readonly Switch[] {
  if (judge === undefined || judge.teamId === entry.teamId) {
    return withSwitch(switches, entry.at, entry.teamId);
  }
  return judge.teamId === teamAfter(switches) ? switches : withSwitch(switches, entry.at, null);
}

function stintsOf(switches: readonly Switch[]): readonly TeamStint[] {
  return switches.flatMap(({ at, teamId }, index) =>
    teamId === null ? [] : { teamId, from: at, until: switches[index + 1]?.at ?? null },
  );
}

/**
 * His stints with teams, in time order (STA-27, CL-STA-05, CL-JOU-03, CL-JOU-20), from
 * the `lines` of his box scores and the rows of his team `history`. A stint starts at
 * his first game played for a team and ends at his first game played for another. An
 * observed change or release, read from a game he played or from the player file, ends
 * his stint and starts the new team's at its instant, none for a release. A change or a
 * release the owner entered does so at its entry, the team he leaves being his
 * membership then, and the first game he plays after it judges it: for the entered
 * team, it confirms the stint; for the team he left, when that team is not the entered
 * one, the entry is void; for a third team, the entered stint ends unconfirmed, so that
 * he belongs to no team until that game, and the entered team's games count neither as
 * played nor as missed. A change read from the player file between the entry and that
 * game is applied first, and the entry is not judged. The team chosen at his addition is
 * the first row: an observed one when the player file gave the same team, and otherwise
 * an entered change that leaves the team of his last game played before it, none if he
 * has played none, so that when he was added with that team, his first game for it
 * confirms the choice and nothing can be void. He has no team before his first game,
 * unless a row gave him one, nor while he belongs to no team.
 */
export function teamMembership(
  lines: readonly PlayerLine[],
  history: readonly PlayerTeamChange[],
): readonly TeamStint[] {
  const evidence = evidenceOf(lines, history);
  let switches: readonly Switch[] = [];
  for (const [index, fact] of evidence.entries()) {
    switches =
      fact.kind === 'entered'
        ? afterEntry(switches, fact, judgingGame(evidence, index))
        : withSwitch(switches, fact.at, fact.teamId);
  }
  return stintsOf(switches);
}

/**
 * The team he belonged to at the start of `game` when that team plays it, or null: a
 * placeholder whose two teams are not both set is no team's game (CL-STA-14).
 */
function memberTeamOf(game: LinesGame, stints: readonly TeamStint[]): TeamId | null {
  const { scheduledStartAt: start } = game;
  const stint = stints.find(
    ({ from, until }) => from <= start && (until === null || start < until),
  );
  const isPlaceholder = game.homeTeamId === null || game.awayTeamId === null;
  return stint !== undefined && !isPlaceholder && hasTeam(game, stint.teamId) ? stint.teamId : null;
}

function teamGameOf(game: LinesGame, teamId: TeamId, line: BoxScoreLine | null): TeamGame {
  if (game.status !== 'final') {
    return { game, teamId, participation: null, minutes: null };
  }
  const isPublished =
    game.homeTeamId === teamId ? game.homeLinesPublished : game.awayLinesPublished;
  return {
    game,
    teamId,
    participation: participationOf(line, isPublished),
    minutes: line === null ? null : verifyBoxScore(line, null).decimalMinutes,
  };
}

/**
 * His team games that start strictly after `after`, in scheduled-start order, ties by
 * game id (STA-27, CL-STA-05, CL-STA-09): the official games among `games` of the team
 * he belonged to at their scheduled start, under his `stints` from teamMembership, each
 * with his participation, read from his `lines` and the lines the source published for
 * his team (CL-STA-04), and his minutes. A postponed game that no make-up was linked to,
 * a canceled game and a placeholder whose teams are still to be determined are no team
 * games (CL-STA-14, CL-STA-17).
 */
export function teamGames(
  player: Readonly<{ stints: readonly TeamStint[]; lines: readonly PlayerLine[] }>,
  games: readonly LinesGame[],
  after: EpochMs,
): readonly TeamGame[] {
  const lineOf = new Map(player.lines.map(({ gameId, line }) => [gameId, line]));
  return games
    .filter((game) => game.scheduledStartAt > after && isCounted(game))
    .toSorted(byScheduledStart)
    .flatMap((game) => {
      const teamId = memberTeamOf(game, player.stints);
      return teamId === null ? [] : [teamGameOf(game, teamId, lineOf.get(game.id) ?? null)];
    });
}
