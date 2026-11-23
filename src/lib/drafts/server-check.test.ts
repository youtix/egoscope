import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { backtestRequests, createTestDatabase, withdrawnEventCounter } from '@/lib/db';
import { insertEventType, insertPlayer, insertRequest } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { checkDeviceDrafts } from './server-check';
import { discardDraft, saveDraft } from './server-drafts';

import type { DraftTarget } from './draft-target';
import type { Database } from '@/lib/db';

const IMPORTED_AT = new Date(Date.UTC(2026, 10, 21));
// The request of an invented player, the first that a test's own database writes.
const REQUEST_ID = 1;
const IMPORT: DraftTarget = { kind: 'research_result', requestId: REQUEST_ID };
const GENERAL: DraftTarget = { kind: 'exploration_response', eventTypeId: null };
const TARGETED: DraftTarget = { kind: 'exploration_response', eventTypeId: 'media-storm' };

describe("the server's answer at a device's contact", { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    const player = await insertPlayer(db);
    await insertRequest(db, { playerId: player.id });
    return database.close;
  }, 60_000);

  async function save(target: DraftTarget) {
    await saveDraft(db, {
      target,
      text: 'Pasted text.',
      updatedAt: toEpochMs(Date.UTC(2026, 10, 20)),
      knownWithdrawnEventCount: 0,
      originDevice: 'Phone',
    });
  }

  it('[CL-DSN-22] [CL-IHM-11] answers the counter, the retention, and only for the copies sent', async () => {
    expect(await checkDeviceDrafts(db, [])).toStrictEqual({
      withdrawnEventCount: 0,
      retentionDays: 7,
      copies: [],
    });

    await save(IMPORT);
    await save(TARGETED);
    await db.insert(withdrawnEventCounter).values({ value: 4 });

    expect(await checkDeviceDrafts(db, [IMPORT, TARGETED, GENERAL])).toStrictEqual({
      withdrawnEventCount: 4,
      retentionDays: 7,
      copies: [
        { target: IMPORT, exists: true, requestImported: false },
        { target: TARGETED, exists: true, requestImported: false },
        { target: GENERAL, exists: false, requestImported: false },
      ],
    });
  });

  it('[CL-DSN-22] tells a server copy gone with its request imported from one gone otherwise', async () => {
    await save(IMPORT);
    await discardDraft(db, IMPORT);

    expect(await checkDeviceDrafts(db, [IMPORT])).toMatchObject({
      copies: [{ target: IMPORT, exists: false, requestImported: false }],
    });

    await db
      .update(backtestRequests)
      .set({ status: 'imported', importedAt: IMPORTED_AT })
      .where(eq(backtestRequests.id, REQUEST_ID));

    expect(await checkDeviceDrafts(db, [IMPORT])).toMatchObject({
      copies: [{ target: IMPORT, exists: false, requestImported: true }],
    });
  });
});
