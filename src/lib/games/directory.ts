// The player directory of each season, stored from the statistics source, and the
// candidate search that runs in it alone, so that adding a player never waits for the
// source (module map §2.4, choice 31; STA-03, JOU-10).
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  followedPlayers,
  playerDirectoryEntries,
  playerDirectoryTeams,
  seasons,
  statsSourceMappings,
  teamSourceRefs,
} from '@/lib/db';
import { normalizeName } from '@/lib/players';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import type { StatsSourceMappingRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { PlayerId } from '@/lib/stats-engine';
import type { DirectoryEntry, Season, SourcePlayerId, SourceTeamId } from '@/lib/stats-source';

type Executor = Database | Transaction;

/** The one statistics source in use, which serves every season (CL-STA-23). */
export const STATS_SOURCE: StatsSourceMappingRow['statsSource'] = 'sportsdataverse_espn';

// The marks that a canonical decomposition splits off a letter: accents and other diacritics.
const COMBINING_MARKS = /\p{M}/gu;
// What separates the words of a name: anything but a letter or a digit.
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;
// The shortest query word that a name word one typing slip away still matches.
const CLOSE_WORD_MIN_LENGTH = 4;

// The directory rows of the one source in use.
const ofSource = eq(playerDirectoryEntries.statsSource, STATS_SOURCE);
/** A followed player that an identity is linked to already (CL-JOU-04). */
export type FollowedAs = Readonly<{ playerId: PlayerId; displayName: string }>;

/** A source identity offered for confirmation, with what tells namesakes apart (JOU-10, STA-03, CL-JOU-04). */
export type Candidate = Readonly<{
  sourcePlayerRef: SourcePlayerId;
  /** As the source writes it, in his latest season. */
  displayName: string;
  /** His team in the latest season the directory holds, or null when he did not play in it. */
  currentTeamId: number | null;
  /** The teams of his lines, most recent first. */
  teamIds: readonly number[];
  firstSeason: Season | null;
  lastSeason: Season | null;
  /** The followed player whom this identity is linked to already, which forbids confirming it. */
  followedAs: FollowedAs | null;
}>;

/** A directory refused because teams of its lines are not known yet: nothing of it is written. */
export type UnknownTeams = Readonly<{ kind: 'unknown_teams'; teams: readonly SourceTeamId[] }>;

/** The folded names of each directory identity, which the search matches. */
export type SearchIndex = readonly Readonly<{ ref: SourcePlayerId; searchNames: string[] }>[];

/**
 * A name folded for the candidate search: compared as `players.normalizeName` compares
 * it (CL-JOU-13: NFC, trimmed, inner spaces collapsed, lowercase), and with accents and
 * other diacritics removed too, which `normalizeName` keeps (JOU-10, module map §2.4).
 */
function foldName(name: string): string {
  return normalizeName(name).normalize('NFD').replaceAll(COMBINING_MARKS, '').normalize('NFC');
}

const wordsOf = (folded: string): string[] =>
  folded.split(WORD_SEPARATOR).filter((word) => word !== '');

/** Whether `a` becomes `b` by one substitution, insertion or deletion at most. */
function isWithinOneEdit(a: string, b: string): boolean {
  let shared = 0;
  while (shared < a.length && a[shared] === b[shared]) {
    shared += 1;
  }
  const restA = a.slice(shared);
  const restB = b.slice(shared);
  return restA.slice(1) === restB.slice(1) || restA.slice(1) === restB || restA === restB.slice(1);
}

/** Whether a name word answers a query word: it starts with it, or a long one is a typing slip away. */
const isAnswer = (query: string, word: string): boolean =>
  word.startsWith(query) || (query.length >= CLOSE_WORD_MIN_LENGTH && isWithinOneEdit(query, word));

/** Whether a folded name is close to a query's words: every one of them is answered by one of its words. */
const isCloseName = (queryWords: readonly string[], name: string): boolean => {
  const words = wordsOf(name);
  return queryWords.every((query) => words.some((word) => isAnswer(query, word)));
};

const compareText = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/** The source's team identifiers among `refs` that an application team carries. */
async function knownTeams(tx: Transaction, refs: readonly SourceTeamId[]): Promise<string[]> {
  const rows = await tx
    .select({ ref: teamSourceRefs.sourceTeamRef })
    .from(teamSourceRefs)
    .where(
      and(
        eq(teamSourceRefs.statsSource, STATS_SOURCE),
        inArray(teamSourceRefs.sourceTeamRef, [...refs]),
      ),
    );
  return rows.map((row) => row.ref);
}

/** The directory entry of `ref` in `season`, as a subquery of its identifier. */
const entryOf = (season: Season, ref: SourcePlayerId) =>
  sql<number>`(SELECT ${playerDirectoryEntries.id} FROM ${playerDirectoryEntries} WHERE ${ofSource} AND ${playerDirectoryEntries.season} = ${season} AND ${playerDirectoryEntries.sourcePlayerRef} = ${ref})`;

/** The application team of the source's team `ref`, as a subquery of its identifier. */
const teamOf = (ref: SourceTeamId) =>
  sql<number>`(SELECT ${teamSourceRefs.teamId} FROM ${teamSourceRefs} WHERE ${teamSourceRefs.statsSource} = ${STATS_SOURCE} AND ${teamSourceRefs.sourceTeamRef} = ${ref})`;

/**
 * Stores the season's player directory that `getSeasonPlayers` answered, in the
 * caller's transaction `tx`, replacing whole what an earlier read stored: each player's
 * names as the source writes them, folded for the search, and each team of his lines
 * with its first and last game days. A season without its `seasons` row gets it first,
 * its coverage pending, so that a past season's directory is stored before its games
 * are read. Nothing deletes a directory otherwise, a player-data deletion included,
 * since it names no followed player. Refused, writing nothing, while a team of its
 * lines has no application team yet (STA-03, JOU-10, CL-STA-29, module map choice 31).
 */
export async function storeDirectory(
  tx: Transaction,
  { season, entries }: Readonly<{ season: Season; entries: readonly DirectoryEntry[] }>,
): Promise<Result<Readonly<{ stored: number }>, UnknownTeams>> {
  const refs = [...new Set(entries.flatMap((entry) => entry.teams.map((team) => team.team)))];
  const known = new Set(refs.length === 0 ? [] : await knownTeams(tx, refs));
  const unknown = refs.filter((ref) => !known.has(ref));
  if (unknown.length > 0) {
    return err({ kind: 'unknown_teams', teams: unknown });
  }
  await tx.insert(seasons).values({ season, statsSource: STATS_SOURCE }).onConflictDoNothing();
  await tx
    .delete(playerDirectoryEntries)
    .where(and(ofSource, eq(playerDirectoryEntries.season, season)));
  if (entries.length === 0) {
    return ok({ stored: 0 });
  }
  const fetchedAt = new Date(now());
  await tx.insert(playerDirectoryEntries).values(
    entries.map((entry) => ({
      statsSource: STATS_SOURCE,
      season,
      sourcePlayerRef: entry.player,
      displayName: entry.displayName,
      searchNames: [
        ...new Set([entry.displayName, ...entry.otherNames].map((name) => foldName(name))),
      ],
      fetchedAt,
    })),
  );
  const teamRows = entries.flatMap((entry) =>
    entry.teams.map((team) => ({
      entryId: entryOf(season, entry.player),
      teamId: teamOf(team.team),
      firstGameOn: team.firstGameDay,
      lastGameOn: team.lastGameDay,
    })),
  );
  if (teamRows.length > 0) {
    await tx.insert(playerDirectoryTeams).values(teamRows);
  }
  return ok({ stored: entries.length });
}

/** The folded names of every identity of the stored directory, read once per search or refresh. */
export async function readSearchIndex(db: Executor): Promise<SearchIndex> {
  return db
    .selectDistinct({
      ref: playerDirectoryEntries.sourcePlayerRef,
      searchNames: playerDirectoryEntries.searchNames,
    })
    .from(playerDirectoryEntries)
    .where(ofSource);
}

/** The identities found for a search, in the index's order, and those of them with one of its names exactly. */
type Matches = Readonly<{
  refs: readonly SourcePlayerId[];
  sameNames: ReadonlySet<SourcePlayerId>;
}>;

/** The identities whose names are close to one of `names`, and those that bear one of them. */
function matchIndex(index: SearchIndex, names: readonly string[]): Matches {
  const queries = names.map((name) => foldName(name)).filter((name) => wordsOf(name).length > 0);
  const refs = new Set<SourcePlayerId>();
  const sameNames = new Set<SourcePlayerId>();
  for (const { ref, searchNames } of index) {
    const isClose = searchNames.some((name) =>
      queries.some((query) => isCloseName(wordsOf(query), name)),
    );
    if (!isClose) {
      continue;
    }
    refs.add(ref);
    if (searchNames.some((name) => queries.includes(name))) {
      sameNames.add(ref);
    }
  }
  return { refs: [...refs], sameNames };
}

/** The followed players whom the identities `refs` are linked to by an established mapping (CL-JOU-04). */
export async function linkedPlayers(
  db: Executor,
  refs: readonly SourcePlayerId[],
): Promise<ReadonlyMap<SourcePlayerId, FollowedAs>> {
  if (refs.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      ref: sql<SourcePlayerId>`${statsSourceMappings.sourcePlayerRef}`,
      playerId: followedPlayers.id,
      displayName: followedPlayers.displayName,
    })
    .from(statsSourceMappings)
    .innerJoin(followedPlayers, eq(followedPlayers.id, statsSourceMappings.playerId))
    .where(
      and(
        eq(statsSourceMappings.statsSource, STATS_SOURCE),
        inArray(statsSourceMappings.sourcePlayerRef, [...refs]),
      ),
    );
  return new Map(rows.map(({ ref, playerId, displayName }) => [ref, { playerId, displayName }]));
}

/** One directory line of an identity, with the latest season the directory holds. */
type DirectoryLine = Readonly<{
  ref: SourcePlayerId;
  season: Season;
  displayName: string;
  teamId: number;
  latestSeason: Season;
}>;
/** What the lines of one identity say, read from his latest line back. */
type Draft = { latest: DirectoryLine; firstSeason: Season; teamIds: Set<number> };

/** Folds the lines of each identity, latest first, into what tells him apart, in the order first met. */
function draftsOf(lines: readonly DirectoryLine[]): readonly Draft[] {
  const drafts = new Map<SourcePlayerId, Draft>();
  const order: Draft[] = [];
  for (const line of lines) {
    const draft = drafts.get(line.ref);
    if (draft === undefined) {
      const first = { latest: line, firstSeason: line.season, teamIds: new Set([line.teamId]) };
      drafts.set(line.ref, first);
      order.push(first);
    } else {
      draft.firstSeason = line.season;
      draft.teamIds.add(line.teamId);
    }
  }
  return order;
}

/** The order of candidates: the same names first, then the latest seasons, then by name. */
const byRelevance =
  (sameNames: ReadonlySet<SourcePlayerId>) =>
  ({ latest: a }: Draft, { latest: b }: Draft): number =>
    [
      Number(sameNames.has(b.ref)) - Number(sameNames.has(a.ref)),
      compareText(b.season, a.season),
      compareText(a.displayName, b.displayName),
      compareText(a.ref, b.ref),
    ].find((order) => order !== 0) ?? 0;

/** Describes the matched identities from their directory lines, in the order of relevance. */
async function describe(db: Executor, { refs, sameNames }: Matches): Promise<readonly Candidate[]> {
  if (refs.length === 0) {
    return [];
  }
  const lines = await db
    .select({
      ref: playerDirectoryEntries.sourcePlayerRef,
      season: playerDirectoryEntries.season,
      displayName: playerDirectoryEntries.displayName,
      teamId: playerDirectoryTeams.teamId,
      latestSeason: sql<Season>`(SELECT max(${playerDirectoryEntries.season}) FROM ${playerDirectoryEntries} WHERE ${ofSource})`,
    })
    .from(playerDirectoryEntries)
    .innerJoin(playerDirectoryTeams, eq(playerDirectoryTeams.entryId, playerDirectoryEntries.id))
    .where(and(ofSource, inArray(playerDirectoryEntries.sourcePlayerRef, refs)))
    .orderBy(desc(playerDirectoryEntries.season), desc(playerDirectoryTeams.lastGameOn));
  const linked = await linkedPlayers(db, refs);
  const drafts = draftsOf(lines).toSorted(byRelevance(sameNames));
  return drafts.map(({ latest, firstSeason, teamIds }) => ({
    sourcePlayerRef: latest.ref,
    displayName: latest.displayName,
    currentTeamId: latest.season === latest.latestSeason ? latest.teamId : null,
    teamIds: [...teamIds],
    firstSeason,
    lastSeason: latest.season,
    followedAs: linked.get(latest.ref) ?? null,
  }));
}

/** The candidates for `names` in `index`, a search index read once for several searches (JOU-10). */
export async function candidatesIn(
  db: Executor,
  index: SearchIndex,
  names: readonly string[],
): Promise<readonly Candidate[]> {
  return describe(db, matchIndex(index, names));
}

/**
 * The candidates for a player known by `names`, searched in the stored directory only,
 * never through the source, so that adding a player never waits for it: every identity
 * one of whose names is close to one of `names` once case and accents are folded,
 * namesakes and close names included (each query word starting a word of his name, or
 * a word of four letters or more one typing slip away), the same names first, each
 * with his name, teams and seasons, and the followed player he is linked to already,
 * which forbids confirming him (STA-03, JOU-10, CL-JOU-04, CL-STA-29).
 */
export async function searchCandidates(
  db: Executor,
  names: readonly string[],
): Promise<readonly Candidate[]> {
  return candidatesIn(db, await readSearchIndex(db), names);
}
