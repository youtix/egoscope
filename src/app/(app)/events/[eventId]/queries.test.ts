import { and, eq, gt } from 'drizzle-orm';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, games, teamSeasons } from '@/lib/db';
import { getEvent } from '@/lib/events';
import {
  birthdayOnNextGameDay,
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertLeagueSeason,
  insertPlayer,
} from '@/lib/testing';

import { derivedGame } from './queries';

import type { Database } from '@/lib/db';
import type { CalendarDerivedEvent } from '@/lib/events';

// The first invented player's birthday game of 26 October 2026: his team, the Harbor City
// Herons, host the Redstone Comets.
const COMETS = 3;
const SEASON = '2026-27';
// The second invented player moves from the Pine Valley Lynx to the Comets on 3 November 2025.
const LYNX = 2;
const TRADE_SEASON = '2025-26';
const TRADED_ON = '2025-11-03';
const SIXTH_TEAM = 6;

/** A database of the test's own, closed when the test ends. */
async function testDatabase(): Promise<Database> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  return database.db;
}

/** The first invented player's birthday event, derived from the calendar, his box scores stored. */
async function birthdayEvent(db: Database): Promise<CalendarDerivedEvent> {
  const { player, event } = await birthdayOnNextGameDay(db);
  await insertBoxScores(db, { playerId: player.id, source: 'p01', season: SEASON });
  const read = await getEvent(db, event.id);
  if (read?.origin !== 'calendar') {
    throw new Error('The birthday event is not derived from the calendar.');
  }
  return read;
}

describe('derivedGame', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[CL-VUE-15] [CL-TAX-18] gives no day of a last game for a former team he never played for', async () => {
    const db = await testDatabase();
    const event = await birthdayEvent(db);

    const game = await derivedGame(db, event, 'former_team');

    expect(game).toMatchObject({
      opponent: { venue: 'home', team: { location: 'Redstone', name: 'Comets' } },
      lastGameForOpponentOn: null,
    });
  });

  it('[CL-VUE-15] [CL-TAX-18] gives the day of his last game for the former team he faces', async () => {
    const db = await testDatabase();
    const event = await birthdayEvent(db);
    await insertLeagueSeason(db, TRADE_SEASON);
    const traded = await insertPlayer(db, { source: 'p02' });
    await insertBoxScores(db, { playerId: traded.id, source: 'p02', season: TRADE_SEASON });
    // His first game for the Comets against the Lynx, after his trade of 3 November 2025.
    const [faced] = await db
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          eq(games.homeTeamId, COMETS),
          eq(games.awayTeamId, LYNX),
          gt(games.gameDayOn, TRADED_ON),
        ),
      );

    const game = await derivedGame(
      db,
      { ...event, playerId: traded.id, derivedGameId: faced?.id ?? 0 },
      'former_team',
    );

    expect(game).toMatchObject({
      opponent: { venue: 'home', team: { location: 'Pine Valley', name: 'Lynx' } },
      lastGameForOpponentOn: '2025-11-02',
    });
  });

  it('[CL-VUE-15] gives no opponent for a game that his team games do not place him in', async () => {
    const db = await testDatabase();
    const event = await birthdayEvent(db);
    await insertLeagueSeason(db, TRADE_SEASON);
    // A game of the Comets against the sixth team, which his Herons do not play.
    const [other] = await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.homeTeamId, COMETS), eq(games.awayTeamId, SIXTH_TEAM)));

    const game = await derivedGame(db, { ...event, derivedGameId: other?.id ?? 0 }, 'birthday');

    expect(game).toMatchObject({ opponent: null, lastGameForOpponentOn: null });
  });

  it('refuses an event whose game the database does not hold, a bug', async () => {
    const db = await testDatabase();
    const event = await birthdayEvent(db);

    await expect(derivedGame(db, { ...event, derivedGameId: 0 }, 'birthday')).rejects.toThrow(
      'A calendar-derived event names a game that the database does not hold.',
    );
  });

  it('refuses a game whose opponent has no name that season, a bug', async () => {
    const db = await testDatabase();
    const event = await birthdayEvent(db);
    await db
      .delete(teamSeasons)
      .where(and(eq(teamSeasons.teamId, COMETS), eq(teamSeasons.season, SEASON)));

    await expect(derivedGame(db, event, 'birthday')).rejects.toThrow(
      'A stored game names a team that has no name that season.',
    );
  });
});
