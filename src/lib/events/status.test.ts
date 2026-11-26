import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, eventMarks, events, eventStatusChanges } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { getEvent } from './queries';
import { createDetected, setDetectedStatus } from './status';

import type { DetectedStatusChange, NewDetectedEvent } from './status';
import type { EventRow } from './types';
import type { DetectedEvent } from './views';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const REFERENCE_AT = toEpochMs(Date.UTC(2026, 10, 24, 14, 0));
const LATER_AT = toEpochMs(Date.UTC(2026, 10, 24, 18, 0));
const HOUR_MS = 3_600_000;
// The default of `events.maxDescriptionLength`.
const MAX_LENGTH = 200;
const DESCRIPTION = 'Three national outlets covered the player on the same day after his comments.';
const CONFIDENCE = 82;

describe('the detected events', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let close: () => Promise<void>;
  let restoreClock: () => void;
  let clock: FixedClock;
  let playerId: string;
  let historical: EventRow;

  beforeAll(async () => {
    const database = await createTestDatabase();
    ({ db, close } = database);
    clock = fixedClock(START);
    restoreClock = installFakeClock(clock);
    await insertEventType(db);
    ({ id: playerId } = await insertPlayer(db));
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
    historical = await insertHistoricalEvent(db, { playerId, originImportId: imported.id });
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await close();
  });

  /** A detected media storm of the player, classified by the model, dated by its earliest article. */
  function detected(overrides: Partial<NewDetectedEvent> = {}): NewDetectedEvent {
    return {
      playerId,
      eventTypeId: MEDIA_STORM,
      sheetVersionNumber: 1,
      reference: { at: REFERENCE_AT, precision: 'exact', rule: 'earliest_source' },
      description: DESCRIPTION,
      context: {
        injuryReturn: { value: 'yes', origin: 'classification' },
        gameStakes: { value: 'unknown', origin: null },
      },
      detectionConfidence: CONFIDENCE,
      classificationOrigin: 'model',
      ...overrides,
    };
  }

  async function create(event: NewDetectedEvent) {
    return db.transaction(async (tx) => createDetected(tx, event));
  }

  /** Creates a detected event that must be accepted, and gives it. */
  async function created(overrides: Partial<NewDetectedEvent> = {}): Promise<DetectedEvent> {
    const outcome = await create(detected(overrides));
    if (!outcome.ok) {
      throw new Error('The detected event was refused.');
    }
    return outcome.value;
  }

  async function change(eventId: number, statusChange: DetectedStatusChange) {
    return db.transaction(async (tx) => setDetectedStatus(tx, eventId, statusChange));
  }

  it('[DSN-06] [DET-30] [CL-DET-07] [CL-DET-27] stores a detected event with exactly its DSN-06 items and the status detected', async () => {
    const outcome = await create(detected());
    const owners = await created({
      reference: { at: LATER_AT, precision: 'approximate', rule: 'coverage_threshold' },
      context: {
        injuryReturn: { value: 'unknown', origin: null },
        gameStakes: { value: 'unknown', origin: null },
      },
      detectionConfidence: null,
      classificationOrigin: 'user',
    });
    const playerEventId = outcome.ok ? outcome.value.playerEventId : 0;
    const expected: DetectedEvent = {
      playerEventId,
      origin: 'detected',
      playerId,
      eventTypeId: MEDIA_STORM,
      sheetEventTypeId: MEDIA_STORM,
      sheetVersionNumber: 1,
      typeLinkMark: null,
      referenceDate: { at: REFERENCE_AT, precision: 'exact', rule: 'earliest_source' },
      description: DESCRIPTION,
      context: {
        injuryReturn: { value: 'yes', origin: 'classification' },
        gameStakes: { value: 'unknown', origin: null },
      },
      detectedStatus: 'detected',
      dismissal: null,
      detectionConfidence: CONFIDENCE,
      classificationOrigin: 'model',
      caseId: null,
      createdAt: START,
      updatedAt: START,
      rowVersion: 1,
      marks: [],
      statusChanges: [],
      sources: [],
    };

    expect(outcome).toStrictEqual({ ok: true, value: expected });
    expect(await getEvent(db, playerEventId)).toStrictEqual(expected);
    expect(await getEvent(db, owners.playerEventId)).toMatchObject({
      referenceDate: { at: LATER_AT, precision: 'approximate', rule: 'coverage_threshold' },
      detectionConfidence: null,
      classificationOrigin: 'user',
    });
  });

  it('[DSN-20] [DSN-21] [CL-DSN-03] refuses a description too long or holding a quotation mark, writing nothing', async () => {
    const before = await db.$count(events, eq(events.origin, 'detected'));
    const tooLong = await create(detected({ description: 'd'.repeat(MAX_LENGTH + 1) }));
    const quoted = await create(
      detected({ description: 'The coach called him “a liability” after the game.' }),
    );

    expect(tooLong).toStrictEqual({
      ok: false,
      error: {
        kind: 'text_refused',
        field: 'description',
        breaches: [{ kind: 'too_long', length: MAX_LENGTH + 1, maxLength: MAX_LENGTH }],
      },
    });
    expect(quoted).toStrictEqual({
      ok: false,
      error: {
        kind: 'text_refused',
        field: 'description',
        breaches: [{ kind: 'quotation_mark', character: '“' }],
      },
    });
    expect(await db.$count(events, eq(events.origin, 'detected'))).toBe(before);
  });

  it('[DET-43] [DET-44] [DET-45] [DET-46] [DET-52] dismisses and reinstates, writing each change with its instant and reason, the dismissed event kept with its reason', async () => {
    const event = await created();
    clock.advance(HOUR_MS);
    const dismissedAt = now();
    const dismissed = await change(event.playerEventId, {
      kind: 'dismiss',
      dismissal: { reason: 'not_an_event' },
      expectedVersion: 1,
    });
    const whileDismissed = await getEvent(db, event.playerEventId);
    clock.advance(HOUR_MS);
    const reinstatedAt = now();
    const reinstated = await change(event.playerEventId, { kind: 'reinstate', expectedVersion: 2 });

    expect(dismissed).toMatchObject({
      ok: true,
      value: {
        changed: true,
        event: {
          detectedStatus: 'dismissed',
          dismissalReason: 'not_an_event',
          dismissalComment: null,
          dismissedAt: new Date(dismissedAt),
          updatedAt: new Date(dismissedAt),
          rowVersion: 2,
        },
      },
    });
    expect(whileDismissed).toMatchObject({
      detectedStatus: 'dismissed',
      dismissal: { reason: 'not_an_event', comment: null, at: dismissedAt },
    });
    expect(reinstated).toMatchObject({
      ok: true,
      value: {
        changed: true,
        event: {
          detectedStatus: 'detected',
          dismissalReason: null,
          dismissedAt: null,
          rowVersion: 3,
        },
      },
    });
    expect(await getEvent(db, event.playerEventId)).toMatchObject({
      detectedStatus: 'detected',
      dismissal: null,
      updatedAt: reinstatedAt,
      statusChanges: [
        {
          changedAt: dismissedAt,
          toStatus: 'dismissed',
          dismissalReason: 'not_an_event',
          dismissalComment: null,
        },
        {
          changedAt: reinstatedAt,
          toStatus: 'detected',
          dismissalReason: null,
          dismissalComment: null,
        },
      ],
    });
  });

  it('[DET-43] [DSN-10] [DSN-20] [DSN-21] requires for the reason other a comment under the wording rules, kept trimmed', async () => {
    const event = await created();
    const dismissWith = async (comment: string) =>
      change(event.playerEventId, {
        kind: 'dismiss',
        dismissal: { reason: 'other', comment },
        expectedVersion: 1,
      });

    await expect(dismissWith(' \t\n')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid_comment', problem: 'required' },
    });
    await expect(dismissWith('A satire site, "reporting" nothing.')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid_comment', problem: [{ kind: 'quotation_mark', character: '"' }] },
    });
    await expect(dismissWith('c'.repeat(MAX_LENGTH + 1))).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_comment',
        problem: [{ kind: 'too_long', length: MAX_LENGTH + 1, maxLength: MAX_LENGTH }],
      },
    });
    await expect(dismissWith('  The article is a satire piece.  ')).resolves.toMatchObject({
      ok: true,
      value: {
        event: { dismissalReason: 'other', dismissalComment: 'The article is a satire piece.' },
      },
    });
    await expect(getEvent(db, event.playerEventId)).resolves.toMatchObject({
      dismissal: { reason: 'other', comment: 'The article is a satire piece.' },
      statusChanges: [
        { dismissalReason: 'other', dismissalComment: 'The article is a satire piece.' },
      ],
    });
  });

  it('[DET-43] [DET-45] refuses a dismissal of a dismissed event, a reinstatement of a detected one, and any change of another origin', async () => {
    const event = await created();
    const dismissal = { kind: 'dismiss', dismissal: { reason: 'old_fact' } } as const;

    await expect(
      change(event.playerEventId, { kind: 'reinstate', expectedVersion: 1 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'status_unchanged', detectedStatus: 'detected' },
    });
    await change(event.playerEventId, { ...dismissal, expectedVersion: 1 });
    await expect(
      change(event.playerEventId, { ...dismissal, expectedVersion: 2 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'status_unchanged', detectedStatus: 'dismissed' },
    });
    await expect(
      change(historical.id, { ...dismissal, expectedVersion: historical.rowVersion }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'not_detected' } });
    expect(
      await db.$count(
        eventStatusChanges,
        eq(eventStatusChanges.playerEventId, event.playerEventId),
      ),
    ).toBe(1);
  });

  it('[CL-IHM-18] [CL-IHM-19] refuses a change sent with an older version, and a change of an event that no longer exists', async () => {
    const event = await created();
    const lift = { kind: 'lift_mark', mark: 'dating_to_verify' } as const;

    await expect(
      change(event.playerEventId, { ...lift, expectedVersion: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'changed_elsewhere', current: { id: event.playerEventId, rowVersion: 1 } },
    });
    await expect(change(0, { ...lift, expectedVersion: 1 })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no_longer_exists' },
    });
  });

  it('[DET-21] [DET-32] [DET-58] [CL-DET-06] sets each mark once and lifts it with its instants: a lifted dating to verify is never set again', async () => {
    const event = await created();
    const markedAt = now();
    const set = async (mark: 'dating_to_verify' | 'description_to_review', version: number) =>
      change(event.playerEventId, { kind: 'set_mark', mark, expectedVersion: version });

    const first = await set('dating_to_verify', 1);
    await set('description_to_review', 2);
    const again = await set('dating_to_verify', 3);
    clock.advance(HOUR_MS);
    const liftedAt = now();
    const lifted = await change(event.playerEventId, {
      kind: 'lift_mark',
      mark: 'dating_to_verify',
      expectedVersion: 3,
    });
    clock.advance(HOUR_MS);
    const markedAfterLift = await set('dating_to_verify', 4);

    expect(first).toMatchObject({ ok: true, value: { changed: true, event: { rowVersion: 2 } } });
    expect(again).toMatchObject({ ok: true, value: { changed: false, event: { rowVersion: 3 } } });
    expect(lifted).toMatchObject({
      ok: true,
      value: { changed: true, event: { rowVersion: 4, updatedAt: new Date(liftedAt) } },
    });
    expect(markedAfterLift).toMatchObject({
      ok: true,
      value: { changed: false, event: { rowVersion: 4 } },
    });
    expect(await getEvent(db, event.playerEventId)).toMatchObject({
      marks: [
        { mark: 'dating_to_verify', status: 'lifted', setAt: markedAt, liftedAt },
        { mark: 'description_to_review', status: 'set', setAt: markedAt, liftedAt: null },
      ],
    });
  });

  it('[CL-DET-10] [DET-52] lifts a possible duplicate of a historical event when the owner states it is not the same fact, nothing being erased', async () => {
    const event = await created();
    await change(event.playerEventId, {
      kind: 'set_mark',
      mark: 'possible_historical_duplicate',
      expectedVersion: 1,
    });
    clock.advance(HOUR_MS);
    const liftedAt = now();
    const notTheSameFact = { kind: 'lift_mark', mark: 'possible_historical_duplicate' } as const;
    const lifted = await change(event.playerEventId, { ...notTheSameFact, expectedVersion: 2 });
    const liftedAgain = await change(event.playerEventId, {
      ...notTheSameFact,
      expectedVersion: 3,
    });
    const neverSet = await change(event.playerEventId, {
      kind: 'lift_mark',
      mark: 'description_to_review',
      expectedVersion: 3,
    });
    const rows = await db
      .select()
      .from(eventMarks)
      .where(eq(eventMarks.playerEventId, event.playerEventId));

    expect(
      [lifted, liftedAgain, neverSet].map((outcome) => outcome.ok && outcome.value.changed),
    ).toStrictEqual([true, false, false]);
    expect(rows).toMatchObject([
      { mark: 'possible_historical_duplicate', status: 'lifted', resolvedAt: new Date(liftedAt) },
    ]);
  });
});
