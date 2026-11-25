import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  followedPlayers,
  playerDirectoryEntries,
  playerDirectoryTeams,
  seasons,
  teamSourceRefs,
} from '@/lib/db';
import { createFakeStatsSource } from '@/lib/stats-source';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, now, toEpochMs, toIsoDate } from '@/lib/time';

import { searchCandidates, storeDirectory } from './directory';

import type { Database } from '@/lib/db';
import type { DirectoryEntry, FakeStatsSource } from '@/lib/stats-source';

const START = toEpochMs(Date.UTC(2026, 10, 10, 12));
const CALL_WINDOW_MS = 60_000;
// The players of the invented league's directory of 2025-26.
const PLAYERS_OF_2025_26 = 8;

/** The directory of `season` as the fake answers it. */
async function readDirectory(source: FakeStatsSource, season: string) {
  const ctx = { deadline: toEpochMs(now() + CALL_WINDOW_MS), signal: new AbortController().signal };
  const outcome = await source.getSeasonPlayers(ctx, { season, knownVersion: null });
  if (!outcome.ok || outcome.value.kind !== 'read') {
    throw new Error(`the fake did not answer the directory of ${season}`);
  }
  return outcome.value.data;
}

const store = async (db: Database, season: string, entries: readonly DirectoryEntry[]) =>
  db.transaction(async (tx) => storeDirectory(tx, { season, entries }));

/** What the database holds of the directory of `season`, entry by entry, with each one's teams. */
async function storedDirectory(db: Database, season: string) {
  const entries = await db
    .select()
    .from(playerDirectoryEntries)
    .where(eq(playerDirectoryEntries.season, season))
    .orderBy(asc(playerDirectoryEntries.sourcePlayerRef));
  const teams = await db
    .select()
    .from(playerDirectoryTeams)
    .orderBy(asc(playerDirectoryTeams.firstGameOn));
  return entries.map((entry) => ({
    ref: entry.sourcePlayerRef,
    displayName: entry.displayName,
    searchNames: entry.searchNames,
    fetchedAt: entry.fetchedAt,
    teams: teams
      .filter((team) => team.entryId === entry.id)
      .map(({ teamId, firstGameOn, lastGameOn }) => ({ teamId, firstGameOn, lastGameOn })),
  }));
}

const refsOf = (candidates: readonly { sourcePlayerRef: string }[]) =>
  candidates.map((candidate) => candidate.sourcePlayerRef);

/** One of the two namesakes of the league, as a candidate of the directories of 2024-25 and 2025-26. */
const castell = (ref: 'p02' | 'p03', currentTeamId: number, teamIds: readonly number[]) => ({
  sourcePlayerRef: ref,
  displayName: 'Dario Castell',
  currentTeamId,
  teamIds,
  firstSeason: '2024-25',
  lastSeason: '2025-26',
  followedAs: null,
});

describe(
  'the player directory and the candidate search',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;
    let source: FakeStatsSource;
    let team: (ref: string) => number;

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(START));
      source = createFakeStatsSource();
      await insertLeagueSeason(db, '2025-26');
      const refs = await db.select().from(teamSourceRefs);
      team = (ref) => refs.find((row) => row.sourceTeamRef === ref)?.teamId ?? -1;
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[STA-03] stores a season whole, names as the source writes them and folded, teams with their first and last game days, and replaces it at each read', async () => {
      const directory = await readDirectory(source, '2025-26');
      expect(await store(db, '2025-26', directory)).toStrictEqual({
        ok: true,
        value: { stored: PLAYERS_OF_2025_26 },
      });
      const served = directory.find((entry) => entry.player === 'p02')?.teams ?? [];
      expect(served.map((line) => line.team)).toStrictEqual(['2', '3']);
      const teams = served.map((line) => ({
        teamId: team(line.team),
        firstGameOn: line.firstGameDay,
        lastGameOn: line.lastGameDay,
      }));
      const stored = await storedDirectory(db, '2025-26');
      expect(stored.find((entry) => entry.ref === 'p02')).toStrictEqual({
        ref: 'p02',
        displayName: 'Dario Castell',
        searchNames: ['dario castell', 'd. castell'],
        fetchedAt: new Date(START),
        teams,
      });

      const renamed = {
        player: 'p02',
        displayName: 'Dário Castell',
        otherNames: [],
        teams: served,
      };
      const replaced = await store(db, '2025-26', [renamed]);
      expect({ replaced, stored: await storedDirectory(db, '2025-26') }).toStrictEqual({
        replaced: { ok: true, value: { stored: 1 } },
        stored: [
          {
            ref: 'p02',
            displayName: 'Dário Castell',
            searchNames: ['dario castell'],
            fetchedAt: new Date(START),
            teams,
          },
        ],
      });
      const emptied = await store(db, '2025-26', []);
      expect({ emptied, stored: await storedDirectory(db, '2025-26') }).toStrictEqual({
        emptied: { ok: true, value: { stored: 0 } },
        stored: [],
      });
    });

    it('[STA-03] writes the seasons row of a season that has none, its coverage pending, and leaves an existing one as it is', async () => {
      const [existing] = await db.select().from(seasons).where(eq(seasons.season, '2025-26'));
      await store(db, '2025-26', await readDirectory(source, '2025-26'));
      const stored = await store(db, '2024-25', await readDirectory(source, '2024-25'));
      expect(stored.ok).toBe(true);
      expect(await db.select().from(seasons).orderBy(asc(seasons.season))).toStrictEqual([
        {
          season: '2024-25',
          statsSource: 'sportsdataverse_espn',
          phasesWithLines: [],
          gamesWithoutLines: 0,
          coverageFetchedAt: null,
        },
        existing,
      ]);
    });

    it('[STA-03] refuses, writing nothing, a directory whose teams are not known yet', async () => {
      const database = await createTestDatabase();
      const empty = database.db;
      const answer = await store(empty, '2025-26', await readDirectory(source, '2025-26'));
      expect({
        answer,
        seasons: await empty.select().from(seasons),
        entries: await empty.select().from(playerDirectoryEntries),
      }).toStrictEqual({
        answer: {
          ok: false,
          error: { kind: 'unknown_teams', teams: ['1', '2', '3', '4', '5', '6'] },
        },
        seasons: [],
        entries: [],
      });
      await database.close();
    });

    it('[STA-03] keeps the directory when a followed player and his data are deleted', async () => {
      await store(db, '2025-26', await readDirectory(source, '2025-26'));
      const player = await insertPlayer(db, { source: 'p02' });
      await db.delete(followedPlayers).where(eq(followedPlayers.id, player.id));
      expect(await storedDirectory(db, '2025-26')).toHaveLength(PLAYERS_OF_2025_26);
    });

    it('[JOU-10] finds homonyms and close names with their name, teams and seasons, and only them', async () => {
      await store(db, '2024-25', await readDirectory(source, '2024-25'));
      await store(db, '2025-26', await readDirectory(source, '2025-26'));
      expect(await searchCandidates(db, ['Dario Castell'])).toStrictEqual([
        castell('p02', team('3'), [team('3'), team('2')]),
        castell('p03', team('4'), [team('4')]),
      ]);
      const close = ['DARÍO CASTEL', 'Dario Kastell', 'Dar Castell', 'D. Castell', 'castell'];
      const found = await Promise.all(close.map(async (name) => searchCandidates(db, [name])));
      expect(found.map((candidates) => refsOf(candidates))).toStrictEqual(
        close.map(() => ['p02', 'p03']),
      );
      const far = [
        ['Ansel Castell'],
        ['Dax Castell'],
        ['Dario Castellanos Ruiz'],
        [''],
        [' - '],
        [],
      ];
      const none = await Promise.all(far.map(async (names) => searchCandidates(db, names)));
      expect(none).toStrictEqual(far.map(() => []));
      expect(await searchCandidates(db, ['Teodor Quill'])).toStrictEqual([
        {
          sourcePlayerRef: 'p06',
          displayName: 'Teodor Quill',
          currentTeamId: null,
          teamIds: [team('1')],
          firstSeason: '2024-25',
          lastSeason: '2024-25',
          followedAs: null,
        },
      ]);
    });

    it('[JOU-10] folds case and accents, and gives the same names before close ones of later seasons', async () => {
      await store(db, '2025-26', await readDirectory(source, '2025-26'));
      const days = { firstGameDay: toIsoDate('2026-10-21'), lastGameDay: toIsoDate('2026-11-02') };
      const accented = {
        player: 'x1',
        displayName: 'Émile Brontë-Dúrand',
        otherNames: ['É. Brontë-Dúrand'],
        teams: [{ team: '5', ...days }],
      };
      const later = { ...accented, player: 'x2', displayName: 'Dario Castellan', otherNames: [] };
      await store(db, '2026-27', [accented, later]);
      const stored = await storedDirectory(db, '2026-27');
      expect(stored.map((entry) => entry.searchNames)).toStrictEqual([
        ['emile bronte-durand', 'e. bronte-durand'],
        ['dario castellan'],
      ]);
      expect(await searchCandidates(db, ['EMILE BRONTE DURAND', 'Unknown Name'])).toStrictEqual([
        {
          sourcePlayerRef: 'x1',
          displayName: 'Émile Brontë-Dúrand',
          currentTeamId: team('5'),
          teamIds: [team('5')],
          firstSeason: '2026-27',
          lastSeason: '2026-27',
          followedAs: null,
        },
      ]);
      const ordered = await searchCandidates(db, ['Dario Castell']);
      expect(refsOf(ordered)).toStrictEqual(['p02', 'p03', 'x2']);
    });

    it('[JOU-10] shows an identity linked already as followed by that player (CL-JOU-04)', async () => {
      await store(db, '2025-26', await readDirectory(source, '2025-26'));
      await insertPlayer(db, { source: 'p03' });
      const candidates = await searchCandidates(db, ['Dario Castell']);
      expect(
        candidates.map(({ sourcePlayerRef, followedAs }) => [sourcePlayerRef, followedAs]),
      ).toStrictEqual([
        ['p02', null],
        ['p03', { playerId: leaguePlayerId('p03'), displayName: 'Dario Castell' }],
      ]);
    });
  },
);
