import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, journalEntries, journalTechnicalDetails } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { record } from './record';

import type { JournalEntryInput } from './record';
import type { Database } from '@/lib/db';

const RECORDED_AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const LOCKED_UNTIL = toEpochMs(Date.UTC(2026, 10, 20, 8, 30));
const PLAYER_ID = '5b0d2f8e-3c41-4f6a-9d7e-2a1c8b9e4f60';
// What an entry names when it names nothing.
const NO_REFERENCE = {
  playerId: null,
  playerEventId: null,
  eventTypeId: null,
  backtestRequestId: null,
  importId: null,
  caseId: null,
  incidentId: null,
  taskRunId: null,
  lot2ObjectKind: null,
  lot2ObjectId: null,
} as const;

describe('record', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(RECORDED_AT));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, 60_000);

  /** Records `entry` in a transaction of its own. */
  async function write(entry: JournalEntryInput): Promise<number> {
    return db.transaction(async (tx) => record(tx, entry));
  }

  it('[TRV-43] stores the category and the level of the message, its parameters, and the instant of the clock', async () => {
    const id = await write({ messageKey: 'login_locked', params: { lockedUntilAt: LOCKED_UNTIL } });

    await expect(db.select().from(journalEntries)).resolves.toStrictEqual([
      {
        id,
        occurredAt: new Date(RECORDED_AT),
        category: 'login_lockout',
        level: 'incident',
        messageKey: 'login_locked',
        messageParams: { lockedUntilAt: LOCKED_UNTIL },
        ...NO_REFERENCE,
      },
    ]);
  });

  it('[TRV-43] [CL-TRV-10] stores an owner action at the info level, naming its player by identifier', async () => {
    await write({ messageKey: 'player_added', playerId: PLAYER_ID });

    await expect(
      db
        .select({
          category: journalEntries.category,
          level: journalEntries.level,
          messageParams: journalEntries.messageParams,
          playerId: journalEntries.playerId,
        })
        .from(journalEntries),
    ).resolves.toStrictEqual([
      { category: 'user_action', level: 'info', messageParams: {}, playerId: PLAYER_ID },
    ]);
  });

  it('[CL-TRV-10] names a Telegram message by its Lot 2 kind and identifier, beside the event it concerns', async () => {
    await write({
      messageKey: 'telegram_message_failed',
      notificationMessageId: 7,
      playerEventId: 21,
      params: { category: 'alerts' },
    });

    await expect(db.select().from(journalEntries)).resolves.toMatchObject([
      {
        category: 'telegram_message',
        level: 'warning',
        ...NO_REFERENCE,
        playerEventId: 21,
        lot2ObjectKind: 'notification_message',
        lot2ObjectId: 7,
      },
    ]);
  });

  it('[CL-TRV-10] lets an entry about an event or a case name neither its player nor its type, and a withdrawal name nothing', () => {
    const aboutAnEvent: JournalEntryInput = {
      messageKey: 'historical_event_corrected',
      playerEventId: 21,
      // @ts-expect-error -- an entry about an event names its player only through the event.
      playerId: PLAYER_ID,
    };
    const aboutACase: JournalEntryInput = {
      messageKey: 'case_excluded',
      caseId: 14,
      // @ts-expect-error -- an entry about a case names its type only through the case.
      eventTypeId: 'media-storm',
    };
    // @ts-expect-error -- a withdrawal is written with no reference to the event (CL-TRV-10).
    const withdrawal: JournalEntryInput = { messageKey: 'event_withdrawn', playerEventId: 21 };

    expect([aboutAnEvent, aboutACase, withdrawal]).toHaveLength(3);
  });

  it('[TRV-44] [DSN-11] keeps the technical details apart: the allowlisted keys only, an error message cut at 300 characters', async () => {
    const answer = {
      service: 'stats_source',
      operation: 'getSeasonGames',
      httpStatus: 503,
      durationMs: 1250,
      errorMessage: `Service Unavailable ${'x'.repeat(400)}`,
      responseBody: '<html>An article title the journal must never hold</html>',
      requestHeaders: { 'user-agent': 'a header the allowlist leaves out' },
    } as const;

    const id = await write({
      messageKey: 'service_call_failed',
      params: { service: 'stats_source' },
      technicalDetails: answer,
    });

    await expect(db.select().from(journalTechnicalDetails)).resolves.toStrictEqual([
      {
        journalEntryId: id,
        details: {
          service: 'stats_source',
          operation: 'getSeasonGames',
          httpStatus: 503,
          durationMs: 1250,
          errorMessage: `Service Unavailable ${'x'.repeat(280)}`,
        },
      },
    ]);
    await expect(
      db.select({ messageParams: journalEntries.messageParams }).from(journalEntries),
    ).resolves.toStrictEqual([{ messageParams: { service: 'stats_source' } }]);
  });

  it('refuses, as a bug, a message key outside the closed list', async () => {
    // @ts-expect-error -- a message outside the closed list does not type-check either.
    const invented: JournalEntryInput = { messageKey: 'something_happened' };

    await expect(write(invented)).rejects.toThrow(
      'No message of the closed list is named something_happened.',
    );
  });
});
