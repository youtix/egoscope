import { eq } from 'drizzle-orm';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backtestRequests, createTestDatabase, withdrawnEventCounter } from '@/lib/db';
import { insertEventType, insertPlayer, insertRequest } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { listCopies, putContact, putCopy, readContact, readCopy } from './device-store';
import { contactServer, sendCopy } from './device-sync';
import { draftKey } from './draft-target';
import { checkDeviceDrafts } from './server-check';
import { discardDraft, discardDraftsOfRequests, getDraft, saveDraft } from './server-drafts';

import type { DraftServer } from './contract';
import type { DeviceCopy } from './device-store';
import type { DraftTarget } from './draft-target';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

const NOW = toEpochMs(Date.UTC(2026, 10, 20, 9));
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// The request of an invented player, the first that a test's own database writes.
const REQUEST_ID = 1;
const IMPORT: DraftTarget = { kind: 'research_result', requestId: REQUEST_ID };
const GONE_IMPORT: DraftTarget = { kind: 'research_result', requestId: 99 };
const GENERAL: DraftTarget = { kind: 'exploration_response', eventTypeId: null };

function copyOf(
  target: DraftTarget,
  isSent: boolean,
  withdrawnEventCount: number | null,
): DeviceCopy {
  return {
    key: draftKey(target),
    target,
    text: `Pasted for ${draftKey(target)}.`,
    updatedAt: NOW,
    sent: isSent,
    withdrawnEventCount,
    status: 'kept',
  };
}

describe("a device's contact with the server about its drafts", { timeout: 60_000 }, () => {
  let db: Database;
  let server: DraftServer;
  let clock: FixedClock;

  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    const player = await insertPlayer(db);
    await insertRequest(db, { playerId: player.id });
    server = {
      check: async (sent) => checkDeviceDrafts(db, sent),
      load: async (target) => getDraft(db, target),
      save: async (upload) => saveDraft(db, { ...upload, originDevice: 'Phone' }),
      discard: async (target) => discardDraft(db, target),
    };
    clock = fixedClock(NOW);
    const restoreClock = installFakeClock(clock);
    return async () => {
      restoreClock();
      vi.unstubAllGlobals();
      await database.close();
    };
  }, 60_000);

  async function withdrawEventOf(requestIds: number[]) {
    await db.transaction(async (tx) => {
      await discardDraftsOfRequests(tx, requestIds);
      await tx
        .insert(withdrawnEventCounter)
        .values({ value: 1 })
        .onConflictDoUpdate({
          target: withdrawnEventCounter.id,
          set: { value: 1 },
        });
    });
  }

  it('[IHM-42] [CL-IHM-14] sends the copies typed offline when the network returns, and records what the server answered', async () => {
    await putContact({ withdrawnEventCount: 0, retentionDays: null });
    await putCopy(copyOf(IMPORT, false, 0));
    await putCopy(copyOf(GENERAL, false, null));

    expect(await contactServer(server)).toStrictEqual({
      unsentDiscarded: false,
      refusals: new Map(),
    });
    expect(await listCopies()).toStrictEqual([
      { ...copyOf(GENERAL, false, null), sent: true, withdrawnEventCount: 0 },
      { ...copyOf(IMPORT, false, 0), sent: true },
    ]);
    expect(await getDraft(db, IMPORT)).toMatchObject({ text: `Pasted for ${draftKey(IMPORT)}.` });
    expect(await readContact()).toStrictEqual({ withdrawnEventCount: 0, retentionDays: 7 });
  });

  it('[CL-DSN-22] after a withdrawal, drops the sent copy whose server copy went and discards an unsent import copy of any player, exploration copies sent', async () => {
    await putCopy(copyOf(IMPORT, false, 0));
    await sendCopy(copyOf(IMPORT, false, 0), server);
    await withdrawEventOf([REQUEST_ID]);
    const otherPlayers: DraftTarget = { kind: 'research_result', requestId: 7 };
    await putCopy(copyOf(otherPlayers, false, 0));
    await putCopy(copyOf(GENERAL, false, 0));

    expect(await contactServer(server)).toStrictEqual({
      unsentDiscarded: true,
      refusals: new Map(),
    });
    expect(await listCopies()).toStrictEqual([
      { ...copyOf(GENERAL, false, 0), sent: true, withdrawnEventCount: 1 },
    ]);
  });

  it('[CL-DSN-22] marks a sent copy "Request already imported" when its request was imported elsewhere and the counter has not grown', async () => {
    await putCopy(copyOf(IMPORT, false, 0));
    await sendCopy(copyOf(IMPORT, false, 0), server);
    await db.transaction(async (tx) => {
      await discardDraft(tx, IMPORT);
      await tx
        .update(backtestRequests)
        .set({ status: 'imported', importedAt: new Date(NOW) })
        .where(eq(backtestRequests.id, REQUEST_ID));
    });

    expect(await contactServer(server)).toStrictEqual({
      unsentDiscarded: false,
      refusals: new Map(),
    });
    expect(await readCopy(draftKey(IMPORT))).toStrictEqual({
      ...copyOf(IMPORT, true, 0),
      status: 'request_already_imported',
    });
  });

  it('[CL-IHM-11] drops a device copy at its expiry, by the retention the server answers', async () => {
    await putCopy({ ...copyOf(GENERAL, false, 0), updatedAt: toEpochMs(NOW - 7 * DAY_MS) });

    await contactServer(server);

    expect(await listCopies()).toStrictEqual([]);
  });

  it('[IHM-42] [CL-IMP-27] keeps unsent, with the refusal, a copy too large for the server', async () => {
    const large = { ...copyOf(GENERAL, false, 0), text: 'a'.repeat(2_000_001) };
    await putCopy(large);

    const report = await contactServer(server);

    expect(report.refusals).toStrictEqual(
      new Map([[draftKey(GENERAL), 'The pasted text is 2.01 MB, over the 2 MB limit.']]),
    );
    expect(await readCopy(draftKey(GENERAL))).toStrictEqual(large);
  });

  it('[DSN-32] keeps unsent, with no refusal, a copy holding a character the database cannot keep', async () => {
    const unstorable = { ...copyOf(GENERAL, false, 0), text: 'Pasted\0text.' };
    await putCopy(unstorable);

    expect(await sendCopy(unstorable, server)).toStrictEqual({ kind: 'kept_unsent' });
    expect(await contactServer(server)).toStrictEqual({
      unsentDiscarded: false,
      refusals: new Map(),
    });
    expect(await readCopy(draftKey(GENERAL))).toStrictEqual(unstorable);
    expect(await getDraft(db, GENERAL)).toBeNull();
  });

  it('[CL-DSN-17] deletes a copy whose request no longer exists', async () => {
    await putCopy(copyOf(GONE_IMPORT, false, 0));

    expect(await sendCopy(copyOf(GONE_IMPORT, false, 0), server)).toStrictEqual({ kind: 'gone' });
    expect(await listCopies()).toStrictEqual([]);
  });

  it('[CL-DSN-22] discards a copy refused for a counter that grew, and records the counter', async () => {
    await withdrawEventOf([]);
    await putCopy(copyOf(IMPORT, false, 0));

    expect(await sendCopy(copyOf(IMPORT, false, 0), server)).toStrictEqual({
      kind: 'discarded_unsent',
    });
    expect(await listCopies()).toStrictEqual([]);
    expect(await readContact()).toStrictEqual({ withdrawnEventCount: 1, retentionDays: null });
  });

  it('[IHM-42] leaves unsent a copy the owner changed while the earlier text was on its way', async () => {
    const later = {
      ...copyOf(IMPORT, false, 0),
      text: 'A later change.',
      updatedAt: toEpochMs(NOW + 1),
    };
    await putCopy(later);

    expect(await sendCopy(copyOf(IMPORT, false, 0), server)).toStrictEqual({ kind: 'sent' });
    expect(await readCopy(draftKey(IMPORT))).toStrictEqual(later);
  });

  /** Saves the copy that the laptop typed a minute later, and returns the copy this device would take. */
  async function saveLaterFromLaptop(): Promise<DeviceCopy> {
    const text = 'Typed later on the laptop.';
    clock.advance(MINUTE_MS);
    const typedAt = toEpochMs(clock.now());
    await saveDraft(db, {
      target: IMPORT,
      text,
      updatedAt: typedAt,
      knownWithdrawnEventCount: 0,
      originDevice: 'Laptop',
    });
    return { ...copyOf(IMPORT, true, 0), text, updatedAt: typedAt };
  }

  it('[IHM-42] [H-IHM-08] [CL-DSN-17] at a contact, takes the later change another device saved over the copy this device sent', async () => {
    await putContact({ withdrawnEventCount: 0, retentionDays: 7 });
    await putCopy(copyOf(IMPORT, false, 0));
    await sendCopy(copyOf(IMPORT, false, 0), server);
    const laptops = await saveLaterFromLaptop();

    await contactServer(server);

    expect(await listCopies()).toStrictEqual([laptops]);
  });

  it('[IHM-42] [CL-DSN-17] takes the later server copy over a copy sent after it, which the server did not write', async () => {
    await putContact({ withdrawnEventCount: 0, retentionDays: 7 });
    const laptops = await saveLaterFromLaptop();
    await putCopy(copyOf(IMPORT, false, 0));

    expect(await sendCopy(copyOf(IMPORT, false, 0), server)).toStrictEqual({
      kind: 'superseded',
      copy: laptops,
    });
    expect(await readCopy(draftKey(IMPORT))).toStrictEqual(laptops);
    expect(await getDraft(db, IMPORT)).toMatchObject({ text: 'Typed later on the laptop.' });
  });

  it('[IHM-42] [CL-DSN-17] keeps a change typed on the device after the server copy that superseded the copy sent', async () => {
    const laptops = await saveLaterFromLaptop();
    const typedLast = {
      ...copyOf(IMPORT, false, 0),
      text: 'Typed last on the phone.',
      updatedAt: toEpochMs(laptops.updatedAt + 1),
    };
    await putCopy(typedLast);

    expect(await sendCopy(copyOf(IMPORT, false, 0), server)).toStrictEqual({
      kind: 'superseded',
      copy: typedLast,
    });
    expect(await readCopy(draftKey(IMPORT))).toStrictEqual(typedLast);
  });
});
