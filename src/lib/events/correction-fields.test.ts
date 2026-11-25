import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, eventCorrections, eventMarks, events, tallyExits } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { applyCorrection } from './corrections';
import { eraseEvent } from './erase';
import { getEvent } from './queries';
import { createDetected, setDetectedStatus } from './status';

import type { EventChanges } from './correction-fields';
import type { NewDetectedEvent } from './status';
import type { EventRow } from './types';
import type { DetectedEvent } from './views';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The corrections of a detected event: the fields that only a detected event has, checked
// here, and the before and after values that its correction history keeps.
const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const REFERENCE_AT = toEpochMs(Date.UTC(2026, 10, 24, 14, 0));
const EARLIER_AT = toEpochMs(Date.UTC(2026, 10, 24, 11, 0));
const LATER_AT = toEpochMs(Date.UTC(2026, 10, 24, 18, 0));
const HOUR_MS = 3_600_000;
const TRADE_RUMOR = 'trade-rumor';
const CONFIDENCE = 82;

/** Instant `at` in ISO 8601, as the correction history keeps a reference instant. */
function isoOf(at: number): string {
  return new Date(at).toISOString();
}

describe('the corrections of a detected event', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let close: () => Promise<void>;
  let restoreClock: () => void;
  let clock: FixedClock;
  let playerId: string;
  let otherPlayerId: string;
  let historical: EventRow;

  beforeAll(async () => {
    const database = await createTestDatabase();
    ({ db, close } = database);
    clock = fixedClock(START);
    restoreClock = installFakeClock(clock);
    await insertEventType(db);
    await insertEventType(db, { id: TRADE_RUMOR, name: 'Trade rumor' });
    ({ id: playerId } = await insertPlayer(db));
    ({ id: otherPlayerId } = await insertPlayer(db, { source: 'p02' }));
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
    historical = await insertHistoricalEvent(db, { playerId, originImportId: imported.id });
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await close();
  });

  /** Creates a detected media storm of the player, classified by the model, and gives it. */
  async function created(overrides: Partial<NewDetectedEvent> = {}): Promise<DetectedEvent> {
    const outcome = await db.transaction(async (tx) =>
      createDetected(tx, {
        playerId,
        eventTypeId: MEDIA_STORM,
        sheetVersionNumber: 1,
        reference: { at: REFERENCE_AT, precision: 'exact', rule: 'earliest_source' },
        description: 'Three national outlets covered the player on the same day.',
        context: {
          injuryReturn: { value: 'yes', origin: 'classification' },
          gameStakes: { value: 'unknown', origin: null },
        },
        detectionConfidence: CONFIDENCE,
        classificationOrigin: 'model',
        ...overrides,
      }),
    );
    if (!outcome.ok) {
      throw new Error('The detected event was refused.');
    }
    return outcome.value;
  }

  /** Corrects `eventId` with `changes`, at the version it now has. */
  async function correct(eventId: number, changes: EventChanges) {
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    return db.transaction(async (tx) =>
      applyCorrection(tx, eventId, { ...changes, expectedVersion: row?.rowVersion ?? 0 }),
    );
  }

  /** The field and the values before and after of each correction of `eventId`. */
  async function correctionValues(eventId: number) {
    const rows = await db
      .select()
      .from(eventCorrections)
      .where(eq(eventCorrections.playerEventId, eventId))
      .orderBy(asc(eventCorrections.id));
    return rows.map((row) => [row.field, row.beforeValue, row.afterValue]);
  }

  it('[DET-47] [DET-52] [CA-DET-27] [CL-DSN-15] corrects the type, player, description and context, keeping values before and after of the structured fields only', async () => {
    const event = await created();
    clock.advance(HOUR_MS);
    const outcome = await correct(event.playerEventId, {
      playerId: otherPlayerId,
      eventTypeId: TRADE_RUMOR,
      description: 'Two outlets reported that the player asked to be traded.',
      injuryReturn: 'no',
      gameStakes: 'high',
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        changed: ['event_type', 'description', 'injury_return', 'game_stakes', 'player'],
        event: {
          playerId: otherPlayerId,
          eventTypeId: TRADE_RUMOR,
          sheetEventTypeId: TRADE_RUMOR,
          sheetVersionNumber: 1,
          caseId: null,
          description: 'Two outlets reported that the player asked to be traded.',
          injuryReturnOrigin: 'user',
          gameStakesOrigin: 'user',
          rowVersion: 2,
        },
      },
    });
    await expect(correctionValues(event.playerEventId)).resolves.toStrictEqual([
      ['event_type', MEDIA_STORM, TRADE_RUMOR],
      ['description', null, null],
      ['injury_return', 'yes', 'no'],
      ['game_stakes', 'unknown', 'high'],
      ['player', playerId, otherPlayerId],
    ]);
  });

  it('[DET-31] [CL-DET-27] [DET-52] moves the reference date earlier with its precision and rule, and later only once its reference article is detached', async () => {
    const event = await created();
    const earlier = await correct(event.playerEventId, {
      reference: { at: EARLIER_AT, precision: 'approximate', rule: 'earliest_source' },
    });
    const later = { at: LATER_AT, precision: 'exact', rule: 'coverage_threshold' } as const;
    const refused = await correct(event.playerEventId, { reference: later });
    const otherDetached = await correct(event.playerEventId, {
      reference: later,
      detachedArticle: 'other_article',
    });
    const referenceDetached = await correct(event.playerEventId, {
      reference: later,
      detachedArticle: 'reference_article',
    });
    const refusal = {
      ok: false,
      error: { kind: 'invalid_fields', fields: { reference: 'later_without_detachment' } },
    };

    expect(earlier).toMatchObject({
      ok: true,
      value: {
        changed: ['reference_date'],
        event: { referenceAt: new Date(EARLIER_AT), referenceDatePrecision: 'approximate' },
      },
    });
    expect([refused, otherDetached]).toStrictEqual([refusal, refusal]);
    expect(referenceDetached).toMatchObject({
      ok: true,
      value: {
        changed: ['reference_date', 'article_detached'],
        event: {
          referenceAt: new Date(LATER_AT),
          referenceDatePrecision: 'exact',
          referenceDateRule: 'coverage_threshold',
        },
      },
    });
    await expect(correctionValues(event.playerEventId)).resolves.toStrictEqual([
      ['reference_date', isoOf(REFERENCE_AT), isoOf(EARLIER_AT)],
      ['reference_date', isoOf(EARLIER_AT), isoOf(LATER_AT)],
      ['article_detached', null, null],
    ]);
  });

  it('[CL-DET-07] [DET-52] changes the detection confidence and classification origin with no entry of their own', async () => {
    const event = await created();
    const toOwner = { detectionConfidence: null, classificationOrigin: 'user' } as const;
    const changed = await correct(event.playerEventId, toOwner);
    const unchanged = await correct(event.playerEventId, toOwner);

    expect(changed).toMatchObject({
      ok: true,
      value: {
        changed: ['detection_confidence', 'classification_origin'],
        event: { detectionConfidence: null, classificationOrigin: 'user', rowVersion: 2 },
      },
    });
    expect(unchanged).toMatchObject({ ok: true, value: { changed: [], event: { rowVersion: 2 } } });
    await expect(correctionValues(event.playerEventId)).resolves.toStrictEqual([]);
  });

  it('[DET-47] refuses to merge an event that is not another detected event of the player', async () => {
    const kept = await created({ eventTypeId: TRADE_RUMOR });
    const ofOtherPlayer = await created({ eventTypeId: TRADE_RUMOR, playerId: otherPlayerId });
    const notMergeable = [
      await correct(kept.playerEventId, { mergedEventId: ofOtherPlayer.playerEventId }),
      await correct(kept.playerEventId, { mergedEventId: kept.playerEventId }),
      await correct(kept.playerEventId, { mergedEventId: historical.id }),
    ];

    expect(notMergeable.map((outcome) => !outcome.ok && outcome.error)).toStrictEqual(
      Array.from({ length: notMergeable.length }, () => ({
        kind: 'invalid_fields',
        fields: { mergedEventId: 'not_a_detected_event_of_the_player' },
      })),
    );
    await expect(correctionValues(kept.playerEventId)).resolves.toStrictEqual([]);
  });

  it('[DET-47] [DET-52] merges another detected event of the player: the kept one traces it, the absorbed one is erased with the tally exit merged', async () => {
    const kept = await created({ eventTypeId: TRADE_RUMOR });
    const absorbed = await created({ eventTypeId: TRADE_RUMOR });
    await db.transaction(async (tx) =>
      setDetectedStatus(tx, absorbed.playerEventId, {
        kind: 'set_mark',
        mark: 'dating_to_verify',
        expectedVersion: 1,
      }),
    );
    const merged = await correct(kept.playerEventId, {
      mergedEventId: absorbed.playerEventId,
      reference: { at: EARLIER_AT, precision: 'exact', rule: 'earliest_source' },
      detectionConfidence: CONFIDENCE + 1,
    });
    const erased = await db.transaction(async (tx) =>
      eraseEvent(tx, absorbed.playerEventId, { kind: 'merged' }),
    );
    const gone = [
      await getEvent(db, absorbed.playerEventId),
      await db.$count(eventMarks, eq(eventMarks.playerEventId, absorbed.playerEventId)),
    ];
    const exits = await db.select().from(tallyExits).where(eq(tallyExits.eventTypeId, TRADE_RUMOR));

    expect(merged).toMatchObject({
      ok: true,
      value: { changed: ['reference_date', 'detection_confidence', 'event_merged_in'] },
    });
    await expect(correctionValues(kept.playerEventId)).resolves.toStrictEqual([
      ['reference_date', isoOf(REFERENCE_AT), isoOf(EARLIER_AT)],
      ['event_merged_in', null, null],
    ]);
    expect(erased).toStrictEqual({
      ok: true,
      value: { playerId, eventTypeId: TRADE_RUMOR, caseId: null },
    });
    expect(gone).toStrictEqual([null, 0]);
    expect(exits).toMatchObject([
      { playerId, eventTypeId: TRADE_RUMOR, exitReason: 'merged', exitedAt: null, importId: null },
    ]);
  });
});
