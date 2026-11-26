import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, eventSources } from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertDetectedEvent,
  insertEventType,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { createCalendarDerived, createHistorical } from './create';
import { eventsOfPlayer, getEvent } from './queries';
import { setDetectedStatus } from './status';

import type { NewHistoricalEvent } from './create';
import type { ContextIndication } from './views';
import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
// A source the owner gave as a date alone is timed at the end of that day at UTC−12, with
// no offset (CL-DET-26); one given with its time and zone keeps the zone's offset.
const DATE_ONLY_AT = toEpochMs(Date.UTC(2026, 10, 24, 11, 59, 59, 999));
const ZONED_AT = toEpochMs(Date.UTC(2026, 10, 24, 20, 30));
const NEW_YORK_OFFSET = -300;

/** A historical media storm of `playerId` described by `description`, with one source named after it. */
function historical(playerId: string, description: string): NewHistoricalEvent {
  return {
    playerId,
    eventTypeId: MEDIA_STORM,
    sheetEventTypeId: MEDIA_STORM,
    sheetVersionNumber: 1,
    referenceDate: { on: toIsoDate('2024-11-20'), at: null },
    description,
    context: {
      injuryReturn: { value: 'unknown', origin: null },
      gameStakes: { value: 'unknown', origin: null },
    },
    researchConfidence: 'low',
    unverifiedNote: null,
    precedence: 'to_verify',
    sources: [
      {
        url: `https://news.example.test/${description}`,
        cleanedUrl: `https://news.example.test/${description}`,
        outlet: null,
        title: null,
        publicationDate: { on: toIsoDate('2024-11-20'), at: null },
      },
    ],
    warnings: [{ kind: 'context_defaulted' }],
  };
}

describe('the reads of events', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let close: () => Promise<void>;
  let restoreClock: () => void;
  let first: string;
  let second: string;
  let importId: number;
  let gameId: number;

  beforeAll(async () => {
    const database = await createTestDatabase();
    ({ db, close } = database);
    restoreClock = installFakeClock(fixedClock(START));
    ({ id: first } = await insertPlayer(db));
    ({ id: second } = await insertPlayer(db, { source: 'p02' }));
    await insertEventType(db);
    await insertCalendarType(db);
    const request = await insertRequest(db, { playerId: first });
    ({ id: importId } = await insertImport(db, { request }));
    const season = await insertLeagueSeason(db, '2024-25');
    [gameId = 0] = season.values();
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await close();
  });

  it('[DSN-06] gives no event for an identifier that names none', async () => {
    expect(await getEvent(db, 0)).toBeNull();
  });

  it('[DSN-06] gives the events of a player, in the order recorded, each with what its origin holds', async () => {
    const saved = await db.transaction(async (tx) =>
      createHistorical(tx, {
        importId,
        events: [historical(first, 'storm-one'), historical(second, 'storm-other')],
      }),
    );
    const derived = await db.transaction(async (tx) =>
      createCalendarDerived(tx, {
        playerId: first,
        eventTypeId: BIRTHDAY,
        sheetVersionNumber: 1,
        derivedGameId: gameId,
        description: { template: 'birthday', player: 'The player' },
      }),
    );
    const [mine, theirs] = saved.ok ? saved.value : [];
    const playerEvents = await eventsOfPlayer(db, first);
    const otherEvents = await eventsOfPlayer(db, second);

    expect(playerEvents.map(({ playerEventId, origin }) => [playerEventId, origin])).toStrictEqual([
      [mine?.playerEventId, 'historical'],
      [derived.ok ? derived.value.playerEvent.playerEventId : null, 'calendar'],
    ]);
    expect(playerEvents[0]).toMatchObject({
      sources: [{ sourceId: mine?.sourceIds[0], url: 'https://news.example.test/storm-one' }],
      importWarnings: [{ kind: 'context_defaulted' }],
    });
    expect(otherEvents).toMatchObject([
      {
        playerEventId: theirs?.playerEventId,
        description: 'storm-other',
        sources: [{ sourceId: theirs?.sourceIds[0] }],
      },
    ]);
  });

  it('[DSN-06] [DET-44] [DET-48] [CL-DET-26] gives a dismissed detected event with its reason, its marks, its status changes and the sources the owner added, timed with or without a zone', async () => {
    const detected = await insertDetectedEvent(db, { playerId: second });
    const ownerSources = [
      { on: '2026-11-23', at: DATE_ONLY_AT, offsetMinutes: null, precision: 'approximate' },
      { on: '2026-11-24', at: ZONED_AT, offsetMinutes: NEW_YORK_OFFSET, precision: 'exact' },
    ] as const;
    await db.insert(eventSources).values(
      ownerSources.map(({ on, at, offsetMinutes, precision }, index) => ({
        playerEventId: detected.id,
        position: index + 1,
        url: `https://daily.example.test/${on}`,
        cleanedUrl: `https://daily.example.test/${on}`,
        outlet: 'Daily',
        title: null,
        publicationDateOn: on,
        publicationAt: new Date(at),
        publicationOffsetMinutes: offsetMinutes,
        publicationPrecision: precision,
      })),
    );
    await db.transaction(async (tx) =>
      setDetectedStatus(tx, detected.id, {
        kind: 'dismiss',
        dismissal: { reason: 'old_fact' },
        expectedVersion: 1,
      }),
    );
    await db.transaction(async (tx) =>
      setDetectedStatus(tx, detected.id, {
        kind: 'set_mark',
        mark: 'description_to_review',
        expectedVersion: 2,
      }),
    );
    const otherEvents = await eventsOfPlayer(db, second);

    expect(await getEvent(db, detected.id)).toMatchObject({
      origin: 'detected',
      detectedStatus: 'dismissed',
      dismissal: { reason: 'old_fact', comment: null, at: START },
      marks: [{ mark: 'description_to_review', status: 'set', setAt: START, liftedAt: null }],
      statusChanges: [{ changedAt: START, toStatus: 'dismissed', dismissalReason: 'old_fact' }],
      sources: [
        {
          position: 1,
          publicationDate: { on: '2026-11-23', at: DATE_ONLY_AT, offsetMinutes: null },
          publicationPrecision: 'approximate',
        },
        {
          position: 2,
          publicationDate: { on: '2026-11-24', at: ZONED_AT, offsetMinutes: NEW_YORK_OFFSET },
          publicationPrecision: 'exact',
        },
      ],
    });
    expect(otherEvents.map(({ origin }) => origin)).toStrictEqual(['historical', 'detected']);
  });

  it('[DSN-07] [H-09] types a known context indication with its origin, as the row checks hold it', () => {
    type Indicated = 'yes' | 'no' | 'unknown';
    // @ts-expect-error -- a known value always comes with its origin.
    const originless: ContextIndication<Indicated> = { value: 'yes', origin: null };
    const known: ContextIndication<Indicated> = { value: 'yes', origin: 'user' };
    const unknown: ContextIndication<Indicated> = { value: 'unknown', origin: null };

    expect([originless, known, unknown].map(({ origin }) => origin)).toStrictEqual([
      null,
      'user',
      null,
    ]);
  });
});
