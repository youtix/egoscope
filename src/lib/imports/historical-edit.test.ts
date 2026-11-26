import { asc, eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  createTestDatabase,
  eventCorrections,
  events,
  eventSources,
  journalEntries,
  parameterOverrides,
  recalculationJobs,
  tallyExits,
} from '@/lib/db';
import { uncheckedSources } from '@/lib/events';
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
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type { HistoricalCorrection, TypedDate, TypedSource } from './historical-checks';
import type { Database } from '@/lib/db';
import type { EventRow } from '@/lib/testing';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const LATER = toEpochMs(AT + 3_600_000);
const PLAN = { computedAt: AT, entries: [{ task: 'purge', dueAt: LATER }], probes: [] } as const;
const OTHER_TYPE = 'trade-rumor';
const STORED_LINK = 'https://news.example.com/2024/11/20/storm';
const KEPT_LINK = 'https://daily.example.org/storm';
const NEW_LINK = 'https://third.example.net/a';
const CAUSE = 'event_corrected_or_removed';

/** A date-only typed date. */
function day(on: string): TypedDate {
  return { on, time: null, timeZone: null };
}

/** A typed source of `url`, published on the day `on`. */
function typedSource(url: string, on: string): TypedSource {
  return { url, outlet: 'Daily', title: 'Coverage', publication: day(on) };
}

/** Orders task keys by their code points. */
function byKey(left: string, right: string): number {
  return left < right ? -1 : 1;
}

/** The job that recalculates the player's profiles of `eventTypeIds`. */
function jobOf(playerId: string, eventTypeIds: readonly string[]) {
  return { scope: 'event_or_case_change', playerIds: [playerId], eventTypeIds, cause: CAUSE };
}

/** The historical-edit module and the wake plan, over a fresh fake of the runtime cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_historical_edit');
  return {
    edit: await import('./historical-edit'),
    wakePlan: await import('@/lib/wake-plan'),
  };
}

describe('historical corrections and deletions', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let historical: EventRow;
  let loaded: Awaited<ReturnType<typeof load>>;

  /** Corrects `event` in a transaction of its own, with the version it holds. */
  async function correct(event: EventRow, changes: Omit<HistoricalCorrection, 'expectedVersion'>) {
    return db.transaction(async (tx) =>
      loaded.edit.correctHistorical(tx, event.id, {
        ...changes,
        expectedVersion: event.rowVersion,
      }),
    );
  }

  /** Deletes `event` in a transaction of its own, with the version it holds. */
  async function remove(event: EventRow, reason: string, detail: string | null = null) {
    return db.transaction(async (tx) =>
      loaded.edit.deleteHistorical(tx, event.id, {
        reason,
        detail,
        expectedVersion: event.rowVersion,
      }),
    );
  }

  async function storedEvent(eventId: number) {
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    return row;
  }

  async function sourcesOf(eventId: number) {
    return db
      .select()
      .from(eventSources)
      .where(eq(eventSources.playerEventId, eventId))
      .orderBy(asc(eventSources.position));
  }

  async function jobs() {
    return db
      .select({
        scope: recalculationJobs.scope,
        playerIds: recalculationJobs.playerIds,
        eventTypeIds: recalculationJobs.eventTypeIds,
        cause: recalculationJobs.cause,
      })
      .from(recalculationJobs)
      .orderBy(asc(recalculationJobs.id));
  }

  async function journaled() {
    return db
      .select({
        messageKey: journalEntries.messageKey,
        playerEventId: journalEntries.playerEventId,
      })
      .from(journalEntries)
      .where(
        inArray(journalEntries.messageKey, [
          'historical_event_corrected',
          'historical_event_deleted',
        ]),
      )
      .orderBy(asc(journalEntries.id));
  }

  /** The tasks that the wake plan holds, by key. */
  async function dueTasks() {
    const reading = await loaded.wakePlan.readPlan(AT);
    return reading.ok
      ? reading.plan.entries.map(({ task }) => task).toSorted(byKey)
      : reading.error;
  }

  /** Nothing of a refused change was written: the event, a job or a journal entry. */
  async function expectUnchanged(event: EventRow) {
    await expect(storedEvent(event.id)).resolves.toStrictEqual(event);
    expect(await jobs()).toStrictEqual([]);
    expect(await journaled()).toStrictEqual([]);
  }

  beforeEach(async () => {
    vi.stubGlobal(PROCESS_FAKE, undefined);
    onTestFinished(installFakeClock(fixedClock(AT)));
    loaded = await load();
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(database.close);
    await loaded.wakePlan.writePlan(PLAN);
    await insertEventType(db);
    ({ id: playerId } = await insertPlayer(db));
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
    historical = await insertHistoricalEvent(db, { playerId, originImportId: imported.id });
    await db.insert(eventSources).values({
      playerEventId: historical.id,
      position: 1,
      url: STORED_LINK,
      cleanedUrl: STORED_LINK,
      outlet: 'News',
      title: 'Storm',
      publicationDateOn: '2024-11-20',
      addedAt: new Date(AT),
      linkCheckedAt: new Date(AT),
      linkStatus: 'not_found',
    });
  }, DATABASE_TEST_TIMEOUT_MS);

  describe('of a historical event', () => {
    it('[IMP-32] [CA-IMP-19] [CL-IMP-17] changes the public date, traced without its old value, then journals it and recalculates the player', async () => {
      const outcome = await correct(historical, { publicDate: day('2024-11-21') });

      expect(outcome).toMatchObject({ ok: true, value: { changed: ['reference_date'] } });
      await expect(storedEvent(historical.id)).resolves.toMatchObject({
        referenceDateOn: '2024-11-21',
        referenceAt: null,
        referenceDatePrecision: 'approximate',
      });
      const traced = await db
        .select({
          correctedAt: eventCorrections.correctedAt,
          field: eventCorrections.field,
          beforeValue: eventCorrections.beforeValue,
          afterValue: eventCorrections.afterValue,
        })
        .from(eventCorrections)
        .where(eq(eventCorrections.playerEventId, historical.id));
      expect(traced).toStrictEqual([
        { correctedAt: new Date(AT), field: 'reference_date', beforeValue: null, afterValue: null },
      ]);
      expect({
        jobs: await jobs(),
        journal: await journaled(),
        due: await dueTasks(),
      }).toStrictEqual({
        jobs: [jobOf(playerId, [MEDIA_STORM])],
        journal: [{ messageKey: 'historical_event_corrected', playerEventId: historical.id }],
        due: ['purge', 'recalculation'],
      });
    });

    it('[IMP-32] [CA-IMP-19] [CL-IMP-31] refuses a public date after the owner day of the correction, writing nothing', async () => {
      const outcome = await correct(historical, {
        publicDate: day('2026-11-26'),
        sources: [typedSource(KEPT_LINK, '2026-11-25')],
      });

      expect(outcome).toStrictEqual({
        ok: false,
        error: {
          kind: 'failed_checks',
          problems: [{ kind: 'ignored', reason: 'outside_requested_period' }],
        },
      });
      await expectUnchanged(historical);
    });

    it.each([
      [
        'a quotation mark in the description',
        { description: 'He said "never again" to every outlet.' },
        [{ kind: 'refused', refusal: { reason: 'description_quotation_mark', character: '"' } }],
      ],
      [
        'no source left',
        { sources: [] },
        [{ kind: 'refused', refusal: { reason: 'no_valid_source' } }],
      ],
      [
        'a source more than the tolerated lead before the public date',
        { sources: [typedSource(KEPT_LINK, '2024-11-15')] },
        [{ kind: 'refused', refusal: { reason: 'source_before_public_date', sourcePosition: 1 } }],
      ],
      [
        'a public date moved away from its stored source',
        { publicDate: day('2024-11-25') },
        [{ kind: 'refused', refusal: { reason: 'source_before_public_date', sourcePosition: 1 } }],
      ],
      [
        'an unvalidated type',
        { eventTypeId: OTHER_TYPE },
        [{ kind: 'ignored', reason: 'type_not_validated' }],
      ],
    ] as const)(
      '[IMP-32] [IMP-11] [IMP-13] [IMP-14] refuses %s with the code of the import, writing nothing',
      async (_case, changes, problems) => {
        await insertEventType(db, { id: OTHER_TYPE, status: 'proposed' });

        const outcome = await correct(historical, changes);

        expect(outcome).toStrictEqual({ ok: false, error: { kind: 'failed_checks', problems } });
        await expectUnchanged(historical);
      },
    );

    it('[IMP-32] moves the event to another validated type and recalculates both types', async () => {
      await insertEventType(db, { id: OTHER_TYPE });

      const outcome = await correct(historical, { eventTypeId: OTHER_TYPE });

      expect(outcome).toMatchObject({ ok: true, value: { changed: ['event_type'] } });
      expect(await jobs()).toStrictEqual([jobOf(playerId, [MEDIA_STORM, OTHER_TYPE])]);
    });

    it('[CL-IMP-31] stores a time typed in the owner zone as an exact public date, 00:00 included', async () => {
      await db
        .insert(parameterOverrides)
        .values({ parameterKey: 'display.timeZone', value: 'America/Chicago' });

      const outcome = await correct(historical, {
        publicDate: { on: '2024-11-20', time: '00:00', timeZone: null },
      });

      expect(outcome).toMatchObject({ ok: true, value: { changed: ['reference_date'] } });
      await expect(storedEvent(historical.id)).resolves.toMatchObject({
        referenceDateOn: '2024-11-20',
        referenceAt: new Date(Date.UTC(2024, 10, 20, 6)),
        referenceOffsetMinutes: -360,
        referenceDatePrecision: 'exact',
      });
    });

    it('[IMP-32] [CL-IMP-25] stores the cleaned links, and a corrected link loses its check and wakes the link check', async () => {
      const [stored] = await sourcesOf(historical.id);

      const outcome = await correct(historical, {
        sources: [
          typedSource(STORED_LINK, '2024-11-20'),
          typedSource(`${KEPT_LINK}?utm_source=feed&id=7`, '2024-11-20'),
        ],
      });

      expect(outcome).toMatchObject({ ok: true, value: { changed: ['sources'] } });
      const sources = await sourcesOf(historical.id);
      expect(sources.map(({ url, cleanedUrl }) => [url, cleanedUrl])).toStrictEqual([
        [STORED_LINK, STORED_LINK],
        [`${KEPT_LINK}?utm_source=feed&id=7`, `${KEPT_LINK}?id=7`],
      ]);
      expect(sources[0]).toMatchObject({ id: stored?.id, linkCheckedAt: new Date(AT) });
      await expect(uncheckedSources(db, 10)).resolves.toStrictEqual([
        { sourceId: sources[1]?.id, url: `${KEPT_LINK}?utm_source=feed&id=7` },
      ]);
      expect(await dueTasks()).toStrictEqual(['link-check', 'purge']);
    });

    it('[IMP-17] wakes no link check while it is off, nor for a change that keeps the sources', async () => {
      await correct(historical, { researchConfidence: 'medium' });
      expect(await dueTasks()).toStrictEqual(['purge', 'recalculation']);

      await db
        .insert(parameterOverrides)
        .values({ parameterKey: 'imports.linkCheckEnabled', value: false });
      const current = await storedEvent(historical.id);
      await correct(current ?? historical, { sources: [typedSource(NEW_LINK, '2024-11-20')] });

      expect(await sourcesOf(historical.id)).toMatchObject([
        { url: NEW_LINK, linkCheckedAt: null },
      ]);
      expect(await dueTasks()).toStrictEqual(['purge', 'recalculation']);
    });

    it('[IMP-32] writes, journals and recalculates nothing for a correction that changes nothing', async () => {
      const outcome = await correct(historical, { description: ` ${historical.description}` });

      expect(outcome).toMatchObject({ ok: true, value: { changed: [] } });
      expect(await jobs()).toStrictEqual([]);
      expect(await journaled()).toStrictEqual([]);
    });

    it('[IMP-32] [CL-IHM-18] refuses a stale version, a player change, a missing event and a detected one', async () => {
      const stale = await db.transaction(async (tx) =>
        loaded.edit.correctHistorical(tx, historical.id, {
          // A change that fails the checks too: the stale version is refused first.
          description: 'He said "never again".',
          expectedVersion: historical.rowVersion + 1,
        }),
      );
      expect(stale).toMatchObject({
        ok: false,
        error: { kind: 'changed_elsewhere', current: historical },
      });
      const { id: otherPlayer } = await insertPlayer(db, { source: 'p02' });
      await expect(correct(historical, { playerId: otherPlayer })).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'not_correctable', fields: ['player'] },
      });
      await expect(correct({ ...historical, id: historical.id + 100 }, {})).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'no_longer_exists' },
      });
      const detected = await insertDetectedEvent(db, { playerId });
      await expect(correct(detected, { injuryReturn: 'yes' })).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'detected_event' },
      });
      await expectUnchanged(historical);
    });
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
        .returning();
      if (written === undefined) {
        throw new Error('The calendar-derived event is missing.');
      }
      calendar = written;
    }, DATABASE_TEST_TIMEOUT_MS);

    it('[CL-IHM-21] [CL-DSN-20] changes its two context indications (ADR 0015), journaled and recalculated', async () => {
      const outcome = await correct(calendar, { injuryReturn: 'no', gameStakes: 'high' });

      expect(outcome).toMatchObject({
        ok: true,
        value: { changed: ['injury_return', 'game_stakes'] },
      });
      expect(await journaled()).toStrictEqual([
        { messageKey: 'historical_event_corrected', playerEventId: calendar.id },
      ]);
      expect(await jobs()).toStrictEqual([jobOf(playerId, ['birthday'])]);
    });

    it('[CL-IHM-21] changes one context indication alone', async () => {
      const outcome = await correct(calendar, { gameStakes: 'normal' });

      expect(outcome).toMatchObject({ ok: true, value: { changed: ['game_stakes'] } });
      await expect(storedEvent(calendar.id)).resolves.toMatchObject({
        injuryReturn: 'unknown',
        gameStakes: 'normal',
      });
    });

    it('[CL-IHM-21] [CL-DSN-20] refuses its type, player, date, sources and texts (ADR 0015), writing nothing', async () => {
      await insertEventType(db, { id: OTHER_TYPE });

      const outcome = await correct(calendar, {
        playerId,
        eventTypeId: OTHER_TYPE,
        publicDate: day('2024-11-21'),
        description: 'Another description.',
        sources: [typedSource(NEW_LINK, '2024-11-20')],
        researchConfidence: 'low',
        unverifiedNote: 'A note.',
        injuryReturn: 'yes',
      });

      expect(outcome).toStrictEqual({
        ok: false,
        error: {
          kind: 'not_correctable',
          fields: [
            'player',
            'event_type',
            'reference_date',
            'description',
            'sources',
            'research_confidence',
            'unverified_note',
          ],
        },
      });
      await expectUnchanged(calendar);
    });
  });

  describe('deleteHistorical', () => {
    it('[IMP-33] deletes for a closed reason, keeping the date, reason, type and public date, then journals and recalculates', async () => {
      const outcome = await remove(historical, 'duplicate');

      expect(outcome).toStrictEqual({
        ok: true,
        value: { playerId, eventTypeId: MEDIA_STORM, caseId: null },
      });
      await expect(storedEvent(historical.id)).resolves.toBeUndefined();
      const exits = await db
        .select({
          exitedAt: tallyExits.exitedAt,
          deletionReason: tallyExits.deletionReason,
          deletionDetail: tallyExits.deletionDetail,
          eventTypeId: tallyExits.eventTypeId,
          publicDateOn: tallyExits.publicDateOn,
        })
        .from(tallyExits);
      expect(exits).toStrictEqual([
        {
          exitedAt: new Date(AT),
          deletionReason: 'duplicate',
          deletionDetail: null,
          eventTypeId: MEDIA_STORM,
          publicDateOn: '2024-11-20',
        },
      ]);
      expect(await journaled()).toStrictEqual([
        { messageKey: 'historical_event_deleted', playerEventId: null },
      ]);
      expect(await jobs()).toStrictEqual([jobOf(playerId, [MEDIA_STORM])]);
    });

    it('[IMP-33] keeps the short precision of the reason other', async () => {
      await expect(remove(historical, 'other', 'Reported twice.')).resolves.toMatchObject({
        ok: true,
      });

      const [exit] = await db.select().from(tallyExits);
      expect(exit).toMatchObject({ deletionReason: 'other', deletionDetail: 'Reported twice.' });
    });

    it('[IMP-33] [CL-IHM-18] refuses another reason, other without precision, a stale version and an event of another origin, writing nothing', async () => {
      await expect(remove(historical, 'bad_game')).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'invalid_reason' },
      });
      await expect(remove(historical, 'other', '  ')).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'detail_required' },
      });
      await expect(
        remove({ ...historical, rowVersion: historical.rowVersion + 1 }, 'duplicate'),
      ).resolves.toMatchObject({ ok: false, error: { kind: 'changed_elsewhere' } });
      const detected = await insertDetectedEvent(db, { playerId });
      await expect(remove(detected, 'duplicate')).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'not_historical' },
      });
      await expectUnchanged(historical);
      expect(await db.select().from(tallyExits)).toStrictEqual([]);
    });
  });
});
