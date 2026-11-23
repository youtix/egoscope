import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, incidents, journalEntries, journalTechnicalDetails } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertEventType,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';

import { eraseDetailsAbout } from './erase';
import { list } from './read';
import { record } from './record';

import type { ErasedItem } from './erase';
import type { JournalEntryInput } from './record';
import type { Database } from '@/lib/db';

const PARIS = 'Europe/Paris';
// Two invented players of the league, followed.
const PLAYER_ID = leaguePlayerId('p01');
const OTHER_PLAYER_ID = leaguePlayerId('p02');
// Two events of the first player, the first and the second written.
const ERASED_EVENT = 1;
const OTHER_EVENT = 2;
// An alert sheet that holds both events.
const SHEET = 5;
const DETAILS = { service: 'stats_source', httpStatus: 503 } as const;

describe('eraseDetailsAbout', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let incidentId: number;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    await insertPlayer(db);
    await insertPlayer(db, { source: 'p02' });
    await insertDetectedEvent(db, { playerId: PLAYER_ID });
    await insertDetectedEvent(db, { playerId: PLAYER_ID });
    const [incident] = await db
      .insert(incidents)
      .values({ kind: 'stats_source_unavailable' })
      .returning({ id: incidents.id });
    incidentId = incident?.id ?? 0;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  /** Records `entries` in one transaction. */
  async function write(entries: readonly JournalEntryInput[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const entry of entries) {
        await record(tx, entry);
      }
    });
  }

  /** Erases `item` as an erasure's transaction does. */
  async function erase(item: ErasedItem): Promise<void> {
    await db.transaction(async (tx) => eraseDetailsAbout(tx, item));
  }

  /** The texts of the journal, oldest first, and the objects they lead to. */
  async function journal() {
    const page = await list(db, { timeZone: PARIS, pageSize: 10 });
    return page.entries.toReversed().map((entry) => [entry.text, entry.objectRef]);
  }

  /** The references to an event and to a Lot 2 object that the entries hold, oldest first. */
  async function storedReferences() {
    return db
      .select({
        playerEventId: journalEntries.playerEventId,
        lot2ObjectKind: journalEntries.lot2ObjectKind,
        lot2ObjectId: journalEntries.lot2ObjectId,
      })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id));
  }

  it('[CL-TRV-10] [DSN-29] keeps the text of an entry whose event is erased, which loses its event reference and reads "an item that no longer exists"', async () => {
    await write([
      { messageKey: 'calendar_event_derived', playerEventId: ERASED_EVENT },
      { messageKey: 'calendar_event_derived', playerEventId: OTHER_EVENT },
    ]);

    await erase({ playerEventId: ERASED_EVENT });

    await expect(journal()).resolves.toStrictEqual([
      [
        'An item that no longer exists was derived from the calendar. Its case is measured once the game is played and its statistics are in. What to do: nothing.',
        null,
      ],
      [
        'An event was derived from the calendar. Its case is measured once the game is played and its statistics are in. What to do: nothing.',
        { kind: 'event', id: OTHER_EVENT },
      ],
    ]);
    await expect(storedReferences()).resolves.toStrictEqual([
      { playerEventId: null, lot2ObjectKind: null, lot2ObjectId: null },
      { playerEventId: OTHER_EVENT, lot2ObjectKind: null, lot2ObjectId: null },
    ]);
  });

  it('[CL-TRV-10] [DSN-29] empties, with the event, the alert sheet that an entry names beside it, though the sheet keeps other events', async () => {
    await write([
      { messageKey: 'alert_sheet_produced', alertSheetId: SHEET, playerEventId: ERASED_EVENT },
      { messageKey: 'alert_sheet_event_added', alertSheetId: SHEET, playerEventId: OTHER_EVENT },
    ]);

    await erase({ playerEventId: ERASED_EVENT });

    await expect(storedReferences()).resolves.toStrictEqual([
      { playerEventId: null, lot2ObjectKind: null, lot2ObjectId: null },
      { playerEventId: OTHER_EVENT, lot2ObjectKind: 'alert_sheet', lot2ObjectId: SHEET },
    ]);
    await expect(journal()).resolves.toStrictEqual([
      [
        'An item that no longer exists was produced: a profiled player has a new event. It shows his profile for the type of that event. What to do: nothing; you may read it in Alerts.',
        null,
      ],
      [
        'A new event joined an alert sheet. The sheet shows it with its other events. What to do: nothing.',
        { kind: 'alertSheet', id: SHEET },
      ],
    ]);
  });

  it('[CL-TRV-10] empties, with the event, the Telegram message that an entry names beside it', async () => {
    await write([
      {
        messageKey: 'telegram_message_sent',
        notificationMessageId: 7,
        playerEventId: ERASED_EVENT,
        params: { category: 'alerts' },
      },
      {
        messageKey: 'telegram_message_sent',
        notificationMessageId: 8,
        params: { category: 'alerts' },
      },
    ]);

    await erase({ playerEventId: ERASED_EVENT });

    await expect(storedReferences()).resolves.toStrictEqual([
      { playerEventId: null, lot2ObjectKind: null, lot2ObjectId: null },
      { playerEventId: null, lot2ObjectKind: 'notification_message', lot2ObjectId: 8 },
    ]);
  });

  it('[CL-TRV-10] leaves every entry and its technical details as they are when none names the erased item', async () => {
    await write([
      { messageKey: 'player_paused', playerId: OTHER_PLAYER_ID, technicalDetails: DETAILS },
    ]);

    await erase({ playerId: PLAYER_ID });

    await expect(journal()).resolves.toStrictEqual([
      [
        'You paused a followed player. His profiles stay, and his cases waiting for their game are still measured. What to do: nothing.',
        { kind: 'player', id: OTHER_PLAYER_ID },
      ],
    ]);
    await expect(db.$count(journalTechnicalDetails)).resolves.toBe(1);
  });

  it('[CL-TRV-10] [TRV-44] deletes the technical details of the entries that concerned only the erased item, and keeps the others', async () => {
    await write([
      {
        messageKey: 'calendar_event_derived',
        playerEventId: ERASED_EVENT,
        technicalDetails: DETAILS,
      },
      {
        messageKey: 'calendar_event_derived',
        playerEventId: ERASED_EVENT,
        incidentId,
        technicalDetails: DETAILS,
      },
      {
        messageKey: 'calendar_event_derived',
        playerEventId: OTHER_EVENT,
        technicalDetails: DETAILS,
      },
    ]);

    await erase({ playerEventId: ERASED_EVENT });

    await expect(
      db
        .select({ journalEntryId: journalTechnicalDetails.journalEntryId })
        .from(journalTechnicalDetails)
        .orderBy(asc(journalTechnicalDetails.journalEntryId)),
    ).resolves.toStrictEqual([{ journalEntryId: 2 }, { journalEntryId: 3 }]);
  });

  it('[CL-TRV-10] removes a deleted player from every entry, which then reads "a deleted player"', async () => {
    await write([
      { messageKey: 'player_paused', playerId: PLAYER_ID, technicalDetails: DETAILS },
      { messageKey: 'player_paused', playerId: OTHER_PLAYER_ID },
    ]);

    await erase({ playerId: PLAYER_ID });

    await expect(journal()).resolves.toStrictEqual([
      [
        'You paused a deleted player. His profiles stay, and his cases waiting for their game are still measured. What to do: nothing.',
        null,
      ],
      [
        'You paused a followed player. His profiles stay, and his cases waiting for their game are still measured. What to do: nothing.',
        { kind: 'player', id: OTHER_PLAYER_ID },
      ],
    ]);
    await expect(db.$count(journalTechnicalDetails)).resolves.toBe(0);
  });

  it('[CL-TRV-10] removes an erased Lot 2 object, and only that one', async () => {
    await write([
      { messageKey: 'press_source_withdrawn', pressSourceId: 3 },
      { messageKey: 'article_rescued', articleId: 3 },
      { messageKey: 'press_source_withdrawn', pressSourceId: 4 },
    ]);

    await erase({ lot2Object: { kind: 'press_source', id: 3 } });

    await expect(journal()).resolves.toStrictEqual([
      [
        'You withdrew an item that no longer exists. It is no longer read, and the articles already collected stay. What to do: nothing.',
        null,
      ],
      [
        'You rescued an article from the articles found not relevant. It is classified again. What to do: nothing.',
        { kind: 'article', id: 3 },
      ],
      [
        'You withdrew a press source. It is no longer read, and the articles already collected stay. What to do: nothing.',
        { kind: 'pressSource', id: 4 },
      ],
    ]);
  });
});
