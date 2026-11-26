// The records of the source's current-season player file, applied to a followed player:
// his day and month of birth go to `players.setBirthdayFromSource`, and the team of a
// read goes to `players.recordTeamChange` only when it is news, the mapping keeping what
// the last read that listed him gave (CL-JOU-11, CL-JOU-16, CL-JOU-25, CL-STA-27,
// CL-STA-31). Split from teams.ts, whose evidence of his team it shares.
import { and, eq } from 'drizzle-orm';

import { statsSourceMappings, teamSourceRefs } from '@/lib/db';
import { setBirthdayFromSource } from '@/lib/players';
import { err, mapResult, ok } from '@/lib/result';

import { STATS_SOURCE } from './directory';
import { handOn, membershipAtLatestEntry, PLAYER_NOT_FOUND, UNCHANGED } from './teams';

import type { UnknownTeams } from './directory';
import type { PlayerNotFound } from './mapping';
import type { TeamUpdate } from './teams';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { PlayerId } from '@/lib/stats-engine';
import type { CurrentTeam, PlayerRecord } from '@/lib/stats-source';
import type { EpochMs } from '@/lib/time';

/** What a record of the source did to his team, and whether it changed his birthday (CL-JOU-16). */
export type RecordUpdate = TeamUpdate & Readonly<{ birthdayChanged: boolean }>;

/** A record of the current season's player file that the fetch unit read for a player at `readAt`. */
export type PlayerRecordRead = Readonly<{
  playerId: PlayerId;
  record: PlayerRecord;
  readAt: EpochMs;
  /**
   * Whether it is the first record of an identity confirmed in place of another (CL-JOU-11).
   * The fetch unit knows it from the confirmation it applied: games stores nothing of it,
   * and the mapping functions do not report it yet.
   */
  identityChanged: boolean;
}>;

const NOTHING_APPLIED: RecordUpdate = { ...UNCHANGED, birthdayChanged: false };

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
 * for a team the directory does not know yet. A fetch unit stores and applies its box
 * scores first, through `updateTeamFromGames`, and its player-file records after them, so
 * that a change both give is dated by his first game with the new team (JOU-13).
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
