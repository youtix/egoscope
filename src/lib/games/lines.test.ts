import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { boxScores, createTestDatabase, games, statCorrections, teamSourceRefs } from '@/lib/db';
import { createFakeStatsSource } from '@/lib/stats-source';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { storeDirectory } from './directory';
import * as linesModule from './lines';
import { changeMapping, confirmMapping } from './mapping';

import type { LinesChange, LinesRead } from './lines';
import type { Database } from '@/lib/db';
import type {
  ConditionalRead,
  FakeStatsSource,
  SourceBoxScore,
  SourcePlayerId,
  StatsSource,
  StatsSourceOutcome,
} from '@/lib/stats-source';

const SEASON = '2024-25';
const DAY_MS = 86_400_000;
const AT = toEpochMs(Date.UTC(2026, 10, 25, 9));
const LATER = AT + 2 * DAY_MS;
const CALL = { deadline: toEpochMs(AT + DAY_MS), signal: new AbortController().signal };
// The first game of the season: team 1, with p01 and p06, at home against team 6.
const FIRST_GAME = '2024-25:r01:h1';
// The second: team 1, with p01 and p06, away at team 2.
const SECOND_GAME = '2024-25:r02:h2';
const FOLLOWED: readonly SourcePlayerId[] = ['p01', 'p06'];
const NO_SCOPE = { playerIds: [], gameIds: [] };
const NO_CHANGE: LinesChange = { changed: NO_SCOPE, corrected: NO_SCOPE, teamHistoryChanged: [] };
const NO_COUNTS = {
  points: null,
  fieldGoalsMade: null,
  fieldGoalsAttempted: null,
  threePointersMade: null,
  freeThrowsMade: null,
  freeThrowsAttempted: null,
  offensiveRebounds: null,
  defensiveRebounds: null,
  assists: null,
  steals: null,
  blocks: null,
  turnovers: null,
  personalFouls: null,
} as const;
const NOT_PLAYED = { didNotPlay: true, playingTime: null, counts: NO_COUNTS } as const;
const P01 = leaguePlayerId('p01');
const P06 = leaguePlayerId('p06');
const UNPUBLISHED = { homeLinesPublished: false, awayLinesPublished: false } as const;

/** What a first read of the fake gives, which always reads. */
function dataOf<T>(outcome: StatsSourceOutcome<ConditionalRead<T>>): T {
  if (!outcome.ok || outcome.value.kind !== 'read') {
    throw new Error('the fake did not read');
  }
  return outcome.value.data;
}

/** The lines with p01's line in the first game changed, unless another line is named. */
function edited(
  lines: readonly SourceBoxScore[],
  change: Partial<SourceBoxScore>,
  { game = FIRST_GAME, player = 'p01' } = {},
): readonly SourceBoxScore[] {
  return lines.map((line) =>
    line.game === game && line.player === player ? { ...line, ...change } : line,
  );
}

describe('the box-score lines of a season read', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let clock: ReturnType<typeof fixedClock>;
  let source: FakeStatsSource;
  let gameIds: ReadonlyMap<string, number>;
  let teamIds: ReadonlyMap<string, number>;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(AT);
    const restoreClock = installFakeClock(clock);
    gameIds = await insertLeagueSeason(db, SEASON);
    // The season as the schedule leaves it before any box score: nothing published, in the window.
    await db
      .update(games)
      .set({ homeLinesPublished: false, awayLinesPublished: false, consolidatedAt: null })
      .where(eq(games.season, SEASON));
    await insertPlayer(db, { source: 'p01' });
    await insertPlayer(db, { source: 'p06' });
    const refs = await db.select().from(teamSourceRefs);
    teamIds = new Map(refs.map(({ sourceTeamRef, teamId }) => [sourceTeamRef, teamId]));
    source = createFakeStatsSource();
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  const idOf = (map: ReadonlyMap<string, number>, key: string): number => map.get(key) ?? 0;
  const firstGameId = () => idOf(gameIds, FIRST_GAME);

  async function read(players: readonly SourcePlayerId[] = FOLLOWED, season = SEASON) {
    return dataOf(await source.getSeasonBoxScores(CALL, { season, knownVersion: null, players }));
  }

  async function ingest(
    lines: readonly SourceBoxScore[],
    { players = FOLLOWED, isManualRefetch = false } = {},
  ): Promise<LinesChange> {
    const request = { season: SEASON, knownVersion: null, players };
    return db.transaction(async (tx) =>
      linesModule.ingestLines(tx, { request, lines, isManualRefetch }),
    );
  }

  async function lineOf(playerId: string, game = FIRST_GAME) {
    const gameId = idOf(gameIds, game);
    const rows = await db
      .select()
      .from(boxScores)
      .where(and(eq(boxScores.playerId, playerId), eq(boxScores.gameId, gameId)));
    return rows[0];
  }

  async function corrections() {
    return db
      .select({
        playerId: statCorrections.playerId,
        gameId: statCorrections.gameId,
        element: statCorrections.element,
        oldValue: statCorrections.oldValue,
        newValue: statCorrections.newValue,
        correctedAt: statCorrections.correctedAt,
        origin: statCorrections.origin,
      })
      .from(statCorrections)
      .orderBy(asc(statCorrections.id));
  }

  /** p01's trace of one element of the first game, [old, new], two days after the first read. */
  const trace = (element: string, [oldValue, newValue]: [number, number], origin: string) => ({
    playerId: P01,
    gameId: firstGameId(),
    element,
    oldValue,
    newValue,
    correctedAt: new Date(LATER),
    origin,
  });

  async function gameRow(id: number) {
    const rows = await db.select().from(games).where(eq(games.id, id));
    return rows[0];
  }

  async function consolidate(game: string, consolidatedAt: Date | null = new Date(AT)) {
    await db
      .update(games)
      .set({ consolidatedAt })
      .where(eq(games.id, idOf(gameIds, game)));
  }

  it('[STA-01] takes its lines in the type of the source port answer only, and offers no other operation', () => {
    type Answer = Extract<
      Awaited<ReturnType<StatsSource['getSeasonBoxScores']>>,
      { ok: true }
    >['value'];
    expectTypeOf<LinesRead['lines']>().toEqualTypeOf<Extract<Answer, { kind: 'read' }>['data']>();
    expectTypeOf<LinesRead['lines']>().toEqualTypeOf<readonly SourceBoxScore[]>();

    expect(Object.keys(linesModule)).toStrictEqual(['ingestLines']);
  });

  describe('on a first read', () => {
    it('[STA-08] [CL-STA-06] stores a played line checked, with its team, whole minutes marked rounded and no ejection said', async () => {
      await ingest(await read());

      const line = await lineOf(P01);
      expect(line).toStrictEqual({
        id: line?.id,
        playerId: P01,
        gameId: firstGameId(),
        statsSource: 'sportsdataverse_espn',
        sourcePlayerRef: 'p01',
        status: 'complete',
        teamId: idOf(teamIds, '1'),
        minutes: 34,
        seconds: null,
        hasRoundedMinutes: true,
        points: 21,
        fieldGoalsMade: 8,
        fieldGoalsAttempted: 17,
        threePointersMade: 2,
        freeThrowsMade: 3,
        freeThrowsAttempted: 4,
        offensiveRebounds: 1,
        defensiveRebounds: 6,
        assists: 5,
        steals: 1,
        blocks: 0,
        turnovers: 2,
        personalFouls: 3,
        ejected: null,
        failedChecks: [],
        fetchedAt: new Date(AT),
      });
      expect(await corrections()).toStrictEqual([]);
    });

    it('[STA-08] stores the lines of the season games only, for each requested player', async () => {
      const lines = await read();
      // The fake also serves the postseason, which this database does not hold.
      expect(lines.filter(({ player }) => player === 'p01')).toHaveLength(16);

      const change = await ingest(lines);

      const stored = await db.select({ playerId: boxScores.playerId }).from(boxScores);
      expect(stored.filter(({ playerId }) => playerId === P01)).toHaveLength(10);
      expect(stored.filter(({ playerId }) => playerId === P06)).toHaveLength(10);
      expect(change.changed.playerIds).toStrictEqual([P01, P06]);
      expect(change.changed.gameIds).toHaveLength(10);
    });

    it('[STA-08] never stores a did-not-play line, nor a line with no time and no count', async () => {
      const zeros = {
        playingTime: { precision: 'whole_minutes', minutes: 0 },
        counts: { ...NO_COUNTS, points: 0, assists: 0 },
      } as const;
      const withoutP01 = edited(await read(), NOT_PLAYED);

      await ingest(edited(withoutP01, zeros, { player: 'p06' }));

      expect(await lineOf(P01)).toBeUndefined();
      expect(await lineOf(P06)).toBeUndefined();
      expect(await lineOf(P01, SECOND_GAME)).toBeDefined();
    });

    it('[STA-08] [STA-10] [CL-STA-06] stores a line with zero whole minutes and a count as played and incomplete, its missing counts null', async () => {
      const lines = edited(await read(), {
        playingTime: { precision: 'whole_minutes', minutes: 0 },
        counts: { ...NO_COUNTS, points: 2, fieldGoalsMade: 1 },
      });

      await ingest(lines);

      expect(await lineOf(P01)).toMatchObject({
        status: 'incomplete',
        minutes: 0,
        hasRoundedMinutes: true,
        points: 2,
        fieldGoalsMade: 1,
        turnovers: null,
        failedChecks: [],
      });
    });

    it('[STA-08] [CL-STA-06] keeps the seconds of a source in seconds, without the rounded-minutes mention', async () => {
      const lines = edited(await read(), {
        playingTime: { precision: 'seconds', minutes: 34, seconds: 12 },
      });

      await ingest(lines);

      const inSeconds = { status: 'complete', minutes: 34, seconds: 12, hasRoundedMinutes: false };
      expect(await lineOf(P01)).toMatchObject(inSeconds);
    });

    it('[STA-08] keeps the checks that a suspect line fails, and a line without time unrounded', async () => {
      source.correctBoxScore({ game: FIRST_GAME, player: 'p01', counts: { points: 30 } });

      await ingest(edited(await read(), { playingTime: null }, { game: SECOND_GAME }));

      expect(await lineOf(P01)).toMatchObject({
        status: 'suspect',
        points: 30,
        failedChecks: ['points_mismatch'],
      });
      expect(await lineOf(P01, SECOND_GAME)).toMatchObject({
        status: 'incomplete',
        minutes: null,
        seconds: null,
        hasRoundedMinutes: false,
      });
    });

    it('[CL-STA-04] sets the published flag of each side whose lines the answer holds, and only those', async () => {
      // p04 plays for team 5: the first game holds team 1's lines alone.
      const answer = await read(['p01', 'p04']);
      const lines = answer.filter(({ game }) => game === FIRST_GAME);

      const change = await ingest(lines, { players: ['p01'] });

      const first = await gameRow(firstGameId());
      expect(first).toMatchObject({ ...UNPUBLISHED, homeLinesPublished: true });
      expect(await gameRow(idOf(gameIds, SECOND_GAME))).toMatchObject(UNPUBLISHED);
      expect(change.changed).toStrictEqual({ playerIds: [P01], gameIds: [firstGameId()] });
    });

    it('[CL-STA-04] [CL-STA-28] leaves a game of another season untouched', async () => {
      const otherSeason = await insertLeagueSeason(db, '2025-26');
      await db
        .update(games)
        .set({ homeLinesPublished: false, awayLinesPublished: false })
        .where(eq(games.season, '2025-26'));

      expect(await ingest(await read(FOLLOWED, '2025-26'))).toStrictEqual(NO_CHANGE);

      expect(await db.select().from(boxScores)).toStrictEqual([]);
      expect(await gameRow(idOf(otherSeason, '2025-26:r01:h1'))).toMatchObject(UNPUBLISHED);
    });

    it('[CL-STA-04] stores a first line of a consolidated game whose team lines were never published', async () => {
      await consolidate(FIRST_GAME);

      await ingest(await read());

      expect(await lineOf(P01)).toMatchObject({ status: 'complete', points: 21 });
      expect(await corrections()).toStrictEqual([]);
    });

    it('[STA-08] [STA-33] stores the lines of a player read after a teammate as first lines, in a consolidated game too', async () => {
      await ingest(await read(['p01']), { players: ['p01'] });
      await consolidate(FIRST_GAME);

      const change = await ingest(await read());

      expect(await lineOf(P06)).toMatchObject({ status: 'complete', teamId: idOf(teamIds, '1') });
      expect(await corrections()).toStrictEqual([]);
      expect(change.changed.playerIds).toStrictEqual([P06]);
      expect(change.changed.gameIds).toHaveLength(10);
      expect(change).toMatchObject({ corrected: NO_SCOPE, teamHistoryChanged: [] });
    });

    it('[STA-08] [STA-33] stores the lines of a new game of players read before as first lines, untraced', async () => {
      // The daily update: the season read the day before, without the game played since.
      const lines = await read();
      await ingest(lines.filter(({ game }) => game !== SECOND_GAME));
      clock.advance(DAY_MS);

      const change = await ingest(lines);

      expect(await lineOf(P01, SECOND_GAME)).toMatchObject({ fetchedAt: new Date(AT + DAY_MS) });
      expect(await corrections()).toStrictEqual([]);
      const changed = { playerIds: [P01, P06], gameIds: [idOf(gameIds, SECOND_GAME)] };
      expect(change).toStrictEqual({ changed, corrected: NO_SCOPE, teamHistoryChanged: [] });
    });

    it.each([
      ['in its window', null],
      ['consolidated meanwhile', new Date(AT)],
    ])(
      '[STA-08] [STA-33] [JOU-12] stores as first lines those of a player mapped again to his identity, in a game his teammate published meanwhile, %s',
      async (_, consolidatedAt) => {
        // Read before the game; then his mapping is changed, and p06's read publishes team 1's side.
        const lines = await read();
        await ingest(lines.filter(({ game }) => game !== SECOND_GAME));
        const players = await source.getSeasonPlayers(CALL, { season: SEASON, knownVersion: null });
        await db.transaction(async (tx) => {
          await storeDirectory(tx, { season: SEASON, entries: dataOf(players) });
          await changeMapping(tx, { playerId: P01 });
        });
        clock.advance(DAY_MS);
        await ingest(lines);
        await db.transaction(async (tx) =>
          confirmMapping(tx, { playerId: P01, sourcePlayerRef: 'p01' }),
        );
        clock.advance(DAY_MS);
        await consolidate(SECOND_GAME, consolidatedAt);

        const change = await ingest(lines);

        expect(await lineOf(P01, SECOND_GAME)).toMatchObject({ fetchedAt: new Date(LATER) });
        expect(await corrections()).toStrictEqual([]);
        const changed = { playerIds: [P01], gameIds: [idOf(gameIds, SECOND_GAME)] };
        expect(change).toStrictEqual({ changed, corrected: NO_SCOPE, teamHistoryChanged: [] });
      },
    );

    it('[STA-08] files a line under the game team the source names, whatever its home flag says, and leaves out a line of a team foreign to the game', async () => {
      const lines = edited(
        edited(await read(), { isHome: false }),
        { team: '3' },
        { player: 'p06' },
      );

      await ingest(edited(lines, { team: 'x9' }, { game: SECOND_GAME, player: 'p06' }));

      expect(await lineOf(P01)).toMatchObject({ teamId: idOf(teamIds, '1') });
      expect(await lineOf(P06)).toBeUndefined();
      expect(await lineOf(P06, SECOND_GAME)).toBeUndefined();
      expect(await gameRow(firstGameId())).toMatchObject({ awayLinesPublished: false });
    });

    it('[STA-33] [STA-34] traces a line the source adds for a player read before, and leaves it out of a consolidated game', async () => {
      // p01 read without a line in the first two games, which p06's lines publish for team 1.
      const lines = await read();
      await ingest(edited(edited(lines, NOT_PLAYED), NOT_PLAYED, { game: SECOND_GAME }));
      await consolidate(FIRST_GAME);

      const change = await ingest(lines);

      expect(await lineOf(P01)).toBeUndefined();
      expect(await lineOf(P01, SECOND_GAME)).toBeDefined();
      const second = { playerIds: [P01], gameIds: [idOf(gameIds, SECOND_GAME)] };
      expect(change).toStrictEqual({
        changed: second,
        corrected: second,
        teamHistoryChanged: [P01],
      });
    });

    it('[STA-33] changes nothing when the same answer is read again', async () => {
      const lines = await read();
      await ingest(lines);
      clock.advance(DAY_MS);

      expect(await ingest(lines)).toStrictEqual(NO_CHANGE);

      expect(await lineOf(P01)).toMatchObject({ fetchedAt: new Date(AT) });
    });
  });

  describe('a correction', () => {
    beforeEach(async () => {
      await ingest(await read());
      clock.advance(LATER - AT);
    });

    it('[STA-33] replaces a value the source corrects in the window, and traces the old and new values', async () => {
      source.correctBoxScore({ game: FIRST_GAME, player: 'p01', counts: { defensiveRebounds: 9 } });

      const change = await ingest(await read());

      const line = { defensiveRebounds: 9, status: 'complete', fetchedAt: new Date(LATER) };
      expect(await lineOf(P01)).toMatchObject(line);
      expect(await corrections()).toStrictEqual([
        trace('defensive_rebounds', [6, 9], 'correction_window'),
      ]);
      const corrected = { playerIds: [P01], gameIds: [firstGameId()] };
      expect(change).toStrictEqual({ changed: corrected, corrected, teamHistoryChanged: [] });
    });

    it('[STA-33] traces a corrected team, which changes the team history', async () => {
      const change = await ingest(edited(await read(), { team: '6', isHome: false }));

      expect(await lineOf(P01)).toMatchObject({ teamId: idOf(teamIds, '6') });
      expect(await corrections()).toMatchObject([
        { element: 'team', oldValue: idOf(teamIds, '1'), newValue: idOf(teamIds, '6') },
      ]);
      expect(change.teamHistoryChanged).toStrictEqual([P01]);
      expect(change.corrected.playerIds).toStrictEqual([P01]);
    });

    it('[STA-33] traces every value of a line that turns "not played", then deletes it', async () => {
      const change = await ingest(edited(await read(), NOT_PLAYED));

      expect(await lineOf(P01)).toBeUndefined();
      const traced = await corrections();
      expect(
        traced.map(({ element, oldValue, newValue }) => [element, oldValue, newValue]),
      ).toStrictEqual([
        ['team', idOf(teamIds, '1'), null],
        ['minutes', 34, null],
        ['points', 21, null],
        ['field_goals_made', 8, null],
        ['field_goals_attempted', 17, null],
        ['three_pointers_made', 2, null],
        ['free_throws_made', 3, null],
        ['free_throws_attempted', 4, null],
        ['offensive_rebounds', 1, null],
        ['defensive_rebounds', 6, null],
        ['assists', 5, null],
        ['steals', 1, null],
        ['blocks', 0, null],
        ['turnovers', 2, null],
        ['personal_fouls', 3, null],
      ]);
      expect(change.teamHistoryChanged).toStrictEqual([P01]);
    });

    it('[STA-33] deletes a stored line missing from his team lines, and keeps it while the answer holds none', async () => {
      // p02 plays for team 2: the second game then holds team 2's lines, not team 1's.
      const answer = await read(['p01', 'p06', 'p02']);
      const lines = answer.filter(
        ({ game, player }) =>
          (game !== FIRST_GAME || player !== 'p01') && (game !== SECOND_GAME || player === 'p02'),
      );

      await ingest(lines);

      expect(await lineOf(P01)).toBeUndefined();
      expect(await lineOf(P06)).toBeDefined();
      expect(await lineOf(P01, SECOND_GAME)).toBeDefined();
      expect(await lineOf(P06, SECOND_GAME)).toBeDefined();
    });

    it('[STA-33] keeps the line of a player the read did not request', async () => {
      expect(await ingest(await read(['p06']), { players: ['p06'] })).toStrictEqual(NO_CHANGE);

      expect(await lineOf(P01)).toBeDefined();
    });

    it('[STA-33] leaves a consolidated game as it is without a manual refetch', async () => {
      await consolidate(FIRST_GAME);
      source.correctBoxScore({ game: FIRST_GAME, player: 'p01', counts: { assists: 7 } });
      const lines = edited(await read(), NOT_PLAYED, { player: 'p06' });

      expect(await ingest(lines)).toStrictEqual(NO_CHANGE);

      expect(await lineOf(P01)).toMatchObject({ assists: 5 });
      expect(await lineOf(P06)).toBeDefined();
      expect(await corrections()).toStrictEqual([]);
    });

    it('[STA-34] replaces and traces a correction of a consolidated game on a manual refetch', async () => {
      await consolidate(FIRST_GAME);
      source.correctBoxScore({ game: FIRST_GAME, player: 'p01', counts: { assists: 7 } });

      const change = await ingest(await read(), { isManualRefetch: true });

      expect(await lineOf(P01)).toMatchObject({ assists: 7 });
      expect(await corrections()).toStrictEqual([trace('assists', [5, 7], 'manual_refetch')]);
      expect(change.corrected).toStrictEqual({ playerIds: [P01], gameIds: [firstGameId()] });
    });

    it('[STA-34] [CL-STA-04] keeps an unavailable placeholder until a manual refetch brings a played line', async () => {
      await db.delete(boxScores).where(eq(boxScores.playerId, P01));
      // The placeholder of p01's unavailable sheet in the first game (STA-35).
      await db.insert(boxScores).values({
        playerId: P01,
        gameId: firstGameId(),
        statsSource: 'sportsdataverse_espn',
        sourcePlayerRef: 'p01',
        status: 'unavailable',
        hasRoundedMinutes: false,
        fetchedAt: new Date(AT),
      });
      await consolidate(FIRST_GAME);
      const lines = await read();
      await ingest(edited(lines, NOT_PLAYED), { isManualRefetch: true });
      await ingest(lines);
      expect(await lineOf(P01)).toMatchObject({ status: 'unavailable' });

      await ingest(lines, { isManualRefetch: true });

      expect(await lineOf(P01)).toMatchObject({
        status: 'complete',
        teamId: idOf(teamIds, '1'),
        points: 21,
      });
      expect(await corrections()).toContainEqual(
        expect.objectContaining({ element: 'team', oldValue: null, origin: 'manual_refetch' }),
      );
    });

    it('[STA-33] rewrites a line whose check changes with the game overtimes, without a trace', async () => {
      // 50 minutes exceed a game without overtime, not a game with one.
      const lines = edited(await read(), {
        playingTime: { precision: 'whole_minutes', minutes: 50 },
      });
      await ingest(lines);
      expect(await lineOf(P01)).toMatchObject({ failedChecks: ['minutes_above_game_length'] });
      await db.update(games).set({ overtimeCount: 1 }).where(eq(games.id, firstGameId()));
      const traced = await corrections();

      const change = await ingest(lines);

      expect(await lineOf(P01)).toMatchObject({ status: 'complete', failedChecks: [] });
      expect(await corrections()).toStrictEqual(traced);
      expect(change).toStrictEqual({
        changed: { playerIds: [P01], gameIds: [firstGameId()] },
        corrected: NO_SCOPE,
        teamHistoryChanged: [],
      });
    });
  });
});
