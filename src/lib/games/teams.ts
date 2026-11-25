// The team directory's reads, the current team as the statistics observe it, and the
// team history (module map §2.4): games hands `players.recordTeamChange` what his games
// played and the source's current-season player file say of his team, and reads his
// stints from his own lines and his recorded changes, never from the player directory
// (JOU-13, STA-25, CL-JOU-02, CL-JOU-03, CL-JOU-18, CL-JOU-25, CL-STA-27).
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  boxScores,
  games,
  playerTeamChanges,
  statsSourceMappings,
  teamSeasons,
  teamSourceRefs,
} from '@/lib/db';
import { recordTeamChange, setBirthdayFromSource } from '@/lib/players';
import { err, mapResult, ok } from '@/lib/result';
import { teamMembership } from '@/lib/stats-engine';
import { toEpochMs } from '@/lib/time';

import { STATS_SOURCE } from './directory';

import type { UnknownTeams } from './directory';
import type { PlayerNotFound } from './mapping';
import type { BoxScoreRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { TeamChangeOutcome, TeamEvidence } from '@/lib/players';
import type { Result } from '@/lib/result';
import type {
  BoxScoreLine,
  PlayerId,
  PlayerLine,
  PlayerTeamChange,
  TeamStint,
} from '@/lib/stats-engine';
import type { CurrentTeam, PlayerRecord, Season } from '@/lib/stats-source';
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

/** What a record of the source did to his team, and whether it changed his birthday (CL-JOU-16). */
export type RecordUpdate = TeamUpdate & Readonly<{ birthdayChanged: boolean }>;

/** A record of the current season's player file that the fetch unit read for a player at `readAt`. */
export type PlayerRecordRead = Readonly<{
  playerId: PlayerId;
  record: PlayerRecord;
  readAt: EpochMs;
  /** Whether it is the first record of an identity confirmed in place of another (CL-JOU-11). */
  identityChanged: boolean;
}>;

const UNCHANGED: TeamUpdate = { changed: false, teamHistoryChanged: false };
const NOTHING_APPLIED: RecordUpdate = { ...UNCHANGED, birthdayChanged: false };
const PLAYER_NOT_FOUND: PlayerNotFound = { kind: 'player_not_found' };

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

/** His stored line as the engine reads it, its counts named alike: whole minutes when the source rounded them (STA-08). */
function lineOf({ hasRoundedMinutes, minutes, seconds, ...counts }: BoxScoreRow): BoxScoreLine {
  return hasRoundedMinutes
    ? { ...counts, minutesPrecision: 'whole_minutes', minutes, seconds: null }
    : { ...counts, minutesPrecision: 'seconds', minutes, seconds };
}

/** The condition that a line is his and gives a team: an unavailable sheet gives none (CL-STA-11). */
const playedBy = (playerId: PlayerId) =>
  and(eq(boxScores.playerId, playerId), isNotNull(boxScores.teamId));

// The team of a line that gives one, typed so: `playedBy` keeps the others out.
const LINE_TEAM = sql<number>`${boxScores.teamId}`;

/** His lines that give a team, with the scheduled start of their games (CL-JOU-18). */
async function linesOf(db: Executor, playerId: PlayerId): Promise<readonly PlayerLine[]> {
  const rows = await db
    .select({ start: games.scheduledStartAt, teamId: LINE_TEAM, line: boxScores })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(playedBy(playerId));
  return rows.map(({ start, teamId, line }) => ({
    gameId: line.gameId,
    scheduledStartAt: toEpochMs(start.getTime()),
    teamId,
    line: lineOf(line),
  }));
}

/** The rows of his team history, as the engine's membership walk reads them (JOU-13). */
async function changesOf(db: Executor, playerId: PlayerId): Promise<readonly PlayerTeamChange[]> {
  const rows = await db
    .select({
      id: playerTeamChanges.id,
      changedAt: playerTeamChanges.changedAt,
      newTeamId: playerTeamChanges.newTeamId,
      origin: playerTeamChanges.origin,
    })
    .from(playerTeamChanges)
    .where(eq(playerTeamChanges.playerId, playerId));
  return rows.map((row) => ({ ...row, changedAt: toEpochMs(row.changedAt.getTime()) }));
}

/**
 * His stints with teams, in time order, from his own box-score lines and the rows of his
 * team history, never from the player directory: a team that moved or was renamed keeps
 * its id, so his stint with it goes on (JOU-13, STA-27, CL-STA-05, CL-JOU-03, CL-JOU-18).
 */
export async function teamHistory(db: Executor, playerId: PlayerId): Promise<readonly TeamStint[]> {
  return teamMembership(await linesOf(db, playerId), await changesOf(db, playerId));
}

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
 * CL-JOU-03). Players never reads box scores, so games passes it with every evidence.
 */
async function membershipAtLatestEntry(
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

/** Hands players one evidence of his team, and gives what it did. */
async function handOn(
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

/** The team of a listed player's row, none for a release, or undefined when the file does not list him (CL-STA-27, CL-STA-31). */
async function fileTeamOf(
  tx: Transaction,
  currentTeam: CurrentTeam,
): Promise<Result<Readonly<{ teamId: number | null }> | undefined, UnknownTeams>> {
  if (currentTeam.kind === 'not_listed') {
    return ok(undefined);
  }
  if (currentTeam.kind === 'without_team') {
    return ok({ teamId: null });
  }
  const [known] = await tx
    .select({ teamId: teamSourceRefs.teamId })
    .from(teamSourceRefs)
    .where(
      and(
        eq(teamSourceRefs.statsSource, STATS_SOURCE),
        eq(teamSourceRefs.sourceTeamRef, currentTeam.team),
      ),
    );
  return known === undefined
    ? err({ kind: 'unknown_teams', teams: [currentTeam.team] })
    : ok({ teamId: known.teamId });
}

/**
 * Fills his day and month of birth from the source, the year dropped by the adapter, and
 * over a source-given one for the first record of a newly confirmed identity, never over
 * the owner's (CL-JOU-16, CL-JOU-11). A day that no calendar has is kept out.
 */
async function applyBirthday(
  tx: Transaction,
  { playerId, record, identityChanged }: PlayerRecordRead,
): Promise<Result<boolean, PlayerNotFound>> {
  if (record.birthday === null) {
    return ok(false);
  }
  const set = await setBirthdayFromSource(tx, playerId, {
    ...record.birthday,
    replaceSourceGiven: identityChanged,
  });
  if (set.ok) {
    return ok(set.value.changed);
  }
  return set.error === 'impossible_birthday' ? ok(false) : err(PLAYER_NOT_FOUND);
}

/** His established mapping, with what the player file gave at its last read that listed him (CL-JOU-25). */
type FileMapping = Readonly<{ id: number; fileTeamId: number | null; fileReadAt: Date | null }>;

/** His established mapping to the identity of the record, locked, or undefined when it is no longer his. */
async function lockedMapping(
  tx: Transaction,
  { playerId, record }: PlayerRecordRead,
): Promise<FileMapping | undefined> {
  const [mapping] = await tx
    .select({
      id: statsSourceMappings.id,
      fileTeamId: statsSourceMappings.playerFileTeamId,
      fileReadAt: statsSourceMappings.playerFileReadAt,
    })
    .from(statsSourceMappings)
    .where(
      and(
        eq(statsSourceMappings.playerId, playerId),
        eq(statsSourceMappings.statsSource, STATS_SOURCE),
        eq(statsSourceMappings.status, 'established'),
        eq(statsSourceMappings.sourcePlayerRef, record.player),
      ),
    )
    .for('update');
  return mapping;
}

/**
 * Keeps on his mapping the team of a row that lists him, none for a release, and the
 * instant of the read, and hands that team to players only when it is news: no read
 * listed him before, or the previous one gave another team, a release counting as a
 * team like another (CL-JOU-25, CL-STA-27, CL-STA-31).
 */
async function applyFileTeam(
  tx: Transaction,
  { playerId, readAt }: PlayerRecordRead,
  { mapping, teamId }: Readonly<{ mapping: FileMapping; teamId: number | null }>,
): Promise<Result<TeamUpdate, PlayerNotFound>> {
  const isNews = mapping.fileReadAt === null || mapping.fileTeamId !== teamId;
  await tx
    .update(statsSourceMappings)
    .set({ playerFileTeamId: teamId, playerFileReadAt: new Date(readAt) })
    .where(eq(statsSourceMappings.id, mapping.id));
  if (!isNews) {
    return ok(UNCHANGED);
  }
  const membershipAtEntry = await membershipAtLatestEntry(tx, playerId);
  return handOn(tx, playerId, { teamId, at: readAt, membershipAtEntry });
}

/**
 * Applies, in the fetch unit's transaction `tx`, a record of the source's current-season
 * player file that it read for `playerId`. Its day and month of birth go to
 * `players.setBirthdayFromSource`, which fills only an empty birthday, and, for the first
 * record of an identity confirmed after a mapping change, replaces one the source gave,
 * never one the owner entered (CL-JOU-16, CL-JOU-11). A row that lists him is news only
 * when its team, none for a release, differs from the one the previous read that listed
 * him gave, or when no read listed him before: then it goes to `players.recordTeamChange`,
 * dated by the read, with his membership at his latest entered change (STA-25, JOU-13,
 * CL-JOU-25, CL-STA-27, CL-STA-31). Either way the mapping keeps the team and the instant
 * of that read; a record that does not list him is no read and leaves them as they are.
 * Applies nothing for an identity that is no longer his established mapping, and nothing
 * for a team the directory does not know yet.
 */
export async function applyPlayerRecord(
  tx: Transaction,
  read: PlayerRecordRead,
): Promise<Result<RecordUpdate, PlayerNotFound | UnknownTeams>> {
  const mapping = await lockedMapping(tx, read);
  if (mapping === undefined) {
    return ok(NOTHING_APPLIED);
  }
  const listed = await fileTeamOf(tx, read.record.currentTeam);
  if (!listed.ok) {
    return listed;
  }
  const birthday = await applyBirthday(tx, read);
  if (!birthday.ok) {
    return birthday;
  }
  const fileTeam =
    listed.value === undefined
      ? ok(UNCHANGED)
      : await applyFileTeam(tx, read, { mapping, teamId: listed.value.teamId });
  return mapResult(fileTeam, (update) => ({ ...update, birthdayChanged: birthday.value }));
}
