import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  cases,
  createTestDatabase,
  eventCorrections,
  events,
  eventSources,
  eventTypes,
  followedPlayers,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { applyCorrection } from './corrections';

import type { EventCorrection } from './corrections';
import type { EventRow } from './types';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const TIMED_AT = toEpochMs(Date.UTC(2024, 10, 21, 18, 45));
const PARIS_WINTER_OFFSET = 60;
const OTHER_TYPE = 'trade-rumor';
const OLD_LINK = 'https://news.example.com/2024/11/20/coverage';
const KEPT_LINK = 'https://daily.example.org/storm';
const MAX_LENGTH = 200;
const NOT_FOLLOWED = { ok: false, error: { kind: 'player_not_followed' } } as const;
const UNKNOWN_PLAYER = '6f1d2c3b-4a59-4e8f-9b7a-0c1d2e3f4a5b';

/** A source of a correction, published on `on`, its link cleaned as itself. */
function source(url: string, on: string) {
  return {
    url,
    cleanedUrl: url,
    outlet: 'Daily',
    title: 'Coverage',
    publication: { on: toIsoDate(on), at: null },
  } as const;
}

describe('applyCorrection', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let historical: EventRow;

  /** Corrects `event` in a transaction of its own, with the version it holds. */
  async function correct(event: EventRow, changes: Omit<EventCorrection, 'expectedVersion'>) {
    return db.transaction(async (tx) =>
      applyCorrection(tx, event.id, { ...changes, expectedVersion: event.rowVersion }),
    );
  }

  /** The event `eventId` as the database now holds it. */
  async function storedEvent(eventId: number): Promise<EventRow> {
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    if (row === undefined) {
      throw new Error(`The event ${String(eventId)} is missing.`);
    }
    return row;
  }

  async function correctionsOf(eventId: number) {
    return db
      .select()
      .from(eventCorrections)
      .where(eq(eventCorrections.playerEventId, eventId))
      .orderBy(asc(eventCorrections.id));
  }

  /** The field and the values before and after of each correction of `eventId`. */
  async function correctionValues(eventId: number) {
    const rows = await correctionsOf(eventId);
    return rows.map((row) => [row.field, row.beforeValue, row.afterValue]);
  }

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    await insertEventType(db);
    ({ id: playerId } = await insertPlayer(db));
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
    historical = await insertHistoricalEvent(db, { playerId, originImportId: imported.id });
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[IMP-32] [CA-IMP-19] [CL-DSN-15] changes the fields of a historical event and traces each with its date, never its old value', async () => {
    const outcome = await correct(historical, {
      publicDate: { on: toIsoDate('2024-11-21'), at: TIMED_AT, offsetMinutes: PARIS_WINTER_OFFSET },
      description: '  The player led every sports page for two days.  ',
      researchConfidence: 'medium',
      injuryReturn: 'yes',
      unverifiedNote: 'The second outlet could not be reached.',
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        changed: [
          'reference_date',
          'description',
          'injury_return',
          'research_confidence',
          'unverified_note',
        ],
        event: {
          referenceDateOn: '2024-11-21',
          referenceAt: new Date(TIMED_AT),
          referenceOffsetMinutes: PARIS_WINTER_OFFSET,
          referenceDatePrecision: 'exact',
          description: 'The player led every sports page for two days.',
          researchConfidence: 'medium',
          injuryReturn: 'yes',
          injuryReturnOrigin: 'user',
          unverifiedNote: 'The second outlet could not be reached.',
          rowVersion: historical.rowVersion + 1,
          updatedAt: new Date(AT),
        },
      },
    });
    const rows = await correctionsOf(historical.id);
    expect(
      rows.map(({ field, correctedAt, beforeValue, afterValue }) => ({
        field,
        correctedAt,
        beforeValue,
        afterValue,
      })),
    ).toStrictEqual(
      [
        'reference_date',
        'description',
        'injury_return',
        'research_confidence',
        'unverified_note',
      ].map((field) => ({
        field,
        correctedAt: new Date(AT),
        beforeValue: null,
        afterValue: null,
      })),
    );
  });

  it('[IMP-32] turns a timed public date back into a day, and writes nothing for a value it already holds', async () => {
    const timed = await correct(historical, {
      publicDate: { on: toIsoDate('2024-11-21'), at: TIMED_AT, offsetMinutes: 0 },
    });
    expect(timed.ok).toBe(true);
    const stored = await storedEvent(historical.id);
    const unchanged = await correct(stored, {
      publicDate: { on: toIsoDate('2024-11-21'), at: TIMED_AT, offsetMinutes: 0 },
      gameStakes: 'unknown',
    });
    const dated = await correct(stored, {
      publicDate: { on: toIsoDate('2024-11-21'), at: null },
    });

    expect(unchanged).toStrictEqual({ ok: true, value: { event: stored, changed: [] } });
    expect(dated).toMatchObject({
      ok: true,
      value: {
        event: {
          referenceAt: null,
          referenceOffsetMinutes: null,
          referenceDatePrecision: 'approximate',
        },
      },
    });
    expect(await correctionsOf(historical.id)).toHaveLength(2);
  });

  it('[CL-IHM-18] refuses a save sent with an older version, giving the event as it stands', async () => {
    const first = await correct(historical, { researchConfidence: 'low' });
    const stale = await correct(historical, {
      description: 'Another sentence about the coverage.',
    });

    expect(stale).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: first.ok ? first.value.event : null },
    });
    expect(await correctionsOf(historical.id)).toHaveLength(1);
  });

  it('[CL-IHM-19] answers that an event that no longer exists cannot be corrected', async () => {
    const outcome = await db.transaction(async (tx) =>
      applyCorrection(tx, historical.id + 1, { expectedVersion: 1, researchConfidence: 'low' }),
    );

    expect(outcome).toStrictEqual({ ok: false, error: { kind: 'no_longer_exists' } });
  });

  it('[DSN-20] [DSN-21] [CL-IMP-26] holds a corrected description and unverified note to the length and quotation-mark rules', async () => {
    const tooLong = 'a'.repeat(MAX_LENGTH + 1);

    await expect(
      correct(historical, { description: tooLong, unverifiedNote: 'He said "no comment".' }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_fields',
        fields: {
          description: [{ kind: 'too_long', length: MAX_LENGTH + 1, maxLength: MAX_LENGTH }],
          unverifiedNote: [{ kind: 'quotation_mark', character: '"' }],
        },
      },
    });
    await expect(correct(historical, { description: ' '.repeat(3) })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid_fields', fields: { description: 'required' } },
    });
    await expect(
      correct(historical, { description: 'a'.repeat(MAX_LENGTH), unverifiedNote: '  ' }),
    ).resolves.toMatchObject({
      ok: true,
      value: { event: { description: 'a'.repeat(MAX_LENGTH), unverifiedNote: null } },
    });
  });

  it('[TAX-23] [CL-TAX-22] stamps a corrected type with its version in force, leaving the case to the recalculation, and refuses a type not validated', async () => {
    await insertEventType(db, { id: OTHER_TYPE, name: 'Trade rumor' });
    await db.insert(eventTypes).values({
      id: 'proposed-type',
      name: 'Proposed type',
      status: 'proposed',
      origin: 'scoping',
    });
    const [written] = await db
      .insert(cases)
      .values({
        playerId,
        eventTypeId: MEDIA_STORM,
        origin: 'historical',
        status: 'not_measurable',
        statusReason: 'no_game_within_window',
        referenceInstantAt: new Date(AT),
        referenceInstantOrigin: 'date_only',
      })
      .returning({ id: cases.id });
    await db.update(events).set({ caseId: written?.id }).where(eq(events.id, historical.id));
    const inCase = await storedEvent(historical.id);
    expect(inCase.caseId).toBe(written?.id);

    await expect(correct(inCase, { eventTypeId: 'proposed-type' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid_fields', fields: { eventTypeId: 'not_validated' } },
    });
    await expect(correct(inCase, { eventTypeId: OTHER_TYPE })).resolves.toMatchObject({
      ok: true,
      value: {
        changed: ['event_type'],
        event: {
          eventTypeId: OTHER_TYPE,
          sheetEventTypeId: OTHER_TYPE,
          sheetVersionNumber: 1,
          caseId: null,
        },
      },
    });
    await expect(storedEvent(historical.id)).resolves.toMatchObject({
      eventTypeId: OTHER_TYPE,
      caseId: null,
    });
  });

  it('[CL-IMP-25] keeps the check of an unchanged link and gives a corrected or added link no check', async () => {
    const checkedAt = new Date(AT - 1);
    const storedSource = (url: string, position: number) =>
      ({
        playerEventId: historical.id,
        position,
        url,
        cleanedUrl: url,
        outlet: 'Daily',
        title: 'Coverage',
        publicationDateOn: '2024-11-20',
        linkCheckedAt: checkedAt,
      }) as const;
    await db.insert(eventSources).values([
      { ...storedSource(OLD_LINK, 1), linkStatus: 'not_found' },
      { ...storedSource(KEPT_LINK, 2), spotCheckVerdict: 'consistent' },
    ]);

    const outcome = await correct(historical, {
      sources: [
        source(KEPT_LINK, '2024-11-20'),
        source(`${OLD_LINK}-corrected`, '2024-11-20'),
        source('https://third.example.net/a', '2024-11-21'),
      ],
    });

    expect(outcome).toMatchObject({ ok: true, value: { changed: ['sources'] } });
    const stored = await db
      .select()
      .from(eventSources)
      .where(eq(eventSources.playerEventId, historical.id))
      .orderBy(asc(eventSources.position));
    expect(
      stored.map(
        ({ position, url, linkStatus, linkCheckedAt, spotCheckVerdict, publicationDateOn }) => ({
          position,
          url,
          linkStatus,
          linkCheckedAt,
          spotCheckVerdict,
          publicationDateOn,
        }),
      ),
    ).toStrictEqual([
      {
        position: 1,
        url: KEPT_LINK,
        linkStatus: null,
        linkCheckedAt: checkedAt,
        spotCheckVerdict: 'consistent',
        publicationDateOn: '2024-11-20',
      },
      {
        position: 2,
        url: `${OLD_LINK}-corrected`,
        linkStatus: null,
        linkCheckedAt: null,
        spotCheckVerdict: null,
        publicationDateOn: '2024-11-20',
      },
      {
        position: 3,
        url: 'https://third.example.net/a',
        linkStatus: null,
        linkCheckedAt: null,
        spotCheckVerdict: null,
        publicationDateOn: '2024-11-21',
      },
    ]);
    const corrected = await storedEvent(historical.id);
    await expect(
      correct(corrected, {
        sources: [
          source(KEPT_LINK, '2024-11-20'),
          source(`${OLD_LINK}-corrected`, '2024-11-20'),
          source('https://third.example.net/a', '2024-11-21'),
        ],
      }),
    ).resolves.toMatchObject({ ok: true, value: { changed: [] } });
    await expect(correctionValues(historical.id)).resolves.toStrictEqual([['sources', null, null]]);
  });

  it('[IMP-32] [DET-47] refuses a change of player or a detected-event field of a historical event, and a historical field of a detected event', async () => {
    const detected = await insertDetectedEvent(db, { playerId });

    await expect(
      correct(historical, {
        playerId,
        researchConfidence: 'low',
        reference: { at: TIMED_AT, precision: 'exact', rule: 'earliest_source' },
        detectionConfidence: null,
        classificationOrigin: 'user',
        detachedArticle: 'reference_article',
        mergedEventId: detected.id,
      }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'not_correctable',
        fields: [
          'player',
          'reference_date',
          'detection_confidence',
          'classification_origin',
          'article_detached',
          'event_merged_in',
        ],
      },
    });
    await expect(
      correct(detected, {
        publicDate: { on: toIsoDate('2024-11-21'), at: null },
        description: 'A new sentence.',
        sources: [source(KEPT_LINK, '2024-11-20')],
        researchConfidence: 'high',
        unverifiedNote: 'Nothing to add.',
      }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'not_correctable',
        fields: ['reference_date', 'sources', 'research_confidence', 'unverified_note'],
      },
    });
    expect(await correctionsOf(detected.id)).toStrictEqual([]);
  });

  it('[DET-47] [CA-DET-27] refuses to move a detected event to an unknown, a malformed or a deleted player, writing nothing', async () => {
    const detected = await insertDetectedEvent(db, { playerId });
    const { id: deletedId } = await insertPlayer(db, { source: 'p02' });
    await db.delete(followedPlayers).where(eq(followedPlayers.id, deletedId));

    for (const id of [UNKNOWN_PLAYER, 'not-a-player', deletedId]) {
      await expect(correct(detected, { playerId: id, gameStakes: 'high' })).resolves.toStrictEqual(
        NOT_FOLLOWED,
      );
    }
    await expect(storedEvent(detected.id)).resolves.toStrictEqual(detected);
    expect(await correctionsOf(detected.id)).toStrictEqual([]);
  });

  it('[DET-47] [CA-DET-27] [DET-52] moves a detected event to an active, a paused or a withdrawn player with its correction, and keeps one that names its own player', async () => {
    const statuses = [
      ['p02', 'active'],
      ['p03', 'paused'],
      ['p04', 'withdrawn'],
    ] as const;
    for (const [leaguePlayer, status] of statuses) {
      const detected = await insertDetectedEvent(db, { playerId });
      const { id } = await insertPlayer(db, { source: leaguePlayer, overrides: { status } });

      await expect(correct(detected, { playerId: id })).resolves.toMatchObject({
        ok: true,
        value: { changed: ['player'], event: { playerId: id, rowVersion: 2 } },
      });
      await expect(correctionValues(detected.id)).resolves.toStrictEqual([
        ['player', playerId, id],
      ]);
    }
    const kept = await insertDetectedEvent(db, { playerId });
    await expect(correct(kept, { playerId, gameStakes: 'high' })).resolves.toMatchObject({
      ok: true,
      value: { changed: ['game_stakes'], event: { playerId } },
    });
  });

  it('[DET-47] [CA-DET-27] answers that the player is not followed before it checks the values of the fields, writing nothing', async () => {
    const detected = await insertDetectedEvent(db, { playerId });

    await expect(
      correct(detected, { playerId: UNKNOWN_PLAYER, description: 'a'.repeat(MAX_LENGTH + 1) }),
    ).resolves.toStrictEqual(NOT_FOLLOWED);
    await expect(storedEvent(detected.id)).resolves.toStrictEqual(detected);
    expect(await correctionsOf(detected.id)).toStrictEqual([]);
  });

  describe('of a calendar-derived event', () => {
    let calendar: EventRow;

    beforeEach(async () => {
      await insertCalendarType(db);
      const games = await insertLeagueSeason(db, '2024-25');
      const [gameId] = games.values();
      const [written] = await db
        .insert(events)
        .values({
          playerId,
          eventTypeId: 'birthday',
          sheetEventTypeId: 'birthday',
          sheetVersionNumber: 1,
          origin: 'calendar',
          referenceDateOn: '2024-11-20',
          description: 'The player plays on his birthday.',
          derivedGameId: gameId,
        })
        .returning({ id: events.id });
      calendar = await storedEvent(written?.id ?? 0);
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[CL-DSN-20] [CL-DSN-15] [H-09] corrects the context alone, each correction keeping its values before and after', async () => {
      const outcome = await correct(calendar, { injuryReturn: 'no', gameStakes: 'high' });

      expect(outcome).toMatchObject({
        ok: true,
        value: {
          changed: ['injury_return', 'game_stakes'],
          event: {
            injuryReturn: 'no',
            injuryReturnOrigin: 'user',
            gameStakes: 'high',
            gameStakesOrigin: 'user',
          },
        },
      });
      await expect(correctionValues(calendar.id)).resolves.toStrictEqual([
        ['injury_return', 'unknown', 'no'],
        ['game_stakes', 'unknown', 'high'],
      ]);
    });

    it('[DET-47] [CL-IHM-21] [IMP-32] answers that a derived or a historical event cannot change its player, whatever player it names', async () => {
      for (const event of [calendar, historical]) {
        await expect(correct(event, { playerId: UNKNOWN_PLAYER })).resolves.toStrictEqual({
          ok: false,
          error: { kind: 'not_correctable', fields: ['player'] },
        });
      }
    });

    it('[CL-IHM-21] refuses a change of its type, player or date, which are derived', async () => {
      const outcome = await correct(calendar, {
        playerId,
        eventTypeId: MEDIA_STORM,
        publicDate: { on: toIsoDate('2024-11-21'), at: null },
        injuryReturn: 'yes',
      });

      expect(outcome).toStrictEqual({
        ok: false,
        error: { kind: 'not_correctable', fields: ['player', 'event_type', 'reference_date'] },
      });
      expect(await correctionsOf(calendar.id)).toStrictEqual([]);
    });

    it('[CL-IHM-21] [CL-DSN-20] [H-09] refuses a change of its template description, its sources, its confidence or an unverified note, the context alone being correctable', async () => {
      const outcome = await correct(calendar, {
        description: 'Another sentence about the birthday.',
        sources: [source(KEPT_LINK, '2024-11-20')],
        researchConfidence: 'high',
        unverifiedNote: 'Nothing to add.',
        gameStakes: 'high',
      });

      expect(outcome).toStrictEqual({
        ok: false,
        error: {
          kind: 'not_correctable',
          fields: ['description', 'sources', 'research_confidence', 'unverified_note'],
        },
      });
      await expect(storedEvent(calendar.id)).resolves.toStrictEqual(calendar);
      expect(await correctionsOf(calendar.id)).toStrictEqual([]);
    });
  });
});
