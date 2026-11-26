import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  boxScores,
  cases,
  createTestDatabase,
  events,
  followedPlayers,
  games,
  playerTeamChanges,
  statsSourceMappings,
  teamSourceRefs,
} from '@/lib/db';
import { add, enterTeamChange } from '@/lib/players';
import { createFakeStatsSource } from '@/lib/stats-source';
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
import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { changeMapping } from './mapping';
import { applyPlayerRecord, team, teamHistory, teams, updateTeamFromGames } from './teams';

import type { Database } from '@/lib/db';
import type { FakeStatsSource, PlayerRecord } from '@/lib/stats-source';
import type { LeaguePlayer } from '@/lib/testing';
import type { FixedClock } from '@/lib/time';

const SEASON = '2025-26';
const NEXT_SEASON = '2026-27';
const CALL_WINDOW_MS = 60_000;
// A US day after every game of the season it closes, so that its lines are all stored.
const AFTER_SEASON = '2026-06-30';

/** Noon UTC on the day given, of 2025 unless another year is. */
const noon = (month: number, day: number, year = 2025): Date =>
  new Date(toEpochMs(Date.UTC(year, month - 1, day, 12)));

// The day before 2025-26 opens, when the players of most tests are added.
const BEFORE_SEASON = noon(10, 20);
const UNCHANGED = { changed: false, teamHistoryChanged: false };
const NOTHING = { ok: true, value: { ...UNCHANGED, birthdayChanged: false } };
// An update that moved his team or his history, and one that also rewrote his history.
const MOVED = { ok: true, value: { changed: true, teamHistoryChanged: false } };
const REWRITTEN = { ok: true, value: { changed: true, teamHistoryChanged: true } };
const NO_BIRTHDAY = { month: null, day: null, origin: null };

// The team he leaves and the team he joins, none for a release or an addition.
type Move = readonly [from: number | null, to: number | null];

/** A row of his team history, entered or observed, as `historyOf` reads it. */
const historyRow =
  (origin: 'entered' | 'observed') =>
  (at: Date, [from, to]: Move, gameId: number | null) => ({ at, from, to, origin, gameId });
const entered = historyRow('entered');
const observed = historyRow('observed');

describe('the current team and the team history', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let clock: FixedClock;
  let source: FakeStatsSource;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(toEpochMs(BEFORE_SEASON.getTime()));
    const restoreClock = installFakeClock(clock);
    source = createFakeStatsSource();
    await insertLeagueSeason(db, SEASON);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Moves the clock on to `at`. */
  const moveTo = (at: Date) => {
    clock.advance(at.getTime() - now());
  };

  /** The application team that the source names `ref`. */
  async function teamOf(ref: string): Promise<number> {
    const [row] = await db
      .select({ id: teamSourceRefs.teamId })
      .from(teamSourceRefs)
      .where(eq(teamSourceRefs.sourceTeamRef, ref));
    return row?.id ?? 0;
  }

  /** Follows the invented player `ref` from now on, added with the source's team `teamRef` as players.add records it, his mapping established. */
  async function follow(ref: LeaguePlayer, teamRef: string): Promise<string> {
    const currentTeamId = await teamOf(teamRef);
    const added = await db.transaction(async (tx) =>
      add(tx, { displayName: `Player ${ref}`, currentTeamId, variants: [] }),
    );
    const playerId = added.ok ? added.value.playerId : '';
    await db.insert(statsSourceMappings).values({
      playerId,
      statsSource: 'sportsdataverse_espn',
      status: 'established',
      sourcePlayerRef: ref,
      establishedAt: new Date(now()),
    });
    return playerId;
  }

  /** The owner enters now that he plays for the source's team `teamRef`. */
  async function enter(playerId: string, teamRef: string): Promise<void> {
    const teamId = await teamOf(teamRef);
    await db.transaction(async (tx) => enterTeamChange(tx, playerId, teamId));
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
    const later = db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.season, season), gt(games.gameDayOn, lastDay)));
    await db
      .delete(boxScores)
      .where(and(eq(boxScores.playerId, playerId), inArray(boxScores.gameId, later)));
    return db.transaction(async (tx) => updateTeamFromGames(tx, playerId));
  }

  /** The record of the invented player `ref` in the player file of 2025-26, as the fake serves it. */
  async function recordOf(ref: LeaguePlayer): Promise<PlayerRecord> {
    const ctx = {
      deadline: toEpochMs(now() + CALL_WINDOW_MS),
      signal: new AbortController().signal,
    };
    const outcome = await source.getPlayerRecords(ctx, {
      season: SEASON,
      knownVersion: null,
      players: [ref],
    });
    const [record] = outcome.ok && outcome.value.kind === 'read' ? outcome.value.data : [];
    if (record === undefined) {
      throw new Error(`The fake lists no record of ${ref} in ${SEASON}.`);
    }
    return record;
  }

  /** Applies `record`, read now for the player, first of a newly confirmed identity or not. */
  async function read(playerId: string, record: PlayerRecord, isNewIdentity = false) {
    return db.transaction(async (tx) =>
      applyPlayerRecord(tx, { playerId, record, readAt: now(), identityChanged: isNewIdentity }),
    );
  }

  /** His team history, oldest first. */
  async function historyOf(playerId: string) {
    return db
      .select({
        at: playerTeamChanges.changedAt,
        from: playerTeamChanges.previousTeamId,
        to: playerTeamChanges.newTeamId,
        origin: playerTeamChanges.origin,
        gameId: playerTeamChanges.gameId,
      })
      .from(playerTeamChanges)
      .where(eq(playerTeamChanges.playerId, playerId))
      .orderBy(asc(playerTeamChanges.changedAt), asc(playerTeamChanges.id));
  }

  /** His current team, his day and month of birth with their origin, and what his mapping keeps of the last player-file read that listed him. */
  async function playerOf(playerId: string) {
    const [row] = await db
      .select({
        teamId: followedPlayers.currentTeamId,
        month: followedPlayers.birthdayMonth,
        day: followedPlayers.birthdayDay,
        origin: followedPlayers.birthdayOrigin,
        fileTeamId: statsSourceMappings.playerFileTeamId,
        fileReadAt: statsSourceMappings.playerFileReadAt,
      })
      .from(followedPlayers)
      .innerJoin(statsSourceMappings, eq(statsSourceMappings.playerId, followedPlayers.id))
      .where(eq(followedPlayers.id, playerId));
    return row;
  }

  /** His game of the US day `day`: its id and its scheduled start. */
  async function gameOf(playerId: string, day: string) {
    const [row] = await db
      .select({ id: games.id, start: games.scheduledStartAt })
      .from(boxScores)
      .innerJoin(games, eq(games.id, boxScores.gameId))
      .where(and(eq(boxScores.playerId, playerId), eq(games.gameDayOn, day)));
    return row ?? { id: 0, start: new Date(0) };
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

  it('[STA-25] [JOU-13] [CA-JOU-09] makes the team of a stored game he played for another team his current team, historized with his first game for it, and modifies no event nor case', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const playerId = await follow('p02', '2');
    await insertBoxScores(db, { playerId, source: 'p02', season: SEASON });
    const first = await gameOf(playerId, '2025-10-21');
    const traded = await gameOf(playerId, '2025-11-05');
    await importedCase(playerId, first.id, '2025-10-20');
    const before = await Promise.all([db.select().from(events), db.select().from(cases)]);

    const updated = await db.transaction(async (tx) => updateTeamFromGames(tx, playerId));

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

  it('[JOU-13] voids an entry whose first game is for the team he left, records the change back with that game, and reports it', async () => {
    const [pineValley, granite] = [await teamOf('2'), await teamOf('5')];
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-10-25' });
    moveTo(noon(10, 26));
    await enter(playerId, '5');

    const updated = await ingest(playerId, 'p02', { lastDay: '2025-10-28' });

    const back = await gameOf(playerId, '2025-10-27');
    expect(updated).toStrictEqual(REWRITTEN);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      entered(noon(10, 26), [pineValley, granite], null),
      observed(back.start, [granite, pineValley], back.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: pineValley });
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

  it('[JOU-13] turns the row of his addition observed when the player file gives the team chosen before any game judged it', async () => {
    moveTo(noon(11, 4));
    const redstone = await teamOf('3');
    const playerId = await follow('p02', '3');
    moveTo(noon(11, 5));

    const fileRead = await read(playerId, await recordOf('p02'));

    expect(fileRead).toStrictEqual({ ok: true, value: { ...MOVED.value, birthdayChanged: true } });
    await expect(historyOf(playerId)).resolves.toStrictEqual([
      observed(noon(11, 4), [null, redstone], null),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({
      teamId: redstone,
      fileTeamId: redstone,
      fileReadAt: noon(11, 5),
    });
  });

  it('[JOU-13] [CL-JOU-20] [CL-JOU-25] [CL-STA-31] sets "without team" for a release that the player file reads, at its first read or after a read that gave his team, a release counting as a team like another, and a second read of it being no news', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-11-02' });
    const record = await recordOf('p02');
    const release: PlayerRecord = { ...record, currentTeam: { kind: 'without_team' } };
    /** Applies `fileRecord`, read at noon on the November day `day`. */
    const readOn = async (day: number, fileRecord: PlayerRecord) => {
      moveTo(noon(11, day));
      return read(playerId, fileRecord);
    };

    const firstRead = await readOn(3, release);
    const signed = await readOn(4, record);
    const released = await readOn(5, release);
    const releasedAt = await playerOf(playerId);
    const again = await readOn(6, release);

    const moved = { ok: true, value: { ...MOVED.value, birthdayChanged: false } };
    expect([firstRead, signed, released, again]).toStrictEqual([
      { ok: true, value: { ...MOVED.value, birthdayChanged: true } },
      moved,
      moved,
      NOTHING,
    ]);
    expect(releasedAt).toMatchObject({ teamId: null, fileTeamId: null, fileReadAt: noon(11, 5) });
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { to: pineValley, origin: 'entered' },
      observed(noon(11, 3), [pineValley, null], null),
      observed(noon(11, 4), [null, redstone], null),
      observed(noon(11, 5), [redstone, null], null),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({
      teamId: null,
      fileTeamId: null,
      fileReadAt: noon(11, 6),
    });
  });

  it('[CL-JOU-25] [STA-25] keeps an entered change, not yet verified, when the player file still gives the team its previous read gave', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const granite = await teamOf('5');
    const playerId = await follow('p02', '2');
    await ingest(playerId, 'p02', { lastDay: '2025-11-02' });
    const record = await recordOf('p02');
    moveTo(noon(11, 3));
    await read(playerId, record);
    moveTo(noon(11, 4));
    await enter(playerId, '5');
    moveTo(noon(11, 5));

    const dayThree = await read(playerId, record);

    expect(dayThree).toStrictEqual(NOTHING);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      observed(noon(11, 3), [pineValley, redstone], null),
      entered(noon(11, 4), [redstone, granite], null),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({
      teamId: granite,
      fileTeamId: redstone,
      fileReadAt: noon(11, 5),
    });
  });

  it('[JOU-13] [CL-JOU-25] [CL-STA-27] [CL-JOU-03] never lets a first player-file read that gives the team of his last game before an entry take that entry back', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const granite = await teamOf('5');
    const playerId = await follow('p02', '2');
    // His last game before the entry is for Redstone, his first ones for Pine Valley.
    await ingest(playerId, 'p02', { lastDay: '2025-11-06' });
    const traded = await gameOf(playerId, '2025-11-05');
    moveTo(noon(11, 7));
    await enter(playerId, '5');
    moveTo(noon(11, 8));

    const fileRead = await read(playerId, await recordOf('p02'));

    expect(fileRead).toStrictEqual({ ok: true, value: { ...UNCHANGED, birthdayChanged: true } });
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      observed(traded.start, [pineValley, redstone], traded.id),
      entered(noon(11, 7), [redstone, granite], null),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({
      teamId: granite,
      fileTeamId: redstone,
      fileReadAt: noon(11, 8),
    });
  });

  it('[CL-JOU-25] [CL-STA-27] takes a record that the player file does not list as no read, leaving his team and the last read as they are', async () => {
    const redstone = await teamOf('3');
    const playerId = await follow('p02', '2');
    const record = await recordOf('p02');
    moveTo(noon(11, 3));
    await read(playerId, record);
    moveTo(noon(11, 4));

    const unlisted = await read(playerId, { ...record, currentTeam: { kind: 'not_listed' } });

    expect(unlisted).toStrictEqual(NOTHING);
    await expect(playerOf(playerId)).resolves.toMatchObject({
      teamId: redstone,
      fileTeamId: redstone,
      fileReadAt: noon(11, 3),
    });
  });

  it("[CL-JOU-16] [CL-JOU-11] fills an empty birthday from the source, replaces a source-given one only for a newly confirmed identity, and never the owner's", async () => {
    const playerId = await follow('p02', '3');
    const record = await recordOf('p02');
    const none = await read(playerId, { ...record, birthday: null });
    const filled = await read(playerId, record);
    await db
      .update(statsSourceMappings)
      .set({ sourcePlayerRef: 'p03' })
      .where(eq(statsSourceMappings.playerId, playerId));
    const namesake = await recordOf('p03');
    const kept = await read(playerId, namesake);
    const replaced = await read(playerId, namesake, true);
    const sourceGiven = await playerOf(playerId);
    await db
      .update(followedPlayers)
      .set({ birthdayMonth: 1, birthdayDay: 9, birthdayOrigin: 'owner' })
      .where(eq(followedPlayers.id, playerId));

    const owners = await read(playerId, namesake, true);

    expect(
      [none, filled, kept, replaced, owners].map(
        (applied) => applied.ok && applied.value.birthdayChanged,
      ),
    ).toStrictEqual([false, true, false, true, false]);
    expect(sourceGiven).toMatchObject({ month: 7, day: 2, origin: 'stats_source' });
    await expect(playerOf(playerId)).resolves.toMatchObject({ month: 1, day: 9, origin: 'owner' });
  });

  it('[CL-JOU-16] keeps out a day of birth that no calendar has, and applies the rest of the record', async () => {
    const redstone = await teamOf('3');
    const playerId = await follow('p02', '2');
    const record = await recordOf('p02');
    moveTo(noon(11, 4));

    const applied = await read(playerId, { ...record, birthday: { month: 2, day: 30 } });

    expect(applied).toStrictEqual({ ok: true, value: { ...MOVED.value, birthdayChanged: false } });
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: redstone, ...NO_BIRTHDAY });
  });

  it('[STA-25] refuses a record whose team the directory does not know yet, writing nothing of it', async () => {
    const pineValley = await teamOf('2');
    const playerId = await follow('p02', '2');
    const record = await recordOf('p02');

    const refused = await read(playerId, { ...record, currentTeam: { kind: 'team', team: '99' } });

    expect(refused).toStrictEqual({ ok: false, error: { kind: 'unknown_teams', teams: ['99'] } });
    await expect(playerOf(playerId)).resolves.toStrictEqual({
      teamId: pineValley,
      ...NO_BIRTHDAY,
      fileTeamId: null,
      fileReadAt: null,
    });
  });

  it('[STA-03] applies nothing of a record of an identity that is no longer his established mapping', async () => {
    const pineValley = await teamOf('2');
    const playerId = await follow('p02', '2');
    const record = await recordOf('p02');
    await db
      .update(statsSourceMappings)
      .set({ sourcePlayerRef: 'p03' })
      .where(eq(statsSourceMappings.playerId, playerId));
    const formerIdentity = await read(playerId, record);
    await db.transaction(async (tx) => changeMapping(tx, { playerId }));

    const reopened = await read(playerId, record);

    expect([formerIdentity, reopened]).toStrictEqual([NOTHING, NOTHING]);
    await expect(playerOf(playerId)).resolves.toMatchObject({ teamId: pineValley, ...NO_BIRTHDAY });
  });

  it('[JOU-08] keeps a relocated team under its id: its names of each season, its current name among the choices, and his one stint with it (CL-JOU-18)', async () => {
    await insertLeagueSeason(db, '2024-25');
    const gulls = await teamOf('6');
    const playerId = await follow('p05', '6');
    await insertBoxScores(db, { playerId, source: 'p05', season: '2024-25' });
    await ingest(playerId, 'p05', { lastDay: AFTER_SEASON });
    const first = await gameOf(playerId, '2024-10-22');

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
      { location: 'Granite Falls' },
      { location: 'Harbor City' },
      { location: 'Lakeport' },
      { location: 'Pine Valley' },
      { location: 'Redstone' },
      { teamId: gulls, location: 'Ridgeview', abbreviation: 'RVG' },
    ]);
    await expect(teamHistory(db, playerId)).resolves.toStrictEqual([
      { teamId: gulls, from: first.start.getTime(), until: null },
    ]);
  });
});
