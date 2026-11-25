import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { asc, eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, games, series } from '@/lib/db';
import { createFakeStatsSource, statsSource } from '@/lib/stats-source';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { localOccurrenceInstant, now, toEpochMs, toIsoDate } from '@/lib/time';

import { ingestSeasonGames } from './ingest';

import type { SeriesRow } from './types';
import type { Database } from '@/lib/db';
import type { SeasonGames, SourceGame, StatsSource } from '@/lib/stats-source';

const SOURCE = 'sportsdataverse_espn' as const;
const READ_AT = toEpochMs(Date.UTC(2026, 10, 8, 12));
const EASTERN = 'America/New_York';
const RECORDED = path.join(import.meta.dirname, '../../../data/fixtures/stats-source/recorded');
// How long a read of the fake or of the recorded release may take.
const CALL_DEADLINE_MS = 60_000;
// The columns that differ between two databases filled alike: identifiers and instants.
const UNCOMPARED: ReadonlySet<string> = new Set([
  'id',
  'seriesId',
  'lastFetchedAt',
  'scheduleChangedAt',
]);
// The playoff series of a season after 2001-02, each `round winsNeeded isRebuilt`, and
// of 2001-02, whose first round was played in three wins (CL-STA-18).
const LATER_ROUNDS = {
  'first_round 4 true': 8,
  'conference_semifinals 4 true': 4,
  'conference_finals 4 true': 2,
  'finals 4 true': 1,
};
const ROUNDS_OF_2002 = {
  'first_round 3 true': 8,
  'conference_semifinals 4 true': 4,
  'conference_finals 4 true': 2,
  'finals 4 true': 1,
};

/** A season's games as `source` reads them. */
async function seasonOf(source: StatsSource, season: string): Promise<SeasonGames> {
  const ctx = {
    deadline: toEpochMs(now() + CALL_DEADLINE_MS),
    signal: new AbortController().signal,
  };
  const read = await source.getSeasonGames(ctx, { season, knownVersion: null });
  if (!read.ok || read.value.kind !== 'read') {
    throw new Error(`Expected the games of ${season}.`);
  }
  return read.value.data;
}

/** A season's games as the fake serves the invented league. */
const served = async (season: string): Promise<SeasonGames> =>
  seasonOf(createFakeStatsSource(), season);

/** A season's games as the SportsDataverse adapter reads them from the recorded release. */
async function recorded(season: string): Promise<SeasonGames> {
  vi.stubGlobal('fetch', async (address: string) => {
    const file = path.basename(new URL(address).pathname).replaceAll('_', '-');
    const body = await readFile(path.join(RECORDED, file));
    return new Response(body, { headers: { etag: `"${file}"` } });
  });
  const access = statsSource();
  if (!access.ok) {
    throw new Error('Expected the SportsDataverse adapter.');
  }
  return seasonOf(access.source, season);
}

/** The game `ref` of an answer. */
function gameIn(answer: SeasonGames, ref: string): SourceGame {
  const game = answer.games.find(({ game: id }) => id === ref);
  if (game === undefined) {
    throw new Error(`Expected the game ${ref}.`);
  }
  return game;
}

/** A row without the columns that two databases filled alike do not share. */
const compared = (row: object) =>
  Object.fromEntries(Object.entries(row).filter(([column]) => !UNCOMPARED.has(column)));

const byNumber = (left: number, right: number): number => left - right;

/** How many playoff series of `season` have each round, wins needed and rebuilt flag. */
function roundsOf(rows: readonly SeriesRow[], season: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.season !== season || row.phase !== 'playoffs') {
      continue;
    }
    const key = `${String(row.round)} ${String(row.winsNeeded)} ${String(row.isRebuilt)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

describe('the series of the ingested seasons', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Moves the test to a database of its own, closed when it ends. */
  async function freshDatabase(): Promise<void> {
    const database = await createTestDatabase();
    onTestFinished(database.close);
    db = database.db;
  }

  /** Ingests `answer` as the file of `season` and gives what it changed. */
  async function ingest(season: string, answer: SeasonGames) {
    const result = await db.transaction(async (tx) =>
      ingestSeasonGames(tx, { season, statsSource: SOURCE, answer, fetchedAt: READ_AT }),
    );
    if (!result.ok) {
      throw new Error(`Expected the games of ${season} to be stored.`);
    }
    return result.value;
  }

  /** The stored games and series, without their identifiers and instants, as two orders of ingestion compare them. */
  async function filed() {
    const [gameRows, seriesRows] = await Promise.all([
      db.select().from(games).orderBy(asc(games.sourceGameRef)),
      db
        .select()
        .from(series)
        .orderBy(asc(series.season), asc(series.phase), asc(series.teamAId), asc(series.teamBId)),
    ]);
    return {
      games: gameRows.map((row) => ({
        ...compared(row),
        ref: row.sourceGameRef,
        isInSeries: row.seriesId !== null,
      })),
      series: seriesRows.map((row) => compared(row)),
    };
  }

  it('[STA-05] [STA-07] [CL-STA-18] gives each postseason game its series, number, wins before and elimination flag from the rebuild, unknown once a later season shows that its series ended without a winner', async () => {
    const positions = async () =>
      db
        .select({
          ref: games.sourceGameRef,
          round: series.round,
          winsNeeded: series.winsNeeded,
          isRebuilt: series.isRebuilt,
          number: games.gameNumber,
          home: games.homeSeriesWinsBefore,
          away: games.awaySeriesWinsBefore,
          isElimination: games.isEliminationGame,
        })
        .from(games)
        .innerJoin(series, eq(series.id, games.seriesId))
        .where(
          inArray(games.sourceGameRef, [
            '2024-25:pi',
            '2024-25:s1g1',
            '2024-25:s1g2',
            '2024-25:s1g3',
          ]),
        )
        .orderBy(asc(games.sourceGameRef));
    const playIn = {
      ref: '2024-25:pi',
      round: 'play_in_7_vs_8',
      winsNeeded: 1,
      isRebuilt: true,
      number: 1,
      home: 0,
      away: 0,
      isElimination: false,
    };
    const firstRound = { round: 'first_round', winsNeeded: 4 };
    const rebuilt = { ...firstRound, isRebuilt: true, isElimination: false };
    const unknown = {
      ...firstRound,
      isRebuilt: false,
      home: null,
      away: null,
      isElimination: null,
    };

    const first = await ingest('2024-25', await served('2024-25'));

    expect(first.seasons).toStrictEqual(['2024-25']);
    await expect(positions()).resolves.toStrictEqual([
      playIn,
      { ...rebuilt, ref: '2024-25:s1g1', number: 1, home: 0, away: 0 },
      { ...rebuilt, ref: '2024-25:s1g2', number: 2, home: 0, away: 1 },
      { ...rebuilt, ref: '2024-25:s1g3', number: 3, home: 1, away: 1 },
    ]);

    const next = await ingest('2025-26', await served('2025-26'));

    const rows = await db.select().from(games);
    const playoffGames = rows.filter(({ sourceGameRef }) => sourceGameRef.startsWith('2024-25:s'));
    expect({
      seasons: next.seasons,
      modifiedGameIds: next.modifiedGameIds.toSorted(byNumber),
    }).toStrictEqual({
      modifiedGameIds: playoffGames.map(({ id }) => id).toSorted(byNumber),
      seasons: ['2025-26', '2024-25'],
    });
    await expect(positions()).resolves.toStrictEqual([
      playIn,
      { ...unknown, ref: '2024-25:s1g1', number: 1 },
      { ...unknown, ref: '2024-25:s1g2', number: 2 },
      { ...unknown, ref: '2024-25:s1g3', number: 3 },
    ]);
  });

  it('[CL-STA-28] leaves a row dated before 1 July of the season first year to the season before, and keeps a game that two files list once, under the earlier season, whichever file comes first', async () => {
    const [older, newer] = await Promise.all([served('2024-25'), served('2025-26')]);
    const finals = gameIn(older, '2024-25:s3g3');
    const lateDay = toIsoDate('2025-07-15');
    const late = {
      ...finals,
      game: 'late-finals',
      gameDay: lateDay,
      tipOff: localOccurrenceInstant(lateDay, '19:30', EASTERN),
      series: { round: 'finals', gameNumber: 4 },
    } as const;
    const early = {
      ...gameIn(older, '2024-25:r01:h1'),
      season: '2025-26',
      status: 'scheduled',
      score: null,
      overtimes: null,
    } as const;
    const olderFile = { ...older, games: [...older.games, late] };
    const newerFile = { ...newer, games: [...newer.games, early, { ...late, season: '2025-26' }] };

    await ingest('2024-25', olderFile);
    await ingest('2025-26', newerFile);
    const oneOrder = await filed();
    await freshDatabase();
    await ingest('2025-26', newerFile);
    const moved = await ingest('2024-25', olderFile);

    await expect(filed()).resolves.toStrictEqual(oneOrder);
    expect(moved.seasons).toStrictEqual(['2024-25', '2025-26']);
    const filedOf = (ref: string) => oneOrder.games.find((game) => game.ref === ref);
    expect(filedOf('late-finals')).toMatchObject({ season: '2024-25', gameNumber: 4 });
    expect(filedOf('2024-25:r01:h1')).toMatchObject({ season: '2024-25', status: 'final' });
    expect(oneOrder.series.filter(({ season }) => season === '2025-26')).toHaveLength(4);
  });

  it('[CL-STA-28] stores a row of a season file from 1 July of the season first year, and never an earlier one, even when no file of the season before lists it', async () => {
    const newer = await served('2025-26');
    const dated = (game: string, day: string) => {
      const gameDay = toIsoDate(day);
      const tipOff = localOccurrenceInstant(gameDay, '19:30', EASTERN);
      return { ...gameIn(newer, '2025-26:r01:h1'), game, gameDay, tipOff };
    };
    const file = {
      ...newer,
      games: [...newer.games, dated('before-cut', '2025-06-30'), dated('at-cut', '2025-07-01')],
    };

    const result = await ingest('2025-26', file);

    const official = newer.games.filter(({ exclusion }) => exclusion === null);
    expect(result.newGameIds).toHaveLength(official.length + 1);
    const rows = await db
      .select({ ref: games.sourceGameRef, season: games.season })
      .from(games)
      .where(inArray(games.sourceGameRef, ['before-cut', 'at-cut']));
    expect(rows).toStrictEqual([{ ref: 'at-cut', season: '2025-26' }]);
  });

  it('[STA-05] [STA-07] [CL-STA-16] [CL-STA-17] [CL-STA-18] stores the recorded release as the engine rebuilds it: a labeled round for each 2024-25 pairing, the unlabeled 2001-02 rounds from their order, and no game that never counts', async () => {
    const recent = await recorded('2024-25');
    await ingest('2024-25', recent);
    await ingest('2001-02', await recorded('2001-02'));

    const rows = await db.select().from(series);
    const stored = await db.select().from(games);
    const refs = new Set(stored.map(({ sourceGameRef }) => sourceGameRef));
    const neverCounting = recent.games.filter(({ exclusion }) => exclusion !== null);
    const makeUps = recent.games.filter(({ makeUpOf }) => makeUpOf !== null);
    const finalsId = rows.find((row) => row.season === '2024-25' && row.round === 'finals')?.id;
    const finalsGames = stored
      .filter(({ seriesId }) => seriesId === (finalsId ?? null))
      .toSorted((left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime())
      .map(({ gameNumber, isEliminationGame }) => [gameNumber, isEliminationGame]);
    expect(roundsOf(rows, '2024-25')).toStrictEqual(LATER_ROUNDS);
    expect(roundsOf(rows, '2001-02')).toStrictEqual(ROUNDS_OF_2002);
    expect({
      hasExcluded: neverCounting.length > 0,
      hasMakeUps: makeUps.length > 0,
      stored: [...neverCounting, ...makeUps].filter(({ game }) => refs.has(game)),
    }).toStrictEqual({ hasExcluded: true, hasMakeUps: true, stored: [] });
    expect(finalsGames).toStrictEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
      [6, true],
      [7, true],
    ]);
  });
});
