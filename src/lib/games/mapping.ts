// The statistics-source mapping of each followed player: confirmed by the owner, an
// identity linked to one followed player only, "mapping to establish" with its
// candidates until then, and the gate that lets nothing be fetched for a player whose
// mapping is to establish (STA-03, JOU-10, JOU-12, CL-JOU-04, CL-JOU-11, CL-JOU-21).
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';

import {
  boxScores,
  followedPlayers,
  mappingCandidates,
  playerDirectoryEntries,
  playerNameVariants,
  statsSourceMappings,
} from '@/lib/db';
import { err, ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';

import { candidatesIn, linkedPlayers, readSearchIndex, STATS_SOURCE } from './directory';

import type { Candidate, SearchIndex } from './directory';
import type { Database, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { PlayerId } from '@/lib/stats-engine';
import type { SourcePlayerId } from '@/lib/stats-source';
import type { EpochMs } from '@/lib/time';

// The transaction lock that every confirmation holds from its uniqueness check to its write.
const CONFIRMATION_LOCK = 'games.mapping-confirmation';

/** No followed player has this identifier. */
export type PlayerNotFound = Readonly<{ kind: 'player_not_found' }>;
/** The identity is linked to another followed player already, whom the refusal names (CL-JOU-04, CA-JOU-08). */
export type AlreadyFollowed = Readonly<{
  kind: 'already_followed';
  playerId: PlayerId;
  displayName: string;
}>;
/** The stored directory holds no such identity. */
export type UnknownIdentity = Readonly<{ kind: 'unknown_identity' }>;
/** Why a confirmation was refused. */
export type ConfirmRefusal = PlayerNotFound | UnknownIdentity | AlreadyFollowed;
/** The player's mapping is established already: a change reopens it (JOU-12). */
export type MappingEstablished = Readonly<{ kind: 'mapping_established' }>;
/** The player has no mapping to change. */
export type MappingNotFound = Readonly<{ kind: 'mapping_not_found' }>;

/** A mapping to establish with the candidates that its search found (JOU-10). */
export type MappingToEstablish = Readonly<{ mappingId: number; candidates: readonly Candidate[] }>;
/** A candidate stored for a mapping to establish, preselected by a replacement source's crosswalk or not (CL-TRV-14). */
export type StoredCandidate = Candidate & Readonly<{ isPreselected: boolean }>;
/** A mapping to establish, for the to-do list, with its stored candidates (JOU-10, IHM-20). */
export type PendingMapping = Readonly<{
  mappingId: number;
  playerId: PlayerId;
  displayName: string;
  lastSearchedAt: EpochMs | null;
  candidates: readonly StoredCandidate[];
}>;
/** The candidates that a search found for a mapping to establish and that it did not hold before (JOU-10). */
export type NewCandidates = Readonly<{
  mappingId: number;
  playerId: PlayerId;
  candidates: readonly Candidate[];
}>;

/** A confirmed mapping: how many lines of a former identity it deleted (CL-JOU-11). */
export type ConfirmedMapping = Readonly<{ formerLinesDeleted: number }>;

const PLAYER_NOT_FOUND: PlayerNotFound = { kind: 'player_not_found' };

// The mappings to establish of the one source in use (JOU-10).
const TO_ESTABLISH = and(
  eq(statsSourceMappings.statsSource, STATS_SOURCE),
  eq(statsSourceMappings.status, 'to_establish'),
);

/** The condition that a mapping is the player's, for the one source in use. */
const ofPlayer = (playerId: PlayerId) =>
  and(
    eq(statsSourceMappings.playerId, playerId),
    eq(statsSourceMappings.statsSource, STATS_SOURCE),
  );

async function isFollowed(tx: Transaction, playerId: PlayerId): Promise<boolean> {
  const rows = await tx
    .select({ id: followedPlayers.id })
    .from(followedPlayers)
    .where(eq(followedPlayers.id, playerId));
  return rows.length > 0;
}

async function isInDirectory(tx: Transaction, ref: SourcePlayerId): Promise<boolean> {
  const rows = await tx
    .select({ id: playerDirectoryEntries.id })
    .from(playerDirectoryEntries)
    .where(
      and(
        eq(playerDirectoryEntries.statsSource, STATS_SOURCE),
        eq(playerDirectoryEntries.sourcePlayerRef, ref),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** The names that the search uses for the followed player `playerId`: his display name and his spelling variants. */
async function searchNamesOf(tx: Transaction, playerId: PlayerId): Promise<readonly string[]> {
  const players = await tx
    .select({ name: followedPlayers.displayName })
    .from(followedPlayers)
    .where(eq(followedPlayers.id, playerId));
  const variants = await tx
    .select({ name: playerNameVariants.text })
    .from(playerNameVariants)
    .where(and(eq(playerNameVariants.playerId, playerId), eq(playerNameVariants.kind, 'spelling')));
  return [...players, ...variants].map((row) => row.name);
}

/**
 * Replaces the stored candidates of the mapping `mappingId` with `candidates`, found
 * now, carrying the crosswalk's preselection over while its candidate is still among
 * them, and records the search; gives those it did not hold before (JOU-10, CL-TRV-14).
 */
async function storeCandidates(
  tx: Transaction,
  mappingId: number,
  candidates: readonly Candidate[],
): Promise<readonly Candidate[]> {
  const previous = await tx
    .select({
      ref: mappingCandidates.sourcePlayerRef,
      isPreselected: mappingCandidates.isPreselected,
    })
    .from(mappingCandidates)
    .where(eq(mappingCandidates.mappingId, mappingId));
  const preselected = previous.find((row) => row.isPreselected)?.ref;
  const held = new Set(previous.map((row) => row.ref));
  const at = new Date(now());
  await tx.delete(mappingCandidates).where(eq(mappingCandidates.mappingId, mappingId));
  if (candidates.length > 0) {
    await tx.insert(mappingCandidates).values(
      candidates.map((candidate) => ({
        mappingId,
        sourcePlayerRef: candidate.sourcePlayerRef,
        displayName: candidate.displayName,
        currentTeamId: candidate.currentTeamId,
        firstSeason: candidate.firstSeason,
        lastSeason: candidate.lastSeason,
        teamIds: [...candidate.teamIds],
        foundAt: at,
        isPreselected: candidate.sourcePlayerRef === preselected,
      })),
    );
  }
  await tx
    .update(statsSourceMappings)
    .set({ lastSearchedAt: at })
    .where(eq(statsSourceMappings.id, mappingId));
  return candidates.filter((candidate) => !held.has(candidate.sourcePlayerRef));
}

/**
 * Runs the search for the mapping to establish `mappingId` of `playerId` with his names
 * and stores what it finds, in `tx`; gives every candidate and the new ones (JOU-10).
 */
async function searchForMapping(
  tx: Transaction,
  { mappingId, playerId }: Readonly<{ mappingId: number; playerId: PlayerId }>,
  index?: SearchIndex,
): Promise<Readonly<{ candidates: readonly Candidate[]; found: readonly Candidate[] }>> {
  const names = await searchNamesOf(tx, playerId);
  const candidates = await candidatesIn(tx, index ?? (await readSearchIndex(tx)), names);
  return { candidates, found: await storeCandidates(tx, mappingId, candidates) };
}

/**
 * Runs the search again, in `tx`, for every mapping to establish, as each statistics
 * update does once it has stored the directory, and stores the candidates it finds;
 * gives the mappings that gained candidates, with those new ones, for the to-do list
 * (STA-03, JOU-10, CA-STA-15, CA-JOU-07).
 */
export async function refreshPendingCandidates(tx: Transaction): Promise<readonly NewCandidates[]> {
  const pending = await tx
    .select({ mappingId: statsSourceMappings.id, playerId: statsSourceMappings.playerId })
    .from(statsSourceMappings)
    .where(TO_ESTABLISH)
    .orderBy(asc(statsSourceMappings.id));
  if (pending.length === 0) {
    return [];
  }
  const index = await readSearchIndex(tx);
  const gained: NewCandidates[] = [];
  for (const mapping of pending) {
    const { found } = await searchForMapping(tx, mapping, index);
    if (found.length > 0) {
      gained.push({ ...mapping, candidates: found });
    }
  }
  return gained;
}

/**
 * Confirms, in the caller's transaction `tx`, the identity `sourcePlayerRef` of the
 * stored directory as the player's mapping: refused at any moment, at the addition, from
 * the to-do list or after a change, when the identity is linked to another followed
 * player, whatever his state, the refusal naming him (CL-JOU-04). Otherwise establishes
 * the one mapping of the player for the source (CL-JOU-21), deletes its candidates and
 * the player's box-score lines of any other identity, a former one after a change
 * (CL-JOU-11); queues and recalculates nothing, which the composed action does
 * (STA-03, JOU-10, JOU-12).
 */
export async function confirmMapping(
  tx: Transaction,
  { playerId, sourcePlayerRef }: Readonly<{ playerId: PlayerId; sourcePlayerRef: SourcePlayerId }>,
): Promise<Result<ConfirmedMapping, ConfirmRefusal>> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${CONFIRMATION_LOCK}))`);
  if (!(await isFollowed(tx, playerId))) {
    return err(PLAYER_NOT_FOUND);
  }
  if (!(await isInDirectory(tx, sourcePlayerRef))) {
    return err({ kind: 'unknown_identity' });
  }
  const links = await linkedPlayers(tx, [sourcePlayerRef]);
  const linked = links.get(sourcePlayerRef);
  if (linked !== undefined && linked.playerId !== playerId) {
    return err({ kind: 'already_followed', ...linked });
  }
  const established = {
    status: 'established',
    sourcePlayerRef,
    establishedAt: new Date(now()),
  } as const;
  await tx
    .insert(statsSourceMappings)
    .values({ playerId, statsSource: STATS_SOURCE, ...established })
    .onConflictDoUpdate({
      target: [statsSourceMappings.playerId, statsSourceMappings.statsSource],
      set: established,
    });
  const mappingIds = tx
    .select({ id: statsSourceMappings.id })
    .from(statsSourceMappings)
    .where(ofPlayer(playerId));
  await tx.delete(mappingCandidates).where(inArray(mappingCandidates.mappingId, mappingIds));
  const deleted = await tx
    .delete(boxScores)
    .where(
      and(
        eq(boxScores.playerId, playerId),
        eq(boxScores.statsSource, STATS_SOURCE),
        ne(boxScores.sourcePlayerRef, sourcePlayerRef),
      ),
    )
    .returning({ id: boxScores.id });
  return ok({ formerLinesDeleted: deleted.length });
}

/**
 * Records, in the caller's transaction `tx`, the player's mapping as "mapping to
 * establish", when no candidate suits the owner or the directory holds none yet, the
 * source unavailable for instance, with the candidates that a search in the stored
 * directory finds for his names now; the search runs again at every statistics update
 * (`refreshPendingCandidates`). Refused for a player whose mapping is established,
 * which `changeMapping` reopens (STA-03, JOU-10, CA-JOU-07, CA-STA-15).
 */
export async function markMappingToEstablish(
  tx: Transaction,
  { playerId }: Readonly<{ playerId: PlayerId }>,
): Promise<Result<MappingToEstablish, PlayerNotFound | MappingEstablished>> {
  if (!(await isFollowed(tx, playerId))) {
    return err(PLAYER_NOT_FOUND);
  }
  await tx
    .insert(statsSourceMappings)
    .values({ playerId, statsSource: STATS_SOURCE, status: 'to_establish' })
    .onConflictDoNothing();
  const [mapping] = await tx
    .select({ id: statsSourceMappings.id, status: statsSourceMappings.status })
    .from(statsSourceMappings)
    .where(ofPlayer(playerId));
  if (mapping?.status !== 'to_establish') {
    return err({ kind: 'mapping_established' });
  }
  const { candidates } = await searchForMapping(tx, { mappingId: mapping.id, playerId });
  return ok({ mappingId: mapping.id, candidates });
}

/**
 * Reopens, in the caller's transaction `tx`, the search and confirmation of the
 * player's mapping (JOU-12): it is "mapping to establish" again, nothing being fetched
 * for him until another identity is confirmed, with the candidates found now; his lines
 * stay until `confirmMapping` confirms another identity, which deletes them, and what
 * the player file gave at its last read is forgotten, since it described the former
 * identity (STA-03, CL-JOU-11, CL-JOU-25).
 */
export async function changeMapping(
  tx: Transaction,
  { playerId }: Readonly<{ playerId: PlayerId }>,
): Promise<Result<MappingToEstablish, MappingNotFound>> {
  const [mapping] = await tx
    .update(statsSourceMappings)
    .set({
      status: 'to_establish',
      sourcePlayerRef: null,
      establishedAt: null,
      playerFileTeamId: null,
      playerFileReadAt: null,
    })
    .where(ofPlayer(playerId))
    .returning({ id: statsSourceMappings.id });
  if (mapping === undefined) {
    return err({ kind: 'mapping_not_found' });
  }
  const { candidates } = await searchForMapping(tx, { mappingId: mapping.id, playerId });
  return ok({ mappingId: mapping.id, candidates });
}

/**
 * The fetch gate: each followed player whose mapping is established, with his
 * identity, the only players whose statistics a fetch unit may request; a player whose
 * mapping is to establish is not among them, so nothing is fetched for him
 * (JOU-10, STA-03, CL-JOU-21, CA-JOU-07).
 */
export async function establishedMappings(
  db: Database | Transaction,
): Promise<ReadonlyMap<PlayerId, SourcePlayerId>> {
  const rows = await db
    .select({
      playerId: statsSourceMappings.playerId,
      ref: sql<SourcePlayerId>`${statsSourceMappings.sourcePlayerRef}`,
    })
    .from(statsSourceMappings)
    .where(
      and(
        eq(statsSourceMappings.statsSource, STATS_SOURCE),
        eq(statsSourceMappings.status, 'established'),
      ),
    )
    .orderBy(asc(statsSourceMappings.playerId));
  return new Map(rows.map((row) => [row.playerId, row.ref]));
}

/**
 * The mappings to establish, by their player's name, each with its stored candidates in
 * the order the search gave them and the followed player each candidate is linked to
 * already: the to-do list's items (JOU-10, STA-03, IHM-20, CL-JOU-04).
 */
export async function pendingMappings(
  db: Database | Transaction,
): Promise<readonly PendingMapping[]> {
  const mappings = await db
    .select({
      mappingId: statsSourceMappings.id,
      playerId: statsSourceMappings.playerId,
      displayName: followedPlayers.displayName,
      searchedAt: statsSourceMappings.lastSearchedAt,
    })
    .from(statsSourceMappings)
    .innerJoin(followedPlayers, eq(followedPlayers.id, statsSourceMappings.playerId))
    .where(TO_ESTABLISH)
    .orderBy(asc(followedPlayers.displayName), asc(statsSourceMappings.id));
  if (mappings.length === 0) {
    return [];
  }
  const mappingIds = mappings.map((mapping) => mapping.mappingId);
  const rows = await db
    .select()
    .from(mappingCandidates)
    .where(inArray(mappingCandidates.mappingId, mappingIds))
    .orderBy(asc(mappingCandidates.id));
  const linked = await linkedPlayers(db, [...new Set(rows.map((row) => row.sourcePlayerRef))]);
  return mappings.map(({ searchedAt, ...mapping }) => ({
    ...mapping,
    lastSearchedAt: searchedAt === null ? null : toEpochMs(searchedAt.getTime()),
    candidates: rows
      .filter((row) => row.mappingId === mapping.mappingId)
      .map((row) => ({
        sourcePlayerRef: row.sourcePlayerRef,
        displayName: row.displayName,
        currentTeamId: row.currentTeamId,
        teamIds: row.teamIds,
        firstSeason: row.firstSeason,
        lastSeason: row.lastSeason,
        isPreselected: row.isPreselected,
        followedAs: linked.get(row.sourcePlayerRef) ?? null,
      })),
  }));
}
