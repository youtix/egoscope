import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { followedPlayers, statsSourceMappings } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertBoxScores, insertLeagueSeason } from '@/lib/testing';

import { changeMapping } from './mapping';
import {
  enter,
  entered,
  follow,
  gameOf,
  historyOf,
  keepLinesThrough,
  MOVED,
  moveTo,
  NO_BIRTHDAY,
  noon,
  NOTHING,
  observed,
  openLeague,
  playerOf,
  read,
  recordOf,
  scheduledGame,
  SEASON,
  teamOf,
  UNCHANGED,
} from './teams-test-league';

import type { Database } from '@/lib/db';
import type { PlayerRecord } from '@/lib/stats-source';

describe('the records of the player file', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const league = await openLeague();
    db = league.db;
    await insertLeagueSeason(db, SEASON);
    return league.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Stores his lines of 2025-26 up to the US day `lastDay`, then updates his team from his games. */
  async function ingest(playerId: string, lastDay: string) {
    await insertBoxScores(db, { playerId, source: 'p02', season: SEASON });
    return keepLinesThrough(playerId, SEASON, lastDay);
  }

  /** Puts his mapping on p03, his namesake's identity, as a confirmation in place of another does. */
  async function confirmNamesake(playerId: string): Promise<void> {
    await db
      .update(statsSourceMappings)
      .set({ sourcePlayerRef: 'p03' })
      .where(eq(statsSourceMappings.playerId, playerId));
  }

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
    await ingest(playerId, '2025-11-02');
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
    await ingest(playerId, '2025-11-02');
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

  it('[CL-JOU-25] [CL-STA-27] takes a read that gives the team its previous read gave for no news, even after his first game verified an entered change away from that team', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const playerId = await follow('p02', '2');
    await ingest(playerId, '2025-11-02');
    const stale: PlayerRecord = {
      ...(await recordOf('p02')),
      currentTeam: { kind: 'team', team: '2' },
    };
    moveTo(noon(11, 3));
    const firstRead = await read(playerId, stale);
    moveTo(noon(11, 4));
    await enter(playerId, '3');
    await ingest(playerId, '2025-11-06');
    const traded = await gameOf(playerId, '2025-11-05');
    moveTo(noon(11, 8));

    const again = await read(playerId, stale);

    expect([firstRead, again]).toStrictEqual([
      { ok: true, value: { ...UNCHANGED, birthdayChanged: true } },
      NOTHING,
    ]);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      entered(noon(11, 4), [pineValley, redstone], traded.id),
    ]);
    await expect(playerOf(playerId)).resolves.toMatchObject({
      teamId: redstone,
      fileTeamId: pineValley,
      fileReadAt: noon(11, 8),
    });
  });

  it('[JOU-13] [CL-JOU-25] [CL-STA-27] [CL-JOU-03] never lets a first player-file read take an entry back when it gives the team of his last game at the entry, a game at its very instant, fetched after it', async () => {
    const [pineValley, redstone] = [await teamOf('2'), await teamOf('3')];
    const granite = await teamOf('5');
    const playerId = await follow('p02', '2');
    // His first game verifies his addition; his last ones before the entry are for Pine Valley.
    await ingest(playerId, '2025-11-02');
    const traded = await scheduledGame(redstone, '2025-11-05');
    moveTo(traded.start);
    await enter(playerId, '5');
    // His first game for Redstone, at the very instant of the entry, is fetched after it.
    const late = await ingest(playerId, '2025-11-06');
    moveTo(noon(11, 8));

    const fileRead = await read(playerId, await recordOf('p02'));

    expect([late, fileRead]).toStrictEqual([
      { ok: true, value: UNCHANGED },
      { ok: true, value: { ...UNCHANGED, birthdayChanged: true } },
    ]);
    await expect(historyOf(playerId)).resolves.toMatchObject([
      { origin: 'entered' },
      entered(traded.start, [pineValley, granite], null),
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
    await confirmNamesake(playerId);
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

  it("[CL-JOU-11] [CL-JOU-16] clears a source-given birthday when the first record of a newly confirmed identity gives none, keeps it for another record that gives none, and never clears the owner's", async () => {
    const playerId = await follow('p02', '3');
    await read(playerId, await recordOf('p02'));
    const kept = await read(playerId, { ...(await recordOf('p02')), birthday: null });
    const keptBirthday = await playerOf(playerId);
    await confirmNamesake(playerId);
    const silent: PlayerRecord = { ...(await recordOf('p03')), birthday: null };
    const cleared = await read(playerId, silent, true);
    const clearedBirthday = await playerOf(playerId);
    await db
      .update(followedPlayers)
      .set({ birthdayMonth: 1, birthdayDay: 9, birthdayOrigin: 'owner' })
      .where(eq(followedPlayers.id, playerId));

    const owners = await read(playerId, silent, true);

    expect(
      [kept, cleared, owners].map((applied) => applied.ok && applied.value.birthdayChanged),
    ).toStrictEqual([false, true, false]);
    expect([keptBirthday, clearedBirthday]).toMatchObject([
      { month: 3, day: 14, origin: 'stats_source' },
      NO_BIRTHDAY,
    ]);
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

  it("[STA-03] applies nothing of a record of an identity that is no longer his established mapping, even when it is another player's now, and writes no read of that player on his mapping", async () => {
    const pineValley = await teamOf('2');
    const playerId = await follow('p02', '2');
    const record = await recordOf('p02');
    await confirmNamesake(playerId);
    const other = await follow('p02', '3');
    const formerIdentity = await read(playerId, record);
    await db.transaction(async (tx) => changeMapping(tx, { playerId }));

    const reopened = await read(playerId, record);
    await read(other, record);

    expect([formerIdentity, reopened]).toStrictEqual([NOTHING, NOTHING]);
    await expect(playerOf(playerId)).resolves.toStrictEqual({
      teamId: pineValley,
      ...NO_BIRTHDAY,
      fileTeamId: null,
      fileReadAt: null,
    });
  });
});
