import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTestDatabase,
  drafts,
  journalEntries,
  journalTechnicalDetails,
  withdrawnEventCounter,
} from '@/lib/db';
import { insertEventType, insertPlayer, insertRequest } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { checkDeviceDrafts } from './server-check';
import {
  discardDraft,
  discardDraftsOfRequests,
  eraseAllDrafts,
  getDraft,
  purgeExpired,
  saveDraft,
} from './server-drafts';

import type { DraftTarget } from './draft-target';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

const SAVED_AT = toEpochMs(Date.UTC(2026, 10, 20, 9, 30));
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// The requests of two invented players, the first two that a test's own database writes.
const REQUEST_ID = 1;
const IMPORT: DraftTarget = { kind: 'research_result', requestId: REQUEST_ID };
const OTHER_IMPORT: DraftTarget = { kind: 'research_result', requestId: 2 };
const GENERAL: DraftTarget = { kind: 'exploration_response', eventTypeId: null };
const TARGETED: DraftTarget = { kind: 'exploration_response', eventTypeId: 'media-storm' };
const PASTED = 'EVENT 1: the Northport Gulls guard misses practice; sources: two invented outlets.';
// One byte over the default bound of imports.maxPastedTextMegabytes, 2 MB.
const TOO_LARGE = 'a'.repeat(2_000_001);

describe('the server copy of a draft', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    for (const source of ['p01', 'p02'] as const) {
      const player = await insertPlayer(db, { source });
      await insertRequest(db, { playerId: player.id });
    }
    clock = fixedClock(SAVED_AT);
    const restoreClock = installFakeClock(clock);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, 60_000);

  /** Saves `text` for `target` from `originDevice`, typed now, the counter known at 0. */
  async function save(target: DraftTarget, text: string, originDevice = 'Phone') {
    return saveDraft(db, {
      target,
      text,
      updatedAt: toEpochMs(clock.now()),
      knownWithdrawnEventCount: 0,
      originDevice,
    });
  }

  async function count(): Promise<number> {
    const rows = await db.select({ id: drafts.id }).from(drafts);
    return rows.length;
  }

  it('[IHM-42] finds from another device the draft one device saved, with its last change and its device', async () => {
    expect(await save(IMPORT, PASTED, 'Phone')).toStrictEqual({
      ok: true,
      value: { withdrawnEventCount: 0 },
    });

    expect(await getDraft(db, IMPORT)).toStrictEqual({
      text: PASTED,
      updatedAt: SAVED_AT,
      originDevice: 'Phone',
    });
    expect(await getDraft(db, OTHER_IMPORT)).toBeNull();
  });

  it('[IHM-42] [CL-DSN-17] keeps one draft per request and per exploration screen, the last change replacing the copy', async () => {
    await save(IMPORT, 'first text');
    clock.advance(HOUR_MS);
    await save(IMPORT, PASTED, 'Laptop');
    await save(GENERAL, 'general response');
    await save(TARGETED, 'targeted response');

    expect(await count()).toBe(3);
    expect(await getDraft(db, IMPORT)).toStrictEqual({
      text: PASTED,
      updatedAt: toEpochMs(SAVED_AT + HOUR_MS),
      originDevice: 'Laptop',
    });
    expect(await getDraft(db, GENERAL)).toMatchObject({ text: 'general response' });
    expect(await getDraft(db, TARGETED)).toMatchObject({ text: 'targeted response' });
  });

  it('[IHM-42] [CL-IMP-27] refuses a text above imports.maxPastedTextMegabytes, with the glossary message', async () => {
    expect(await save(IMPORT, TOO_LARGE)).toStrictEqual({
      ok: false,
      error: {
        kind: 'text_too_large',
        message: 'The pasted text is 2.01 MB, over the 2 MB limit.',
      },
    });
    expect(await save(IMPORT, 'a'.repeat(2_000_000))).toMatchObject({ ok: true });
  });

  it('[CL-DSN-17] refuses a draft whose request or proposal no longer exists', async () => {
    expect(await save({ kind: 'research_result', requestId: 99 }, PASTED)).toStrictEqual({
      ok: false,
      error: { kind: 'target_gone' },
    });
    expect(
      await save({ kind: 'exploration_response', eventTypeId: 'no-such-type' }, PASTED),
    ).toStrictEqual({ ok: false, error: { kind: 'target_gone' } });
    expect(await count()).toBe(0);
  });

  it('[CL-DSN-22] refuses an import copy typed before the counter grew, or with no counter, and accepts an exploration copy', async () => {
    await db.insert(withdrawnEventCounter).values({ value: 3 });
    const upload = { text: PASTED, updatedAt: SAVED_AT, originDevice: 'Phone' };
    const withdrawn = { ok: false, error: { kind: 'events_withdrawn', withdrawnEventCount: 3 } };

    expect(
      await saveDraft(db, { ...upload, target: IMPORT, knownWithdrawnEventCount: 2 }),
    ).toStrictEqual(withdrawn);
    expect(
      await saveDraft(db, { ...upload, target: IMPORT, knownWithdrawnEventCount: null }),
    ).toStrictEqual(withdrawn);
    expect(
      await saveDraft(db, { ...upload, target: GENERAL, knownWithdrawnEventCount: 2 }),
    ).toStrictEqual({
      ok: true,
      value: { withdrawnEventCount: 3 },
    });
    expect(
      await saveDraft(db, { ...upload, target: IMPORT, knownWithdrawnEventCount: 3 }),
    ).toStrictEqual({
      ok: true,
      value: { withdrawnEventCount: 3 },
    });
  });

  it('[CL-IHM-11] keeps the instant a copy was typed at, never later than now', async () => {
    const typedOffline = toEpochMs(SAVED_AT - DAY_MS);
    await saveDraft(db, {
      target: IMPORT,
      text: PASTED,
      updatedAt: typedOffline,
      knownWithdrawnEventCount: 0,
      originDevice: 'Phone',
    });
    await saveDraft(db, {
      target: GENERAL,
      text: PASTED,
      updatedAt: toEpochMs(SAVED_AT + DAY_MS),
      knownWithdrawnEventCount: 0,
      originDevice: 'Phone',
    });

    expect(await getDraft(db, IMPORT)).toMatchObject({ updatedAt: typedOffline });
    expect(await getDraft(db, GENERAL)).toMatchObject({ updatedAt: SAVED_AT });
  });

  it('[IHM-42] [DSN-32] deletes the server copy when the draft is discarded or its import saved', async () => {
    await save(IMPORT, PASTED);
    await save(GENERAL, PASTED);

    await db.transaction(async (tx) => discardDraft(tx, IMPORT));
    await discardDraft(db, GENERAL);

    expect(await count()).toBe(0);
  });

  it('[CL-DSN-22] discards the import drafts of the given requests in the caller transaction, with no journal entry, exploration drafts untouched', async () => {
    await save(IMPORT, PASTED);
    await save(OTHER_IMPORT, 'other player');
    await save(TARGETED, PASTED);

    await db.transaction(async (tx) => {
      await discardDraftsOfRequests(tx, []);
      await discardDraftsOfRequests(tx, [REQUEST_ID]);
    });

    expect(await getDraft(db, IMPORT)).toBeNull();
    expect(await getDraft(db, OTHER_IMPORT)).toMatchObject({ text: 'other player' });
    expect(await getDraft(db, TARGETED)).toMatchObject({ text: PASTED });
    expect(await db.select().from(journalEntries)).toStrictEqual([]);
  });

  it('[CL-DSN-22] rolls the discard back with the withdrawal transaction that fails', async () => {
    await save(IMPORT, PASTED);
    const failed = db.transaction(async (tx) => {
      await discardDraftsOfRequests(tx, [REQUEST_ID]);
      throw new Error('The withdrawal failed.');
    });

    await expect(failed).rejects.toThrow('The withdrawal failed.');
    expect(await getDraft(db, IMPORT)).toMatchObject({ text: PASTED });
  });

  it('[CL-TRV-05] [CL-TRV-06] erases every server copy at the end of a restore', async () => {
    await save(IMPORT, PASTED);
    await save(GENERAL, PASTED);

    await db.transaction(async (tx) => eraseAllDrafts(tx));

    expect(await count()).toBe(0);
  });

  it('[IHM-42] [CL-IHM-11] hides a draft once expired and purges those whose last change is display.draftRetentionDays old', async () => {
    await save(IMPORT, PASTED);
    clock.advance(DAY_MS);
    await save(GENERAL, 'younger');
    clock.advance(6 * DAY_MS - 1);

    expect(await getDraft(db, IMPORT)).toMatchObject({ text: PASTED });
    expect(await purgeExpired(db)).toBe(0);

    clock.advance(1);

    expect(await getDraft(db, IMPORT)).toBeNull();
    expect(await purgeExpired(db)).toBe(1);
    expect(await getDraft(db, GENERAL)).toMatchObject({ text: 'younger' });
  });

  it('[DSN-32] [CL-IHM-10] writes no draft text to the journal or the log', async () => {
    const lines = (['debug', 'info', 'warn', 'error', 'log'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    await save(IMPORT, PASTED);
    await save(GENERAL, PASTED);
    await getDraft(db, IMPORT);
    await checkDeviceDrafts(db, [IMPORT, GENERAL]);
    await discardDraft(db, GENERAL);
    await db
      .update(drafts)
      .set({ updatedAt: new Date(SAVED_AT - 8 * DAY_MS) })
      .where(eq(drafts.kind, 'research_result'));
    await purgeExpired(db);

    const journal = JSON.stringify([
      await db.select().from(journalEntries),
      await db.select().from(journalTechnicalDetails),
    ]);
    expect(journal).not.toContain('Northport Gulls guard');
    for (const line of lines) {
      expect(JSON.stringify(line.mock.calls)).not.toContain('Northport Gulls guard');
    }
    expect(await count()).toBe(0);
  });
});
