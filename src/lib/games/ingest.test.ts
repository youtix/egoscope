import { asc, eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  games,
  journalEntries,
  journalTechnicalDetails,
  seasons,
  series,
  teams,
  teamSeasons,
  teamSourceRefs,
} from '@/lib/db';
import { createFakeStatsSource } from '@/lib/stats-source';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { gameDayStart, localOccurrenceInstant, toEpochMs, toIsoDate } from '@/lib/time';

import { ingestSeasonGames, meetSeason } from './ingest';

import type { Database } from '@/lib/db';
import type { SeasonGames, SourceGame } from '@/lib/stats-source';
import type { EpochMs } from '@/lib/time';

const SOURCE = 'sportsdataverse_espn' as const;
const READ_AT = toEpochMs(Date.UTC(2026, 10, 8, 12));
const LATER = toEpochMs(Date.UTC(2026, 10, 9, 12));
const CONTEXT = { deadline: toEpochMs(Date.UTC(2100, 0, 1)), signal: new AbortController().signal };
const EASTERN = 'America/New_York';
// The fake league's first covered season (data/fixtures/stats-source/world/).
const FIRST_COVERED = '2024-25';
// A status value longer than the warning keeps, and the hundred characters it keeps (CL-STA-17).
const LONG_STATUS = 'S'.repeat(150);
const KEPT_STATUS = 'S'.repeat(100);
const EMPTY: SeasonGames = {
  games: [],
  teams: [],
  coverage: { phasesWithBoxScores: [], gamesWithoutBoxScores: [] },
  heldBack: [],
};

/** A season's games as the fake serves the invented league. */
async function served(season: string): Promise<SeasonGames> {
  const read = await createFakeStatsSource().getSeasonGames(CONTEXT, {
    season,
    knownVersion: null,
  });
  if (!read.ok || read.value.kind !== 'read') {
    throw new Error(`Expected the games of ${season}.`);
  }
  return read.value.data;
}

/** The game `ref` of an answer. */
function gameIn(answer: SeasonGames, ref: string): SourceGame {
  const game = answer.games.find(({ game: id }) => id === ref);
  if (game === undefined) {
    throw new Error(`Expected the game ${ref}.`);
  }
  return game;
}

/** An answer whose game `ref` takes `change`. */
const changed = (answer: SeasonGames, ref: string, change: Partial<SourceGame>): SeasonGames => ({
  ...answer,
  games: answer.games.map((game) => (game.game === ref ? { ...game, ...change } : game)),
});

describe('ingestSeasonGames', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Ingests `answer` as the file of `season`, read at `fetchedAt`, and gives what it changed. */
  async function ingest(season: string, answer: SeasonGames, fetchedAt: EpochMs = READ_AT) {
    const result = await db.transaction(async (tx) =>
      ingestSeasonGames(tx, { season, statsSource: SOURCE, answer, fetchedAt }),
    );
    if (!result.ok) {
      throw new Error(`Expected the games of ${season} to be stored.`);
    }
    return result.value;
  }

  /** The stored game `ref`. */
  async function stored(ref: string) {
    const [row] = await db.select().from(games).where(eq(games.sourceGameRef, ref));
    return row;
  }

  /** Every row of the tables that the ingestion writes. */
  async function everything() {
    return Promise.all([
      db.select().from(games).orderBy(asc(games.id)),
      db.select().from(series).orderBy(asc(series.id)),
      db.select().from(teams).orderBy(asc(teams.id)),
      db.select().from(teamSourceRefs).orderBy(asc(teamSourceRefs.sourceTeamRef)),
      db.select().from(teamSeasons).orderBy(asc(teamSeasons.season), asc(teamSeasons.teamId)),
      db.select().from(seasons).orderBy(asc(seasons.season)),
    ]);
  }

  it('[STA-05] [STA-29] [STA-42] [CL-STA-03] [CL-STA-23] stores the season with its source and coverage and every official game of an answer, and changes nothing when the same answer comes again', async () => {
    const answer = await served('2025-26');

    const first = await ingest('2025-26', answer);
    const before = await everything();
    const again = await ingest('2025-26', answer);

    const official = answer.games.filter(({ exclusion }) => exclusion === null);
    expect({ ...first, newGameIds: first.newGameIds.length }).toStrictEqual({
      newGameIds: official.length,
      modifiedGameIds: [],
      seasons: ['2025-26'],
    });
    expect(again).toStrictEqual({ newGameIds: [], modifiedGameIds: [], seasons: [] });
    await expect(everything()).resolves.toStrictEqual(before);
    const overtime = gameIn(answer, '2025-26:r02:h2');
    await expect(stored(overtime.game)).resolves.toMatchObject({
      statsSource: SOURCE,
      season: '2025-26',
      phase: 'regular_season',
      status: 'final',
      scheduledStartAt: new Date(localOccurrenceInstant(overtime.gameDay, '19:30', EASTERN)),
      isStartTimeTbd: false,
      homeScore: overtime.score?.home,
      awayScore: overtime.score?.away,
      overtimeCount: 1,
      homeLinesPublished: true,
      awayLinesPublished: true,
      seriesId: null,
      lastFetchedAt: new Date(READ_AT),
      scheduleChangedAt: new Date(READ_AT),
    });
    const abroad = gameIn(answer, '2025-26:r08:h6');
    await expect(stored(abroad.game)).resolves.toMatchObject({
      gameDayOn: abroad.gameDay,
      scheduledStartAt: new Date(localOccurrenceInstant(abroad.gameDay, '14:00', EASTERN)),
      overtimeCount: 0,
    });
  });

  it('[STA-42] moves only the fetch instant of the games that a later read finds unchanged', async () => {
    const answer = await served('2025-26');
    await ingest('2025-26', answer);
    const [before] = await everything();

    const later = await ingest('2025-26', answer, LATER);

    const [after] = await everything();
    expect(later).toStrictEqual({ newGameIds: [], modifiedGameIds: [], seasons: [] });
    expect(after).toStrictEqual(before.map((row) => ({ ...row, lastFetchedAt: new Date(LATER) })));
  });

  it('[JOU-08] [STA-26] [CL-JOU-18] keeps one team per franchise identifier, named after the latest season stored, with its names of each season', async () => {
    await ingest('2025-26', await served('2025-26'));
    await ingest('2024-25', await served('2024-25'));
    const coming = await served('2026-27');
    const renamed = coming.teams.map((team) =>
      team.team === '6' ? { ...team, name: 'Storm', abbreviation: 'RVS' } : team,
    );
    await ingest('2026-27', { ...coming, teams: renamed });

    await expect(
      db
        .select({ ref: teamSourceRefs.sourceTeamRef, name: teams.name, code: teams.abbreviation })
        .from(teamSourceRefs)
        .innerJoin(teams, eq(teams.id, teamSourceRefs.teamId))
        .orderBy(asc(teamSourceRefs.sourceTeamRef)),
    ).resolves.toStrictEqual([
      { ref: '1', name: 'Harbor City Herons', code: 'HCH' },
      { ref: '2', name: 'Pine Valley Lynx', code: 'PVL' },
      { ref: '3', name: 'Redstone Comets', code: 'RSC' },
      { ref: '4', name: 'Lakeport Otters', code: 'LPO' },
      { ref: '5', name: 'Granite Falls Bison', code: 'GFB' },
      { ref: '6', name: 'Ridgeview Storm', code: 'RVS' },
    ]);
    await expect(
      db
        .select({
          season: teamSeasons.season,
          name: teamSeasons.name,
          location: teamSeasons.location,
          abbreviation: teamSeasons.abbreviation,
        })
        .from(teamSeasons)
        .innerJoin(teamSourceRefs, eq(teamSourceRefs.teamId, teamSeasons.teamId))
        .where(eq(teamSourceRefs.sourceTeamRef, '6'))
        .orderBy(asc(teamSeasons.season)),
    ).resolves.toStrictEqual([
      { season: '2024-25', name: 'Gulls', location: 'Seaport', abbreviation: 'SPG' },
      { season: '2025-26', name: 'Gulls', location: 'Ridgeview', abbreviation: 'RVG' },
      { season: '2026-27', name: 'Storm', location: 'Ridgeview', abbreviation: 'RVS' },
    ]);
  });

  it('[STA-04] [VUE-01] [CA-VUE-01] [CL-STA-16] [CL-VUE-11] stores only official NBA games: never an All-Star, NBA Cup final, preseason or other competition game, always an NBA Cup group or knockout game', async () => {
    const answer = await served('2025-26');
    const model = gameIn(answer, '2025-26:r05:h1');
    const extra = (game: string, change: Partial<SourceGame>) => ({ ...model, game, ...change });
    const others = [
      extra('cup-final', { exclusion: 'cup_final', isNeutralSite: true }),
      extra('preseason', { exclusion: 'preseason' }),
      extra('national-team', { exclusion: 'all_star', homeTeam: null, awayTeam: null }),
      extra('cup-knockout', { isNeutralSite: true }),
    ];

    await ingest('2025-26', { ...answer, games: [...answer.games, ...others] });

    const rows = await db.select({ ref: games.sourceGameRef }).from(games);
    const refs = rows.map(({ ref }) => ref);
    expect(refs).toHaveLength(answer.games.length);
    expect(refs).toStrictEqual(expect.arrayContaining(['cup-knockout', model.game]));
    for (const excluded of ['2025-26:all-star', 'cup-final', 'preseason', 'national-team']) {
      expect(refs).not.toContain(excluded);
    }
  });

  it('[STA-05] [CL-STA-14] stores a placeholder whose teams are to be determined with no team and in no series, then its teams and series once the source sets them', async () => {
    const answer = await served('2026-27');
    await ingest('2026-27', answer);

    await expect(stored('2026-27:pi')).resolves.toMatchObject({
      phase: 'play_in',
      status: 'scheduled',
      homeTeamId: null,
      awayTeamId: null,
      seriesId: null,
      gameNumber: null,
    });

    const teamsSet = changed(answer, '2026-27:pi', { homeTeam: '4', awayTeam: '5' });
    const set = await ingest('2026-27', teamsSet, LATER);

    const placeholder = await stored('2026-27:pi');
    const [playIn] = await db.select({ id: series.id }).from(series);
    const teamIds = await db
      .select({ id: teamSourceRefs.teamId })
      .from(teamSourceRefs)
      .where(inArray(teamSourceRefs.sourceTeamRef, ['4', '5']))
      .orderBy(asc(teamSourceRefs.sourceTeamRef));
    expect(set).toStrictEqual({
      newGameIds: [],
      modifiedGameIds: [placeholder?.id],
      seasons: ['2026-27'],
    });
    expect(placeholder).toMatchObject({
      homeTeamId: teamIds[0]?.id,
      awayTeamId: teamIds[1]?.id,
      seriesId: playIn?.id,
      gameNumber: 1,
      homeSeriesWinsBefore: 0,
      awaySeriesWinsBefore: 0,
      isEliminationGame: false,
      scheduleChangedAt: new Date(LATER),
    });
  });

  it('[STA-31] [CL-STA-14] keeps the date, the "time TBD" mark and a deemed start at 00:00 US Eastern until the time is published, which replaces it as a schedule change', async () => {
    const answer = await served('2026-27');
    const tbd = gameIn(answer, '2026-27:r10:h5');
    await ingest('2026-27', changed(answer, tbd.game, { tipOff: toEpochMs(tbd.tipOff + 1) }));

    await expect(stored(tbd.game)).resolves.toMatchObject({
      gameDayOn: tbd.gameDay,
      isStartTimeTbd: true,
      scheduledStartAt: new Date(gameDayStart(tbd.gameDay)),
      scheduleChangedAt: new Date(READ_AT),
    });

    const tipOff = localOccurrenceInstant(tbd.gameDay, '19:30', EASTERN);
    const published = changed(answer, tbd.game, { isTimeKnown: true, tipOff });
    const result = await ingest('2026-27', published, LATER);

    const row = await stored(tbd.game);
    expect(result.modifiedGameIds).toStrictEqual([row?.id]);
    expect(row).toMatchObject({
      gameDayOn: tbd.gameDay,
      isStartTimeTbd: false,
      scheduledStartAt: new Date(tipOff),
      scheduleChangedAt: new Date(LATER),
    });
  });

  it('[STA-05] [CL-STA-17] folds a make-up linked to its postponed original into it, and stores a canceled game with its status', async () => {
    const answer = await served('2026-27');
    const makeUp = gameIn(answer, '2026-27:r03:h4:make-up');
    const cancel = { status: 'canceled', score: null, overtimes: null } as const;

    await ingest('2026-27', changed(answer, '2026-27:r02:h2', cancel));

    await expect(stored('2026-27:r03:h4')).resolves.toMatchObject({
      makeUpSourceGameRef: makeUp.game,
      status: 'final',
      gameDayOn: toIsoDate('2026-11-05'),
      scheduledStartAt: new Date(makeUp.tipOff),
      homeScore: makeUp.score?.home,
      awayScore: makeUp.score?.away,
      homeLinesPublished: true,
    });
    await expect(stored(makeUp.game)).resolves.toBeUndefined();
    await expect(stored('2026-27:r02:h2')).resolves.toMatchObject({
      status: 'canceled',
      homeScore: null,
      homeLinesPublished: false,
    });
  });

  it('[STA-05] [CL-STA-17] keeps the original postponed and the make-up a game of its own when no link is made', async () => {
    const answer = await served('2026-27');
    const original = gameIn(answer, '2026-27:r03:h4');

    await ingest('2026-27', changed(answer, '2026-27:r03:h4:make-up', { makeUpOf: null }));

    await expect(stored(original.game)).resolves.toMatchObject({
      status: 'postponed',
      gameDayOn: original.gameDay,
      makeUpSourceGameRef: null,
    });
    await expect(stored('2026-27:r03:h4:make-up')).resolves.toMatchObject({
      status: 'final',
      gameDayOn: toIsoDate('2026-11-05'),
    });
  });

  it('[CL-STA-17] [CL-DSN-11] journals a held-back row with its status value cut to a bounded length and the source game identifier, the game keeping what is stored', async () => {
    const answer = await served('2026-27');
    await ingest('2026-27', answer);
    const before = await stored('2026-27:r01:h1');
    const heldBack = [{ game: '2026-27:r01:h1', status: LONG_STATUS }];
    const listed = answer.games.filter(({ game }) => game !== '2026-27:r01:h1');

    const held = await ingest('2026-27', { ...answer, games: listed, heldBack }, LATER);

    expect(held).toStrictEqual({ newGameIds: [], modifiedGameIds: [], seasons: [] });
    await expect(stored('2026-27:r01:h1')).resolves.toStrictEqual(before);
    await expect(
      db
        .select({
          key: journalEntries.messageKey,
          params: journalEntries.messageParams,
          details: journalTechnicalDetails.details,
        })
        .from(journalEntries)
        .innerJoin(
          journalTechnicalDetails,
          eq(journalTechnicalDetails.journalEntryId, journalEntries.id),
        )
        .orderBy(asc(journalEntries.id)),
    ).resolves.toStrictEqual([
      {
        key: 'stats_status_unknown',
        params: { status: 'Suspended' },
        details: { sourceGameRef: '2026-27:r09:h6' },
      },
      {
        key: 'stats_status_unknown',
        params: { status: KEPT_STATUS },
        details: { sourceGameRef: '2026-27:r01:h1' },
      },
    ]);
  });

  it('[CL-STA-23] refuses an answer from a source that the season is not assigned to, and stores nothing of it', async () => {
    const answer = await served('2025-26');
    const met = { season: '2025-26', statsSource: SOURCE, firstCoveredSeason: FIRST_COVERED };
    await db.transaction(async (tx) => meetSeason(tx, met));

    const refused = await db.transaction(async (tx) =>
      ingestSeasonGames(tx, {
        season: '2025-26',
        // @ts-expect-error -- a source that the data model does not list, as a second source would be
        statsSource: 'other_source',
        answer,
        fetchedAt: READ_AT,
      }),
    );

    expect(refused).toStrictEqual({ ok: false, error: { kind: 'other_source', assigned: SOURCE } });
    await expect(db.select().from(games)).resolves.toStrictEqual([]);
    await expect(db.select().from(teams)).resolves.toStrictEqual([]);
  });

  it('[STA-45] [CL-STA-22] writes a season met before its games are read as pending, and none for a season earlier than the first one the source covers', async () => {
    const meet = async (season: string) =>
      db.transaction(async (tx) =>
        meetSeason(tx, { season, statsSource: SOURCE, firstCoveredSeason: FIRST_COVERED }),
      );

    await expect(meet('2023-24')).resolves.toBe('not_covered');
    await expect(meet('2027-28')).resolves.toBe('to_read');
    await expect(meet('2027-28')).resolves.toBe('to_read');

    await expect(db.select().from(seasons)).resolves.toStrictEqual([
      {
        season: '2027-28',
        statsSource: SOURCE,
        phasesWithLines: [],
        gamesWithoutLines: 0,
        coverageFetchedAt: null,
      },
    ]);
  });

  it('[STA-45] [CL-STA-22] stores the coverage that the read games give: none with lines for an ended season without lines, the phases played for a season in progress or not begun, and the final games without lines of a covered season', async () => {
    const ended = await served('2023-24');
    await ingest('2023-24', ended);
    await ingest('2025-26', await served('2025-26'));
    await ingest('2026-27', await served('2026-27'));
    await ingest('2027-28', EMPTY);

    const read = { statsSource: SOURCE, coverageFetchedAt: new Date(READ_AT) };
    const finals = ended.games.filter(({ status }) => status === 'final');
    await expect(db.select().from(seasons).orderBy(asc(seasons.season))).resolves.toStrictEqual([
      { ...read, season: '2023-24', phasesWithLines: [], gamesWithoutLines: finals.length },
      {
        ...read,
        season: '2025-26',
        phasesWithLines: ['regular_season', 'play_in', 'playoffs'],
        gamesWithoutLines: 1,
      },
      { ...read, season: '2026-27', phasesWithLines: ['regular_season'], gamesWithoutLines: 0 },
      { ...read, season: '2027-28', phasesWithLines: [], gamesWithoutLines: 0 },
    ]);
    await expect(stored('2025-26:r04:h4')).resolves.toMatchObject({
      status: 'final',
      homeLinesPublished: false,
      awayLinesPublished: false,
    });
  });
});
