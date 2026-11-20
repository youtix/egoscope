import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { backtestRequests } from './backtests';
import { drafts } from './drafts';
import { eventTypes } from './taxonomy';

import type { Database } from '../types';

// A pasted research result of the parent backtest request, typed on a laptop.
const IMPORT_DRAFT = {
  kind: 'research_result',
  backtestRequestId: PARENTS.requestId,
  text: '{"format_version": "1.0", "events": []}',
  originDevice: 'Laptop, Firefox',
} as const;
// A pasted exploration response, for the general screen until a proposal is given.
const EXPLORATION_DRAFT = {
  kind: 'exploration_response',
  text: '{"proposals": []}',
  originDevice: 'Phone, Safari',
} as const;
// A request to do for the other player.
const OTHER_REQUEST = {
  reference: 'REQ-2026-0002',
  playerId: PARENTS.otherPlayerId,
  kind: 'initial',
  trigger: 'manual_action',
  createdOn: '2026-11-02',
  promptText: 'Research the public events of the player.',
  promptProducedAt: sql`now()`,
} as const;
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the drafts table', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    return database.close;
  }, 60_000);

  it('keeps the server copy of a pasted text, with its last change and its device', async () => {
    await db.insert(drafts).values(IMPORT_DRAFT);

    await expect(db.select().from(drafts)).resolves.toStrictEqual([
      {
        id: 1,
        ...IMPORT_DRAFT,
        explorationEventTypeId: null,
        updatedAt: ANY_INSTANT,
      },
    ]);
  });

  it('[CL-DSN-17] ties an import draft to its request, and an exploration draft to its proposal only', async () => {
    const requestless = db.insert(drafts).values({ ...IMPORT_DRAFT, backtestRequestId: null });
    const exploring = db
      .insert(drafts)
      .values({ ...EXPLORATION_DRAFT, backtestRequestId: PARENTS.requestId });
    const targeted = db
      .insert(drafts)
      .values({ ...IMPORT_DRAFT, explorationEventTypeId: 'media-storm' });
    const unknown = db.insert(drafts).values({ ...EXPLORATION_DRAFT, kind: sql`'note'` });

    await expect(requestless).rejects.toMatchObject(violationOf('drafts_import_check'));
    await expect(exploring).rejects.toMatchObject(violationOf('drafts_import_check'));
    await expect(targeted).rejects.toMatchObject(violationOf('drafts_exploration_check'));
    await expect(unknown).rejects.toMatchObject(violationOf('drafts_kind_check'));
  });

  it('[CL-DSN-17] keeps at most one import draft per request', async () => {
    await db.insert(backtestRequests).values(OTHER_REQUEST);
    await db.insert(drafts).values([IMPORT_DRAFT, { ...IMPORT_DRAFT, backtestRequestId: 2 }]);

    const second = db.insert(drafts).values({ ...IMPORT_DRAFT, originDevice: 'Phone, Safari' });

    await expect(second).rejects.toMatchObject(duplicateOf('drafts_import_key'));
  });

  it('[CL-DSN-17] keeps one exploration draft for the general screen and one per targeted proposal', async () => {
    await db
      .insert(drafts)
      .values([
        EXPLORATION_DRAFT,
        { ...EXPLORATION_DRAFT, explorationEventTypeId: 'media-storm' },
        { ...EXPLORATION_DRAFT, explorationEventTypeId: 'bereavement' },
      ]);

    const general = db.insert(drafts).values(EXPLORATION_DRAFT);
    const targeted = db
      .insert(drafts)
      .values({ ...EXPLORATION_DRAFT, explorationEventTypeId: 'media-storm' });

    await expect(general).rejects.toMatchObject(duplicateOf('drafts_exploration_key'));
    await expect(targeted).rejects.toMatchObject(duplicateOf('drafts_exploration_key'));
  });

  it('[CL-DSN-17] deletes a draft with its request or with its proposal', async () => {
    await db
      .insert(eventTypes)
      .values({ id: 'player-conflict', origin: 'exploration', name: 'Conflict between players' });
    await db
      .insert(drafts)
      .values([
        IMPORT_DRAFT,
        { ...EXPLORATION_DRAFT, explorationEventTypeId: 'player-conflict' },
        EXPLORATION_DRAFT,
      ]);

    await db.delete(backtestRequests).where(eq(backtestRequests.id, PARENTS.requestId));
    await db.delete(eventTypes).where(eq(eventTypes.id, 'player-conflict'));

    await expect(
      db.select({ kind: drafts.kind, type: drafts.explorationEventTypeId }).from(drafts),
    ).resolves.toStrictEqual([{ kind: 'exploration_response', type: null }]);
  });
});
