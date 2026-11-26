import { eq } from 'drizzle-orm';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, eventSources, importEventOutcomes, imports } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { eventTrace, history, remainingRefusals, remainingRefusalSum } from './queries';

import type { NewImportEventOutcomeRow, NewImportRow } from './types';
import type { Database } from '@/lib/db';
import type { NewEventSourceRow } from '@/lib/events';
import type { ImportRow, RequestRow } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const DAY = 86_400_000;
const PLAYER = leaguePlayerId('p01');
const OTHER_PLAYER = leaguePlayerId('p02');

/**
 * Notes in `statements`, in order, the text and parameters of every statement that `db`
 * sends from now on, as the query logger of its session receives them.
 */
function recordStatements(db: Database, statements: string[]): void {
  Object.assign(db._.session, {
    logger: {
      logQuery: (query: string, params: readonly unknown[]) => {
        statements.push(`${query} ${JSON.stringify(params)}`);
      },
    },
  });
}

/** An outcome row of an import, without the import it belongs to. */
type Outcome = Omit<NewImportEventOutcomeRow, 'importId'>;

/** `count` outcome rows of an event added, added with a warning or a duplicate. */
function recorded(
  outcome: 'added' | 'added_with_warning' | 'duplicate_not_added',
  count: number,
): Outcome[] {
  return Array.from({ length: count }, () => ({ outcome }));
}

/** An event refused at `position`, its type and date unreadable unless given. */
function refused(position: number, overrides: Partial<Outcome> = {}): Outcome {
  return { outcome: 'refused', position, reason: 'type_missing', ...overrides };
}

/** An event ignored at `position` as outside the requested period. */
function ignored(position: number): Outcome {
  return { outcome: 'ignored', position, reason: 'outside_requested_period' };
}

/** `count` events set aside by `aside`, at the ranks that follow `after`. */
function ranked(aside: (position: number) => Outcome, after: number, count: number): Outcome[] {
  return Array.from({ length: count }, (_, index) => aside(after + index + 1));
}

describe('the import traces read API', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    await insertEventType(db);
    await insertPlayer(db);
    await insertPlayer(db, { source: 'p02' });
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** A new request of the player. */
  async function request(playerId = PLAYER): Promise<RequestRow> {
    return insertRequest(db, { playerId });
  }

  /** Saves an import into `into`, at `at` and with the columns given, and its outcome rows. */
  async function saveImport(
    into: RequestRow,
    outcomes: readonly Outcome[] = [],
    {
      at = START,
      ...columns
    }: Partial<Pick<NewImportRow, 'mode' | 'truncationRecovered' | 'deletedByReplacementCount'>> &
      Readonly<{ at?: number }> = {},
  ): Promise<ImportRow> {
    const saved = await insertImport(db, { request: into });
    const [updated] = await db
      .update(imports)
      .set({ importedAt: new Date(at), ...columns })
      .where(eq(imports.id, saved.id))
      .returning();
    if (outcomes.length > 0) {
      await db
        .insert(importEventOutcomes)
        .values(outcomes.map((outcome) => ({ ...outcome, importId: saved.id })));
    }
    return updated ?? saved;
  }

  /** Writes a source of an event at `position`, added by `addedByImportId`. */
  async function source(
    playerEventId: number,
    position: number,
    columns: Partial<NewEventSourceRow> = {},
  ) {
    const url = `https://news.example.com/story-${String(playerEventId)}-${String(position)}`;
    const [written] = await db
      .insert(eventSources)
      .values({
        playerEventId,
        position,
        url,
        cleanedUrl: url,
        publicationDateOn: '2024-11-20',
        ...columns,
      })
      .returning();
    return written;
  }

  describe('history', () => {
    it('[IMP-31] lists the saved imports newest first with number, date, reference, mode and the tally of their outcome rows', async () => {
      const first = await saveImport(await request(), [
        ...recorded('added', 10),
        ...recorded('added_with_warning', 2),
        ...recorded('duplicate_not_added', 3),
        refused(7),
      ]);
      const existing = await insertHistoricalEvent(db, {
        playerId: PLAYER,
        originImportId: first.id,
      });
      await source(existing.id, 1, { addedByImportId: first.id });
      const replacement = await saveImport(
        await request(),
        [...recorded('added', 1), ...recorded('duplicate_not_added', 1), ignored(3)],
        { at: START + DAY, mode: 'replacement', deletedByReplacementCount: 4 },
      );
      const brought = await insertHistoricalEvent(db, {
        playerId: PLAYER,
        originImportId: replacement.id,
      });
      await source(existing.id, 2, { addedByImportId: replacement.id });
      await source(existing.id, 3, { addedByImportId: replacement.id });
      await source(brought.id, 1, { addedByImportId: replacement.id });
      await saveImport(await request(OTHER_PLAYER), recorded('added', 5));

      await expect(history(db, PLAYER)).resolves.toStrictEqual([
        {
          importId: replacement.id,
          sequenceNumber: 2,
          importedAt: START + DAY,
          backtestRequestId: replacement.backtestRequestId,
          requestReference: 'REQ-2026-0002',
          mode: 'replacement',
          tally: {
            added: 1,
            addedWithWarning: 0,
            duplicatesNotAdded: 1,
            sourcesAttached: 2,
            ignored: 1,
            refused: 0,
            deletedByReplacement: 4,
          },
          truncationRecovered: false,
          recoveredEventCount: null,
        },
        {
          importId: first.id,
          sequenceNumber: 1,
          importedAt: START,
          backtestRequestId: first.backtestRequestId,
          requestReference: 'REQ-2026-0001',
          mode: 'first_import',
          tally: {
            added: 12,
            addedWithWarning: 2,
            duplicatesNotAdded: 3,
            sourcesAttached: 0,
            ignored: 0,
            refused: 1,
            deletedByReplacement: 0,
          },
          truncationRecovered: false,
          recoveredEventCount: null,
        },
      ]);
    });

    it('[IMP-31] orders two imports of one instant by their number, and gives an import with no outcome row a zero tally', async () => {
      const into = await request();
      const earlier = await saveImport(into, recorded('added', 1), { at: START - DAY });
      const first = await saveImport(into, [], { mode: 'addition' });
      const second = await saveImport(into, [], { mode: 'addition' });

      const listed = await history(db, PLAYER);

      expect(listed.map((entry) => entry.importId)).toStrictEqual([
        second.id,
        first.id,
        earlier.id,
      ]);
      expect(listed[0]?.tally).toStrictEqual({
        added: 0,
        addedWithWarning: 0,
        duplicatesNotAdded: 0,
        sourcesAttached: 0,
        ignored: 0,
        refused: 0,
        deletedByReplacement: 0,
      });
    });

    it('[IMP-31] [CL-IMP-33] lists nothing for a player whose only attempt was refused in full, which saved no import', async () => {
      await request();

      await expect(history(db, PLAYER)).resolves.toStrictEqual([]);
    });

    it('[CL-IMP-18] gives a recovered import the number of its outcome rows as the events recovered', async () => {
      await saveImport(
        await request(),
        [...recorded('added', 2), ...recorded('added_with_warning', 1), refused(4)],
        { truncationRecovered: true },
      );

      await expect(history(db, PLAYER)).resolves.toMatchObject([
        { truncationRecovered: true, recoveredEventCount: 4 },
      ]);
    });

    it('[IMP-31] derives each count of the tally from as many outcome rows', async () => {
      const counts = fc.record({
        added: fc.nat({ max: 4 }),
        addedWithWarning: fc.nat({ max: 4 }),
        duplicatesNotAdded: fc.nat({ max: 4 }),
        ignored: fc.nat({ max: 4 }),
        refused: fc.nat({ max: 4 }),
      });
      await fc.assert(
        fc.asyncProperty(counts, async (drawn) => {
          const saved = await saveImport(
            await request(),
            [
              ...recorded('added', drawn.added),
              ...recorded('added_with_warning', drawn.addedWithWarning),
              ...recorded('duplicate_not_added', drawn.duplicatesNotAdded),
              ...ranked(ignored, 0, drawn.ignored),
              ...ranked(refused, drawn.ignored, drawn.refused),
            ],
            { truncationRecovered: true },
          );

          // The import saved last comes first among imports of one instant.
          const [entry] = await history(db, PLAYER);

          expect(entry?.importId).toBe(saved.id);
          expect(entry?.tally).toStrictEqual({
            added: drawn.added + drawn.addedWithWarning,
            addedWithWarning: drawn.addedWithWarning,
            duplicatesNotAdded: drawn.duplicatesNotAdded,
            sourcesAttached: 0,
            ignored: drawn.ignored,
            refused: drawn.refused,
            deletedByReplacement: 0,
          });
          expect(entry?.recoveredEventCount).toBe(
            drawn.added +
              drawn.addedWithWarning +
              drawn.duplicatesNotAdded +
              drawn.ignored +
              drawn.refused,
          );
        }),
        { numRuns: 12 },
      );
    });
  });

  describe('remaining refusals', () => {
    it('[IMP-24] [CL-IMP-24] gives the refused events of the request’s last import by rank, with their type, date and reason as read', async () => {
      const into = await request();
      await saveImport(into, [
        refused(5, { reason: 'public_date_missing' }),
        ignored(3),
        ...recorded('added', 1),
        refused(2, {
          eventTypeAsRead: 'media-storm',
          dateAsRead: '2024-11-31',
          reason: 'public_date_nonexistent',
        }),
      ]);

      await expect(remainingRefusals(db, into.id)).resolves.toStrictEqual([
        {
          position: 2,
          eventTypeAsRead: 'media-storm',
          dateAsRead: '2024-11-31',
          reason: 'public_date_nonexistent',
        },
        { position: 5, eventTypeAsRead: null, dateAsRead: null, reason: 'public_date_missing' },
      ]);
    });

    it('[CL-IMP-24] replaces them by those of a later import into the same request, never by an import into another one', async () => {
      const into = await request();
      await saveImport(into, [refused(1), refused(2)]);
      const other = await request();
      await saveImport(other, [refused(1, { reason: 'no_valid_source' })], { at: START + DAY });

      await expect(remainingRefusals(db, into.id)).resolves.toHaveLength(2);

      await saveImport(into, [refused(4, { reason: 'description_missing' })], {
        at: START + 2 * DAY,
        mode: 'addition',
      });

      await expect(remainingRefusals(db, into.id)).resolves.toStrictEqual([
        { position: 4, eventTypeAsRead: null, dateAsRead: null, reason: 'description_missing' },
      ]);

      await saveImport(into, recorded('added', 1), { at: START + 3 * DAY, mode: 'addition' });

      await expect(remainingRefusals(db, into.id)).resolves.toStrictEqual([]);
      await expect(remainingRefusals(db, other.id)).resolves.toStrictEqual([
        { position: 1, eventTypeAsRead: null, dateAsRead: null, reason: 'no_valid_source' },
      ]);
    });

    it('[IMP-24] gives none for a request never imported', async () => {
      const into = await request();

      await expect(remainingRefusals(db, into.id)).resolves.toStrictEqual([]);
    });

    it('[CL-SEN-22] [CL-IMP-24] adds up the remaining refusals of every request of the player, and his alone', async () => {
      await expect(remainingRefusalSum(db, PLAYER)).resolves.toBe(0);

      const into = await request();
      await saveImport(into, [refused(1), refused(2), refused(3)]);
      await saveImport(into, [refused(1)], { at: START + DAY, mode: 'addition' });
      await saveImport(await request(), [refused(1), refused(2), ignored(3)]);
      await saveImport(await request(OTHER_PLAYER), [refused(1)]);

      await expect(remainingRefusalSum(db, PLAYER)).resolves.toBe(3);
      await expect(remainingRefusalSum(db, OTHER_PLAYER)).resolves.toBe(1);
    });

    it('[IMP-24] [CL-IMP-24] selects the refused rows with a rank, the condition of the partial index on ranks', async () => {
      const into = await request();
      const statements: string[] = [];
      recordStatements(db, statements);

      await remainingRefusals(db, into.id);
      await remainingRefusalSum(db, PLAYER);

      expect(statements).toStrictEqual([
        `select "position", "event_type_as_read", "date_as_read", "reason" from "import_event_outcomes" where ("import_event_outcomes"."import_id" in (select "id" from "imports" where "imports"."backtest_request_id" = $1 order by "imports"."imported_at" desc, "imports"."sequence_number" desc limit $2) and "import_event_outcomes"."outcome" = $3 and "import_event_outcomes"."position" is not null) order by "import_event_outcomes"."position" asc [${String(into.id)},1,"refused"]`,
        `select count(*) from "import_event_outcomes" where ("import_event_outcomes"."import_id" in (select distinct on ("imports"."backtest_request_id") "id" from "imports" where "imports"."player_id" = $1 order by "imports"."backtest_request_id", "imports"."imported_at" desc, "imports"."sequence_number" desc) and "import_event_outcomes"."outcome" = $2 and "import_event_outcomes"."position" is not null) ["${PLAYER}","refused"]`,
      ]);
    });
  });

  describe('event trace', () => {
    it('[IMP-31] gives the import that brought the event, the others that added sources, and each source’s marks by rank', async () => {
      const origin = await saveImport(await request());
      const event = await insertHistoricalEvent(db, {
        playerId: PLAYER,
        originImportId: origin.id,
      });
      const second = await saveImport(await request(), [], { mode: 'addition' });
      const third = await saveImport(await request(), [], { mode: 'addition' });
      const first = await source(event.id, 1, {
        addedByImportId: origin.id,
        linkStatus: 'not_found',
        spotCheckVerdict: 'consistent',
      });
      const fromThird = await source(event.id, 3, { addedByImportId: third.id });
      const fromSecond = await source(event.id, 2, {
        addedByImportId: second.id,
        spotCheckVerdict: 'inaccessible',
      });
      const byOwner = await source(event.id, 4);
      const alsoThird = await source(event.id, 5, {
        addedByImportId: third.id,
        spotCheckVerdict: 'inconsistent',
      });

      await expect(eventTrace(db, event.id)).resolves.toStrictEqual({
        originImportNumber: 1,
        sourceImportNumbers: [2, 3],
        sources: [
          {
            sourceId: first?.id,
            position: 1,
            linkStatus: 'not_found',
            spotCheckVerdict: 'consistent',
          },
          {
            sourceId: fromSecond?.id,
            position: 2,
            linkStatus: null,
            spotCheckVerdict: 'inaccessible',
          },
          { sourceId: fromThird?.id, position: 3, linkStatus: null, spotCheckVerdict: null },
          { sourceId: byOwner?.id, position: 4, linkStatus: null, spotCheckVerdict: null },
          {
            sourceId: alsoThird?.id,
            position: 5,
            linkStatus: null,
            spotCheckVerdict: 'inconsistent',
          },
        ],
      });
    });

    it('[IMP-31] gives no origin import for an event that no import brought, and nothing for an event that does not exist', async () => {
      const detected = await insertDetectedEvent(db, { playerId: PLAYER });

      await expect(eventTrace(db, detected.id)).resolves.toStrictEqual({
        originImportNumber: null,
        sourceImportNumbers: [],
        sources: [],
      });
      await expect(eventTrace(db, detected.id + 1)).resolves.toBeNull();
    });
  });
});
