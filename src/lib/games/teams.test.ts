import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { boxScores, cases, events, playerTeamChanges, teamSeasons } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertLeagueSeason,
  insertRequest,
  insertValidCase,
} from '@/lib/testing';
import { now, toEpochMs } from '@/lib/time';

import { handOn, team, teamHistory, teams, updateTeamFromGames } from './teams';
import {
  AFTER_SEASON,
  BEFORE_SEASON,
  enter,
  entered,
  follow,
  gameOf,
  historyOf,
  keepLinesThrough,
  MOVED,
  moveTo,
  NEXT_SEASON,
  noon,
  observed,
  openLeague,
  playerOf,
  read,
  recordOf,
  REWRITTEN,
  scheduledGame,
  SEASON,
  teamOf,
  UNCHANGED,
} from './teams-test-league';

import type { Database } from '@/lib/db';
import type { LeaguePlayer } from '@/lib/testing';

// An identifier under which nobody is followed.
const UNFOLLOWED = '00000000-0000-4000-8000-000000000001';

describe('the current team from his games', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const league = await openLeague();
    db = league.db;
    await insertLeagueSeason(db, SEASON);
    return league.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Updates his team from the box scores stored so far. */
  async function update(playerId: string) {
    return db.transaction(async (tx) => updateTeamFromGames(tx, playerId));
  }

  /**
   * Stores his lines of `season` up to the US day `lastDay`, as the box-score units have
   * fetched them so far, then updates his team from his games.
   */
  async function ingest(
    playerId: string,
    ref: LeaguePlayer,
    { lastDay, season = SEASON }: Readonly<{ lastDay: string; season?: string }>,
  ) {
    await insertBoxScores(db, { playerId, source: ref, season });
    return keepLinesThrough(playerId, season, lastDay);
  }

  /** An imported media storm of the player, public the day before his game `gameId`, and its case measured at that game. */
  async function importedCase(playerId: string, gameId: number, eventOn: string): Promise<void> {
    await insertEventType(db);
    const request = await insertRequest(db, { playerId });
    const imported = await insertImport(db, { request });
    const measured = await insertValidCase(db, { playerId, measuredGameId: gameId });
    await insertHistoricalEvent(db, {
      playerId,
      originImportId: imported.id,
      overrides: { referenceDateOn: eventOn, caseId: measured.id },
    });
  }

  it('[STA-25] [JOU-13] [CA-JOU-09] makes the team of a stored game he played for another team his current team, historized with his first game for it, from his own games and history alone, and modifies no event nor case', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const playerId = await follow('p02', '2');
    await insertBoxScores(db, { playerId, source: 'p02', season: SEASON });
    const first = await gameOf(playerId, '2025-10-21');
    const traded = await gameOf(playerId, '2025-11-05');
    await importedCase(playerId, first.id, '2025-10-20');
    // Another followed player, added later, with his games of another team.
    moveTo(noon(11, 4));
    const other = await follow('p04', '5');
    await insertBoxScores(db, { playerId: other, source: 'p04', season: SEASON });
    const before = await Promise.all([db.select().from(events), db.select().from(cases)]);

    const updated = await update(playerId);

    expect(updated).toStrictEqual(MOVED);
    await expect(historyOf(playerId)).resolves.toStrictEqual([
      entered(BEFORE_SEASON, [null, pineValley], first.id),
      observed(traded.start, [pineValley, redstone], traded.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone });
    await expect(teamHistory(db, playerId)).resolves.toStrictEqual([
      { teamId: pineValley, from: BEFORE_SEASON.getTime(), until: traded.start.getTime() },
      { teamId: redstone, from: traded.start.getTime(), until: null },
    ]);
    await expect(
      Promise.all([db.select().from(events), db.select().from(cases)]),
    ).resolves.toStrictEqual(before);
  });

  it('[STA-25] never changes his team nor adds history from box scores older than his latest change, fetched later', async () => {
    await insertLeagueSeason(db, NEXT_SEASON);
    moveTo(noon(10, 15, 2026));
    const redstone = await teamOf('3');
    const playerId = await follow('p02', '3');
    // His first game of 2026-27 verifies the addition: no game he played is later.
    await ingest(playerId, 'p02', { lastDay: '2026-10-20', season: NEXT_SEASON });
    const first = await gameOf(playerId, '2026-10-20');

    const older = await ingest(playerId, 'p02', { lastDay: AFTER_SEASON });

    expect(older).toStrictEqual({ ok: true, value: UNCHANGED });
    await expect(historyOf(playerId)).resolves.toStrictEqual([
      entered(noon(10, 15, 2026), [null, redstone], first.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone });
  });

  it('[STA-25] [CL-STA-11] takes the placeholder of an unavailable sheet for no game played, which changes nothing', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-11-02' });
    const first = await gameOf(playerId, '2025-10-21');
    const unavailable = await scheduledGame(redstone, '2025-11-05');
    await db.insert(boxScores).values({
      playerId,
      gameId: unavailable.id,
      statsSource: 'sportsdataverse_espn',
      sourcePlayerRef: 'p02',
      status: 'unavailable',
      hasRoundedMinutes: false,
      fetchedAt: new Date(now()),
    });

    const updated = await update(playerId);

    expect(updated).toStrictEqual({ ok: true, value: UNCHANGED });
    await expect(historyOf(playerId)).resolves.toStrictEqual([
      entered(BEFORE_SEASON, [null, pineValley], first.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: pineValley });
  });

  it('[JOU-13] verifies an entered change by his first game for the entered team, with no change back', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-11-02' });
    moveTo(noon(11, 3));
    await enter(playerId, '3');

    const updated = await ingest(playerId, 'p02', { lastDay: '2025-11-06' });

    const traded = await gameOf(playerId, '2025-11-05');
    expect(updated).toStrictEqual(MOVED);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      entered(noon(11, 3), [pineValley, redstone], traded.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone });
  });

  it('[JOU-13] verifies the team chosen at his addition when his box scores already gave it, which nothing can make void', async () => {
    moveTo(noon(10, 29));
    const pineValley = await teamOf('2');
    const playerId = await follow('p02', '2');

    const updated = await ingest(playerId, 'p02', { lastDay: '2025-10-31' });

    const judge = await gameOf(playerId, '2025-10-30');
    expect(updated).toStrictEqual(MOVED);
    await expect(historyOf(playerId)).resolves.toStrictEqual([
      entered(noon(10, 29), [null, pineValley], judge.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: pineValley });
  });

  it('[JOU-13] voids an entry whose first game after it is for the team he left, a game at its very instant coming before it, records the change back with that game, and reports it with the changes his later games observe', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const granite = await teamOf('5');
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-10-25' });
    const atEntry = await gameOf(playerId, '2025-10-24');
    moveTo(atEntry.start);
    await enter(playerId, '5');

    const updated = await ingest(playerId, 'p02', { lastDay: '2025-11-06' });

    const [back, traded] = [
      await gameOf(playerId, '2025-10-27'),
      await gameOf(playerId, '2025-11-05'),
    ];
    expect(updated).toStrictEqual(REWRITTEN);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      entered(atEntry.start, [pineValley, granite], null),
      observed(back.start, [granite, pineValley], back.id),
      observed(traded.start, [pineValley, redstone], traded.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone });
  });

  it('[JOU-13] ends an entered membership unconfirmed when his first game is for a third team, records that team, and reports it', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const granite = await teamOf('5');
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-11-02' });
    moveTo(noon(11, 3));
    await enter(playerId, '5');

    const updated = await ingest(playerId, 'p02', { lastDay: '2025-11-06' });

    const third = await gameOf(playerId, '2025-11-05');
    expect(updated).toStrictEqual(REWRITTEN);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      entered(noon(11, 3), [pineValley, granite], null),
      observed(third.start, [granite, redstone], third.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone });
  });

  it('[JOU-13] [STA-25] applies first a change that the player file reads between an entry and his first game, which then judges nothing', async () => {
    const [redstone, granite] = [await teamOf('3'), await teamOf('5')];
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-11-02' });
    moveTo(noon(11, 3));
    await enter(playerId, '5');
    moveTo(noon(11, 4));

    const fileRead = await read(playerId, await recordOf('p02'));
    const updated = await ingest(playerId, 'p02', { lastDay: '2025-11-06' });

    expect([fileRead, updated]).toStrictEqual([
      { ok: true, value: { ...MOVED.value, birthdayChanged: true } },
      { ok: true, value: UNCHANGED },
    ]);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      { to: granite, origin: 'entered', gameId: null },
      observed(noon(11, 4), [granite, redstone], null),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone });
  });

  it('[STA-25] gives "player not found" for evidence handed on for a player whom nobody follows, and records nothing', async () => {
    const redstone = await teamOf('3');
    const evidence = { teamId: redstone, at: toEpochMs(now()), membershipAtEntry: null };

    const handed = await db.transaction(async (tx) => handOn(tx, UNFOLLOWED, evidence));

    expect(handed).toStrictEqual({ ok: false, error: { kind: 'player_not_found' } });
    await expect(db.select().from(playerTeamChanges)).resolves.toStrictEqual([]);
  });

  it('[JOU-08] keeps a relocated team under its id: its names of each season, its current name among the choices, which go by location then name, and his one stint with it (CL-JOU-18)', async () => {
    await insertLeagueSeason(db, '2024-25');
    const [gulls, granite] = [await teamOf('6'), await teamOf('5')];
    const playerId = await follow('p05', '6');
    await insertBoxScores(db, { playerId, source: 'p05', season: '2024-25' });
    await ingest(playerId, 'p05', { lastDay: AFTER_SEASON });
    const first = await gameOf(playerId, '2024-10-22');
    // A second team in Pine Valley, inserted after the Lynx, whose name comes first.
    await db
      .update(teamSeasons)
      .set({ location: 'Pine Valley' })
      .where(and(eq(teamSeasons.teamId, granite), eq(teamSeasons.season, SEASON)));

    await expect(
      Promise.all([
        team(db, gulls, '2024-25'),
        team(db, gulls, SEASON),
        team(db, gulls, '2023-24'),
      ]),
    ).resolves.toStrictEqual([
      { teamId: gulls, name: 'Gulls', location: 'Seaport', abbreviation: 'SPG' },
      { teamId: gulls, name: 'Gulls', location: 'Ridgeview', abbreviation: 'RVG' },
      null,
    ]);
    await expect(teams(db)).resolves.toMatchObject([
      { location: 'Harbor City' },
      { location: 'Lakeport' },
      { teamId: granite, location: 'Pine Valley', name: 'Bison' },
      { location: 'Pine Valley', name: 'Lynx' },
      { location: 'Redstone' },
      { teamId: gulls, location: 'Ridgeview', abbreviation: 'RVG' },
    ]);
    await expect(teamHistory(db, playerId)).resolves.toStrictEqual([
      { teamId: gulls, from: first.start.getTime(), until: null },
    ]);
  });
});
