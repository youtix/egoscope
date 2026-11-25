import { and, asc, eq, gt } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { boxScores, createTestDatabase, games } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { insertBoxScores, insertLeagueSeason } from './games';
import { setOwnerParam } from './params';
import { insertPlayer } from './players';
import { insertValidCase } from './sensitivity';
import { insertEventType } from './taxonomy';

import type { LeaguePlayer } from './players';
import type { CaseRow } from './sensitivity';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8));
const SEASON = '2024-25';
// The performance indices of the five lines of the invented league in 2024-25, whose
// minutes are whole (STA-12): Game Score over minutes, computed by hand from
// data/fixtures/stats-source/world/scenario.json.
const LINE_34 = 15.7 / 34;
const LINE_28 = 13.8 / 28;
const LINE_22 = 1.3 / 22;
const LINE_38 = 28.2 / 38;
const LINE_15 = 4.9 / 15;
// His first game's baseline: his other nine games of the regular season, in their order.
const BASELINE = [LINE_38, LINE_28, LINE_15, LINE_22, LINE_34, LINE_38, LINE_28, LINE_15, LINE_22];
const PRECISION = 12;
// games.minBaselineGames at its default value, that of the parameter registry (STA-19).
const DEFAULT_MINIMUM_BASELINE = 10;
// A playing-time floor above his 15-minute games and below all his others (STA-14).
const RAISED_FLOOR = 20;

// The scale that rounds a figure to PRECISION decimals.
const SCALE = 10 ** PRECISION;

/** `value` rounded to PRECISION decimals, so that the order of a sum does not show. */
const rounded = (value: number | null): number => Math.round((value ?? NaN) * SCALE) / SCALE;

/** The figures of a case that a calculation gives, rounded. */
const figuresOf = (row: CaseRow) => ({
  measuredGameScore: rounded(row.measuredGameScore),
  performanceIndex: rounded(row.performanceIndex),
  baselineMean: rounded(row.baselineMean),
  baselineStandardDeviation: rounded(row.baselineStandardDeviation),
  normalizedGap: rounded(row.normalizedGap),
});

/** The mean and the sample standard deviation of `values` (STA-16). */
function moments(values: readonly number[]): Readonly<{ mean: number; deviation: number }> {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return { mean, deviation: Math.sqrt(squares / (values.length - 1)) };
}

/** Sets the minimum baseline size, `games.minBaselineGames`, as the owner would. */
async function setMinimumBaseline(db: Database, count: number): Promise<void> {
  await setOwnerParam(db, 'games.minBaselineGames', count);
}

/** The games of the player's lines of `season`, by tip-off, with his minutes. */
async function hisGames(db: Database, playerId: string, season: string) {
  return db
    .select({ id: games.id, minutes: boxScores.minutes })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(eq(boxScores.playerId, playerId), eq(games.season, season)))
    .orderBy(asc(games.scheduledStartAt));
}

/** Follows the invented player `source` with his box scores of `season`. */
async function follow(db: Database, source: LeaguePlayer, season: string): Promise<string> {
  await insertLeagueSeason(db, season);
  const { id } = await insertPlayer(db, { source });
  await insertBoxScores(db, { playerId: id, source, season });
  return id;
}

describe('insertValidCase', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let gameIds: readonly number[];
  // His game of 2024-25 at `index`, by tip-off.
  const gameAt = (index: number): number => gameIds[index] ?? 0;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    await insertEventType(db);
    playerId = await follow(db, 'p01', SEASON);
    const his = await hisGames(db, playerId, SEASON);
    gameIds = his.map(({ id }) => id);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[SEN-01] [SEN-08] [STA-12] [STA-16] measures a valid case from his line and his baseline of the season, its event public at the end of its day in Pacific time', async () => {
    await setMinimumBaseline(db, BASELINE.length);
    const gameId = gameAt(0);
    const { mean, deviation } = moments(BASELINE);

    const written = await insertValidCase(db, { playerId, measuredGameId: gameId });

    expect(figuresOf(written)).toStrictEqual({
      measuredGameScore: rounded(15.7),
      performanceIndex: rounded(LINE_34),
      baselineMean: rounded(mean),
      baselineStandardDeviation: rounded(deviation),
      normalizedGap: rounded((LINE_34 - mean) / deviation),
    });
    expect(written).toMatchObject({
      playerId,
      eventTypeId: 'media-storm',
      origin: 'historical',
      status: 'measured',
      statusReason: null,
      referenceInstantAt: new Date(Date.UTC(2024, 9, 22, 7)),
      referenceInstantOrigin: 'date_only',
      measuredGameId: gameId,
      playingTimeThresholdMinutes: 15,
      measuredMinutes: 34,
      hasRoundedMinutes: true,
      baselineSeason: SEASON,
      baselinePhase: 'regular_season',
      baselineGameCount: 9,
      baselineStatus: 'final',
      baselineIsPartial: false,
      gapStatus: 'final',
      opponentStrengthNotEvaluable: true,
      stakesNotEvaluable: false,
    });
  });

  it('[SEN-01] takes the day of the event that it is given', async () => {
    await setMinimumBaseline(db, BASELINE.length);
    const gameId = gameAt(1);

    await expect(
      insertValidCase(db, { playerId, measuredGameId: gameId, eventOn: toIsoDate('2024-10-23') }),
    ).resolves.toMatchObject({
      referenceInstantAt: new Date(Date.UTC(2024, 9, 24, 7)),
      measuredGameId: gameId,
      measuredMinutes: 38,
    });
  });

  it('[STA-14] [STA-16] leaves out of the baseline a game under the threshold and an incomplete one', async () => {
    await db
      .update(boxScores)
      .set({ minutes: 10 })
      .where(eq(boxScores.gameId, gameAt(1)));
    await db
      .update(boxScores)
      .set({ points: null })
      .where(eq(boxScores.gameId, gameAt(2)));
    const kept = [LINE_15, LINE_22, LINE_34, LINE_38, LINE_28, LINE_15, LINE_22];
    await setMinimumBaseline(db, kept.length);

    const written = await insertValidCase(db, { playerId, measuredGameId: gameAt(0) });

    expect(written).toMatchObject({ baselineGameCount: kept.length, baselineStatus: 'final' });
    expect(written.baselineMean).toBeCloseTo(moments(kept).mean, PRECISION);
  });

  it('[STA-14] [TRV-36] measures with the playing-time floor that the owner set, 20 minutes, which leaves his games of 15 out of the baseline', async () => {
    await setOwnerParam(db, 'games.minutesFloor', RAISED_FLOOR);
    const kept = [LINE_38, LINE_28, LINE_22, LINE_34, LINE_38, LINE_28, LINE_22];
    await setMinimumBaseline(db, kept.length);

    const written = await insertValidCase(db, { playerId, measuredGameId: gameAt(0) });

    expect(written).toMatchObject({
      playingTimeThresholdMinutes: RAISED_FLOOR,
      baselineGameCount: kept.length,
      baselineStatus: 'final',
    });
    expect(written.baselineMean).toBeCloseTo(moments(kept).mean, PRECISION);
  });

  it('[STA-19] measures a valid case with nothing written beyond the season, the player and his lines', async () => {
    await expect(
      insertValidCase(db, { playerId, measuredGameId: gameAt(0) }),
    ).resolves.toMatchObject({
      measuredGameId: gameAt(0),
      baselineGameCount: 9,
      baselineStatus: 'final',
      gapStatus: 'final',
    });
  });

  it('[STA-19] refuses a case whose baseline stays under the minimum of 10 games once the season is over', async () => {
    await setMinimumBaseline(db, DEFAULT_MINIMUM_BASELINE);

    await expect(insertValidCase(db, { playerId, measuredGameId: gameAt(0) })).rejects.toThrow(
      /^No valid case can be measured at the game \d+: .*"gameCount":9,"status":"insufficient"/u,
    );
  });

  it('[SEN-03] refuses a game that is not the first he played after the event', async () => {
    await setMinimumBaseline(db, BASELINE.length);
    const gameId = gameAt(1);

    await expect(
      insertValidCase(db, { playerId, measuredGameId: gameId, eventOn: toIsoDate('2024-10-20') }),
    ).rejects.toThrow(`The game ${String(gameId)} is not a usable measured game.`);
  });

  it('[STA-13] [STA-22] refuses a case whose baseline is still building, his games missed left out', async () => {
    const released = await follow(db, 'p08', '2026-27');
    const played = await db
      .select({ id: games.id })
      .from(boxScores)
      .innerJoin(games, eq(games.id, boxScores.gameId))
      .where(and(eq(boxScores.playerId, released), gt(boxScores.minutes, 0)))
      .orderBy(asc(games.scheduledStartAt));
    const lines = await hisGames(db, released, '2026-27');
    const missed = lines.filter(({ minutes }) => minutes === null);
    const [first = { id: 0 }] = played;

    expect(missed).toHaveLength(1);
    await expect(
      insertValidCase(db, { playerId: released, measuredGameId: first.id }),
    ).rejects.toThrow(
      new RegExp(`"gameCount":${String(played.length - 1)},"status":"building"`, 'u'),
    );
  });

  it('writes the columns that it is given in place of its own', async () => {
    await setMinimumBaseline(db, BASELINE.length);
    const gameId = gameAt(2);

    await expect(
      insertValidCase(db, {
        playerId,
        measuredGameId: gameId,
        overrides: { status: 'excluded', normalizedGap: -0.5 },
      }),
    ).resolves.toMatchObject({ status: 'excluded', normalizedGap: -0.5, measuredGameId: gameId });
  });
});
