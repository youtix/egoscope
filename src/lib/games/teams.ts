// The team directory's reads, the current team as his games played observe it, and the
// team history (module map §2.4): games hands `players.recordTeamChange` what his games
// played say of his team, and reads his stints from his own lines and his recorded
// changes, never from the player directory (JOU-13, STA-25, CL-JOU-02, CL-JOU-03,
// CL-JOU-18). What the source's current-season player file says goes to players through
// player-records.ts, with the same evidence (CL-JOU-25, CL-STA-27).
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { boxScores, games, playerTeamChanges, teamSeasons } from '@/lib/db';
import { recordTeamChange } from '@/lib/players';
import { err, ok } from '@/lib/result';
import { toEpochMs } from '@/lib/time';

import { membershipOf } from './stored-schedule';

import type { PlayerNotFound } from './mapping';
import type { Database, Transaction } from '@/lib/db';
import type { TeamChangeOutcome, TeamEvidence } from '@/lib/players';
import type { Result } from '@/lib/result';
import type { PlayerId, TeamStint } from '@/lib/stats-engine';
import type { Season } from '@/lib/stats-source';
import type { EpochMs } from '@/lib/time';

type Executor = Database | Transaction;

/** A team as one season lists it, under its id that survives a relocation (JOU-08, STA-26, CL-JOU-18). */
export type TeamName = Readonly<{
  teamId: number;
  name: string;
  location: string;
  abbreviation: string;
}>;

/**
 * What an update of his team did: whether it moved his current team or his team history,
 * and whether an entered change turned void or ended unconfirmed, for which the fetch
 * unit calls its `onTeamHistoryChanged` hook in its transaction (CL-JOU-03, CL-TAX-19).
 */
export type TeamUpdate = Readonly<{ changed: boolean; teamHistoryChanged: boolean }>;

/** An update that changed nothing. */
export const UNCHANGED: TeamUpdate = { changed: false, teamHistoryChanged: false };

/** Players follows no player under the identifier given. */
export const PLAYER_NOT_FOUND: PlayerNotFound = { kind: 'player_not_found' };

const TEAM_NAME = {
  teamId: teamSeasons.teamId,
  name: teamSeasons.name,
  location: teamSeasons.location,
  abbreviation: teamSeasons.abbreviation,
};

// The game that verified an entered change, beside the games of his lines.
const verifyingGames = alias(games, 'verifying_games');

/**
 * The team `teamId` as the season `season` listed it, or null when that season does not
 * list it: a relocated team keeps its id under the names of each season (JOU-08, STA-26,
 * CL-JOU-18).
 */
export async function team(db: Executor, teamId: number, season: Season): Promise<TeamName | null> {
  const [row] = await db
    .select(TEAM_NAME)
    .from(teamSeasons)
    .where(and(eq(teamSeasons.teamId, teamId), eq(teamSeasons.season, season)));
  return row ?? null;
}

/**
 * The current teams, those of the latest season stored, under that season's names, by
 * location then name: the teams a choice of team offers (JOU-08, CL-JOU-18, CL-JOU-20).
 */
export async function teams(db: Executor): Promise<readonly TeamName[]> {
  const latest = db.select({ season: max(teamSeasons.season) }).from(teamSeasons);
  return db
    .select(TEAM_NAME)
    .from(teamSeasons)
    .where(inArray(teamSeasons.season, latest))
    .orderBy(asc(teamSeasons.location), asc(teamSeasons.name));
}

/**
 * His stints with teams, in time order, from his own box-score lines and the rows of his
 * team history, never from the player directory: a team that moved or was renamed keeps
 * its id, so his stint with it goes on (JOU-13, STA-27, CL-STA-05, CL-JOU-03, CL-JOU-18).
 */
export async function teamHistory(db: Executor, playerId: PlayerId): Promise<readonly TeamStint[]> {
  const { stints } = await membershipOf(db, playerId);
  return stints;
}

/**
 * The condition that a line is his and gives a team: a stored line is a game he played,
 * and the placeholder of an unavailable sheet, which gives none, is not (STA-08, CL-STA-11).
 */
const playedBy = (playerId: PlayerId) =>
  and(eq(boxScores.playerId, playerId), isNotNull(boxScores.teamId));

// The team of a line that gives one, typed so: `playedBy` keeps the others out.
const LINE_TEAM = sql<number>`${boxScores.teamId}`;

/** A game he played: the game, its scheduled start, and the team he played for. */
type GamePlayed = Readonly<{ gameId: number; at: EpochMs; teamId: number }>;

/**
 * His games played that start after the instant from which players takes a game as
 * news: the latest row of his team history, or the game that verified it when later
 * (CL-JOU-02), by scheduled start then game id; a daily update that brings none of them
 * hands players nothing.
 */
async function gamesPlayedSinceLatestChange(
  tx: Transaction,
  playerId: PlayerId,
): Promise<readonly GamePlayed[]> {
  const latestChange = tx
    .select({
      at: sql`greatest(${playerTeamChanges.changedAt}, ${verifyingGames.scheduledStartAt})`,
    })
    .from(playerTeamChanges)
    .leftJoin(verifyingGames, eq(verifyingGames.id, playerTeamChanges.gameId))
    .where(eq(playerTeamChanges.playerId, playerId))
    .orderBy(desc(playerTeamChanges.changedAt), desc(playerTeamChanges.id))
    .limit(1);
  const rows = await tx
    .select({ gameId: games.id, start: games.scheduledStartAt, teamId: LINE_TEAM })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(playedBy(playerId), gt(games.scheduledStartAt, latestChange)))
    .orderBy(asc(games.scheduledStartAt), asc(games.id));
  return rows.map(({ start, ...game }) => ({ ...game, at: toEpochMs(start.getTime()) }));
}

/**
 * His membership at his latest entered change as his box scores give it: the team of his
 * last game played at or before it, none if he has played none (players.md §1.4,
 * CL-JOU-03). Players never reads box scores, so games passes it with every evidence,
 * of his games here and of the player file in player-records.ts.
 */
export async function membershipAtLatestEntry(
  tx: Transaction,
  playerId: PlayerId,
): Promise<number | null> {
  const latestEntry = tx
    .select({ at: max(playerTeamChanges.changedAt) })
    .from(playerTeamChanges)
    .where(and(eq(playerTeamChanges.playerId, playerId), eq(playerTeamChanges.origin, 'entered')));
  const [last] = await tx
    .select({ teamId: LINE_TEAM })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(playedBy(playerId), lte(games.scheduledStartAt, latestEntry)))
    .orderBy(desc(games.scheduledStartAt), desc(games.id))
    .limit(1);
  return last?.teamId ?? null;
}

/** What `recordTeamChange` did, as an update: a void entry or an unconfirmed end changes the team history. */
function updateOf({ changed, judgment }: TeamChangeOutcome): TeamUpdate {
  return { changed, teamHistoryChanged: judgment === 'void' || judgment === 'unconfirmed' };
}

/** Two updates of his team, one after the other, as one. */
function merged(first: TeamUpdate, second: TeamUpdate): TeamUpdate {
  return {
    changed: first.changed || second.changed,
    teamHistoryChanged: first.teamHistoryChanged || second.teamHistoryChanged,
  };
}

/**
 * Hands players one evidence of his team, of a game he played or of the player file, and
 * gives what it did (JOU-13, STA-25, CL-JOU-03).
 */
export async function handOn(
  tx: Transaction,
  playerId: PlayerId,
  evidence: TeamEvidence,
): Promise<Result<TeamUpdate, PlayerNotFound>> {
  const outcome = await recordTeamChange(tx, playerId, evidence);
  return outcome.ok ? ok(updateOf(outcome.value)) : err(PLAYER_NOT_FOUND);
}

/**
 * Hands `players.recordTeamChange`, in the fetch unit's transaction `tx`, once his box
 * scores are stored, the first game of each run of games he played for one team since
 * the latest change of his team history, in order: an observed change is dated by his
 * first game with the new team, and the last one handed is his most recent game played,
 * by scheduled start (JOU-13, STA-25, CL-JOU-02). Each comes with his membership at his
 * latest entered change, so that the first game after an entered change judges it
 * (CL-JOU-03, CL-STA-05). A box score older than that change, fetched later, is handed
 * nothing and changes nothing. Gives whether a void entry or an unconfirmed end changed
 * his team history, for the unit's `onTeamHistoryChanged` hook.
 */
export async function updateTeamFromGames(
  tx: Transaction,
  playerId: PlayerId,
): Promise<Result<TeamUpdate, PlayerNotFound>> {
  const played = await gamesPlayedSinceLatestChange(tx, playerId);
  const arrivals = played.filter((game, index) => game.teamId !== played[index - 1]?.teamId);
  if (arrivals.length === 0) {
    return ok(UNCHANGED);
  }
  const membershipAtEntry = await membershipAtLatestEntry(tx, playerId);
  let update = UNCHANGED;
  for (const { gameId, at, teamId } of arrivals) {
    const next = await handOn(tx, playerId, { gameId, at, teamId, membershipAtEntry });
    if (!next.ok) {
      return next;
    }
    update = merged(update, next.value);
  }
  return ok(update);
}
