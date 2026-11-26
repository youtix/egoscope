// The invented league that the tests of teams.ts and player-records.ts share, and only
// they import: a database of the test's own, the statistics source's fake and a fixed
// clock, and the followed players, entered changes and player-file reads that each test
// sets up (STA-25, JOU-13, CL-JOU-25). The tests store the league's seasons and box
// scores themselves, with the factories of the test support, which no other file may
// import. A lookup that finds nothing is a bug of the test that asked, which the
// assertion names.
import assert from 'node:assert/strict';

import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';

import {
  boxScores,
  createTestDatabase,
  followedPlayers,
  games,
  playerTeamChanges,
  statsSourceMappings,
  teamSourceRefs,
} from '@/lib/db';
import { add, enterTeamChange } from '@/lib/players';
import { createFakeStatsSource } from '@/lib/stats-source';
import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { STATS_SOURCE } from './directory';
import { applyPlayerRecord } from './player-records';
import { updateTeamFromGames } from './teams';

import type { UnknownTeams } from './directory';
import type { PlayerNotFound } from './mapping';
import type { RecordUpdate } from './player-records';
import type { TeamUpdate } from './teams';
import type { Database } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { FakeStatsSource, PlayerRecord } from '@/lib/stats-source';
import type { FixedClock } from '@/lib/time';

/** The season that every test stores, and the next one, which some add. */
export const SEASON = '2025-26';
export const NEXT_SEASON = '2026-27';
/** A US day after every game of the season it closes, so that its lines are all stored. */
export const AFTER_SEASON = '2026-06-30';

const CALL_WINDOW_MS = 60_000;
const NOON_UTC_HOUR = 12;
const OCTOBER = 10;
const SEASON_EVE_DAY = 20;

/** Noon UTC on the day given, of 2025 unless another year is. */
export function noon(month: number, day: number, year = 2025): Date {
  return new Date(toEpochMs(Date.UTC(year, month - 1, day, NOON_UTC_HOUR)));
}

/** The day before 2025-26 opens, when the clock starts and the players of most tests are added. */
export const BEFORE_SEASON = noon(OCTOBER, SEASON_EVE_DAY);

/** What an update gives when it changes nothing, and a record that applies nothing. */
export const UNCHANGED = { changed: false, teamHistoryChanged: false };
export const NOTHING = { ok: true, value: { ...UNCHANGED, birthdayChanged: false } };
/** An update that moved his team or his history, and one that also rewrote his history. */
export const MOVED = { ok: true, value: { changed: true, teamHistoryChanged: false } };
export const REWRITTEN = { ok: true, value: { changed: true, teamHistoryChanged: true } };
/** A birthday that nothing filled. */
export const NO_BIRTHDAY = { month: null, day: null, origin: null };

/** The team he leaves and the team he joins, none for a release or an addition. */
type Move = readonly [from: number | null, to: number | null];

/** A row of his team history as `historyOf` reads it. */
type HistoryRow = Readonly<{
  at: Date;
  from: number | null;
  to: number | null;
  origin: 'entered' | 'observed';
  gameId: number | null;
}>;

/** A row of his team history that the owner entered, at his addition included, as `historyOf` reads it. */
export function entered(at: Date, [from, to]: Move, gameId: number | null): HistoryRow {
  return { at, from, to, origin: 'entered', gameId };
}

/** A row of his team history that his games or the player file observed, as `historyOf` reads it. */
export function observed(at: Date, [from, to]: Move, gameId: number | null): HistoryRow {
  return { at, from, to, origin: 'observed', gameId };
}

/** The database, the clock and the fake of the running test. */
type League = Readonly<{ db: Database; clock: FixedClock; source: FakeStatsSource }>;

// The league that `openLeague` opened for the running test.
const opened: { league?: League } = {};

/** The league of the running test: asking before `openLeague` is a bug of the test. */
function league(): League {
  assert.ok(opened.league !== undefined, 'No league is open: call openLeague first.');
  return opened.league;
}

/**
 * Opens a database of the running test's own, every migration applied, and a fresh fake
 * of the source, the clock fixed at `BEFORE_SEASON`; gives the database and what closes
 * it and restores the clock.
 */
export async function openLeague(): Promise<
  Readonly<{ db: Database; close: () => Promise<void> }>
> {
  const database = await createTestDatabase();
  const clock = fixedClock(toEpochMs(BEFORE_SEASON.getTime()));
  const restoreClock = installFakeClock(clock);
  opened.league = { db: database.db, clock, source: createFakeStatsSource() };
  const close = async (): Promise<void> => {
    restoreClock();
    await database.close();
  };
  return { db: database.db, close };
}

/** Moves the clock on to `at`. */
export function moveTo(at: Date): void {
  league().clock.advance(at.getTime() - now());
}

/** The application team that the source names `ref`. */
export async function teamOf(ref: string): Promise<number> {
  const [row] = await league()
    .db.select({ id: teamSourceRefs.teamId })
    .from(teamSourceRefs)
    .where(eq(teamSourceRefs.sourceTeamRef, ref));
  assert.ok(row !== undefined, `The league holds no team ${ref}.`);
  return row.id;
}

/** Follows the invented player `ref` from now on, added with the source's team `teamRef` as players.add records it, his mapping established. */
export async function follow(ref: string, teamRef: string): Promise<string> {
  const { db } = league();
  const currentTeamId = await teamOf(teamRef);
  const added = await db.transaction(async (tx) =>
    add(tx, { displayName: `Player ${ref}`, currentTeamId, variants: [] }),
  );
  assert.ok(added.ok, `Players refused to follow ${ref}.`);
  await db.insert(statsSourceMappings).values({
    playerId: added.value.playerId,
    statsSource: STATS_SOURCE,
    status: 'established',
    sourcePlayerRef: ref,
    establishedAt: new Date(now()),
  });
  return added.value.playerId;
}

/** The owner enters now that he plays for the source's team `teamRef`. */
export async function enter(playerId: string, teamRef: string): Promise<void> {
  const teamId = await teamOf(teamRef);
  await league().db.transaction(async (tx) => enterTeamChange(tx, playerId, teamId));
}

/**
 * Keeps his stored lines of `season` up to the US day `lastDay`, as the box-score units
 * have fetched them so far, then updates his team from his games.
 */
export async function keepLinesThrough(
  playerId: string,
  season: string,
  lastDay: string,
): Promise<Result<TeamUpdate, PlayerNotFound>> {
  const { db } = league();
  const later = db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.season, season), gt(games.gameDayOn, lastDay)));
  await db
    .delete(boxScores)
    .where(and(eq(boxScores.playerId, playerId), inArray(boxScores.gameId, later)));
  return db.transaction(async (tx) => updateTeamFromGames(tx, playerId));
}

/** A game of the stored schedule: its id and its scheduled start. */
type ScheduledGame = Readonly<{ id: number; start: Date }>;

/** His game of the US day `day`, of which his line is stored. */
export async function gameOf(playerId: string, day: string): Promise<ScheduledGame> {
  const [row] = await league()
    .db.select({ id: games.id, start: games.scheduledStartAt })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(eq(boxScores.playerId, playerId), eq(games.gameDayOn, day)));
  assert.ok(row !== undefined, `No line of his is stored for ${day}.`);
  return row;
}

/** The game that the team `teamId` plays on the US day `day`, whether a line of it is stored or not. */
export async function scheduledGame(teamId: number, day: string): Promise<ScheduledGame> {
  const plays = or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId));
  const [row] = await league()
    .db.select({ id: games.id, start: games.scheduledStartAt })
    .from(games)
    .where(and(eq(games.gameDayOn, day), plays));
  assert.ok(row !== undefined, `The team ${String(teamId)} plays no game on ${day}.`);
  return row;
}

/** The record of the invented player `ref` in the player file of 2025-26, as the fake serves it. */
export async function recordOf(ref: string): Promise<PlayerRecord> {
  const ctx = {
    deadline: toEpochMs(now() + CALL_WINDOW_MS),
    signal: new AbortController().signal,
  };
  const outcome = await league().source.getPlayerRecords(ctx, {
    season: SEASON,
    knownVersion: null,
    players: [ref],
  });
  assert.ok(outcome.ok, `The fake refused the player file of ${SEASON}.`);
  assert.ok(outcome.value.kind === 'read', `The fake did not read the player file of ${SEASON}.`);
  const [record] = outcome.value.data;
  assert.ok(record !== undefined, `The fake lists no record of ${ref} in ${SEASON}.`);
  return record;
}

/** Applies `record`, read now for the player, first of a newly confirmed identity or not. */
export async function read(
  playerId: string,
  record: PlayerRecord,
  isNewIdentity = false,
): Promise<Result<RecordUpdate, PlayerNotFound | UnknownTeams>> {
  return league().db.transaction(async (tx) =>
    applyPlayerRecord(tx, { playerId, record, readAt: now(), identityChanged: isNewIdentity }),
  );
}

/** His team history, oldest first. */
export async function historyOf(playerId: string): Promise<readonly HistoryRow[]> {
  return league()
    .db.select({
      at: playerTeamChanges.changedAt,
      from: playerTeamChanges.previousTeamId,
      to: playerTeamChanges.newTeamId,
      origin: playerTeamChanges.origin,
      gameId: playerTeamChanges.gameId,
    })
    .from(playerTeamChanges)
    .where(eq(playerTeamChanges.playerId, playerId))
    .orderBy(asc(playerTeamChanges.changedAt), asc(playerTeamChanges.id));
}

/** His current team, his day and month of birth with their origin, and what his mapping keeps of the last player-file read that listed him. */
type PlayerState = Readonly<{
  teamId: number | null;
  month: number | null;
  day: number | null;
  origin: 'owner' | 'stats_source' | null;
  fileTeamId: number | null;
  fileReadAt: Date | null;
}>;

/** His current team, his birthday and what his mapping keeps of the player file, as `PlayerState` says. */
export async function playerOf(playerId: string): Promise<PlayerState> {
  const [row] = await league()
    .db.select({
      teamId: followedPlayers.currentTeamId,
      month: followedPlayers.birthdayMonth,
      day: followedPlayers.birthdayDay,
      origin: followedPlayers.birthdayOrigin,
      fileTeamId: statsSourceMappings.playerFileTeamId,
      fileReadAt: statsSourceMappings.playerFileReadAt,
    })
    .from(followedPlayers)
    .innerJoin(statsSourceMappings, eq(statsSourceMappings.playerId, followedPlayers.id))
    .where(eq(followedPlayers.id, playerId));
  assert.ok(row !== undefined, `No followed player ${playerId} has a mapping.`);
  return row;
}
