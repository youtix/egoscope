import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, withdrawnEventCounter } from '@/lib/db';
import { insertEventType, insertPlayer, insertRequest } from '@/lib/testing';
import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';
import { sentence } from '@/lib/wording';

import { hasUnsentDeviceDrafts } from './device-copies';
import { listCopies, putContact, putCopy, readCopy } from './device-store';
import { draftKey } from './draft-target';
import { checkDeviceDrafts } from './server-check';
import { discardDraft, getDraft, saveDraft } from './server-drafts';
import { usePasteDraft } from './use-paste-draft';

import type { DraftServer } from './contract';
import type { DraftTarget } from './draft-target';
import type { Database } from '@/lib/db';
import type { MockInstance } from 'vitest';

// The request of an invented player, the first that a test's own database writes.
const REQUEST_ID = 1;
const IMPORT: DraftTarget = { kind: 'research_result', requestId: REQUEST_ID };
const PASTED = 'EVENT 1: the Redwater Foxes forward changes agents.';
const SAVED_ELSEWHERE_AT = toEpochMs(Date.UTC(2026, 10, 20));
// The default of display.draftRetentionDays, 7 days.
const RETENTION_MS = 7 * 86_400_000;

describe('the draft of a paste screen', { timeout: 60_000 }, () => {
  let db: Database;
  let isReachable: boolean;
  let calls: string[];
  let server: DraftServer;
  let onLine: MockInstance<() => boolean>;

  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const database = await createTestDatabase();
    db = database.db;
    await insertEventType(db);
    const player = await insertPlayer(db);
    await insertRequest(db, { playerId: player.id });
    isReachable = true;
    calls = [];
    // The route's Server Actions, which reject while the session is expired.
    const action =
      <A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        calls.push(name);
        if (!isReachable) {
          throw new TypeError('The session expired.');
        }
        return run(...args);
      };
    server = {
      check: action('check', async (sent) => checkDeviceDrafts(db, sent)),
      load: action('load', async (target) => getDraft(db, target)),
      save: action('save', async (upload) => saveDraft(db, { ...upload, originDevice: 'Phone' })),
      discard: action('discard', async (target) => discardDraft(db, target)),
    };
    return async () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      await database.close();
    };
  }, 60_000);

  async function open() {
    const view = renderHook(() => usePasteDraft(IMPORT, server));
    await waitFor(() => {
      expect(view.result.current.ready).toBe(true);
    });
    return view;
  }

  async function typeAndSend(view: Awaited<ReturnType<typeof open>>) {
    act(() => {
      view.result.current.change(PASTED);
    });
    await waitFor(() => {
      expect(view.result.current.sent).toBe(true);
    });
  }

  async function typeUnsent(view: Awaited<ReturnType<typeof open>>) {
    act(() => {
      view.result.current.change(PASTED);
    });
    await waitFor(async () => {
      await expect(hasUnsentDeviceDrafts()).resolves.toBe(true);
    });
  }

  function goOnline() {
    onLine.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
  }

  it('[IHM-42] keeps every change at once on the device and sends it to the server', async () => {
    const view = await open();

    act(() => {
      view.result.current.change(PASTED);
    });

    expect(view.result.current).toMatchObject({ text: PASTED, status: 'kept' });
    await waitFor(() => {
      expect(view.result.current.sent).toBe(true);
    });
    expect(await readCopy(draftKey(IMPORT))).toMatchObject({ text: PASTED, sent: true });
    expect(await getDraft(db, IMPORT)).toMatchObject({ text: PASTED });
  });

  it('[IHM-42] finds the pasted text intact after the app is closed and reopened', async () => {
    const first = await open();
    await typeAndSend(first);
    first.unmount();

    const { result } = await open();

    expect(result.current.text).toBe(PASTED);
  });

  it('[IHM-42] [IHM-58] [CL-IHM-14] offline, keeps the change on the device and refuses to discard', async () => {
    const view = await open();
    onLine.mockReturnValue(false);
    calls = [];

    await typeUnsent(view);

    expect(await act(async () => view.result.current.discard())).toBe('server_unavailable');
    expect(view.result.current).toMatchObject({ text: PASTED, sent: false });
    expect(calls).toStrictEqual([]);
  });

  it('[IHM-42] [IHM-58] [CL-IHM-14] sends only the draft when the network returns, never an action typed offline', async () => {
    const view = await open();
    onLine.mockReturnValue(false);
    await typeUnsent(view);
    await act(async () => view.result.current.discard());
    calls = [];

    goOnline();

    await waitFor(() => {
      expect(view.result.current.sent).toBe(true);
    });
    expect(view.result.current.text).toBe(PASTED);
    expect(calls).toStrictEqual(['check', 'save']);
    expect(await getDraft(db, IMPORT)).toMatchObject({ text: PASTED });
  });

  it('[IHM-42] keeps the draft through an expired session and sends it after the owner logs in again', async () => {
    const first = await open();
    isReachable = false;
    act(() => {
      first.result.current.change(PASTED);
    });
    await waitFor(async () => {
      await expect(readCopy(draftKey(IMPORT))).resolves.toMatchObject({ text: PASTED });
    });
    expect(await act(async () => first.result.current.discard())).toBe('server_unavailable');
    first.unmount();
    // Reopened before the owner logs in again: the contact fails, the draft stays.
    const second = await open();
    expect(second.result.current).toMatchObject({ text: PASTED, sent: false });
    second.unmount();

    isReachable = true;
    const { result } = await open();

    expect(result.current).toMatchObject({ text: PASTED, sent: true });
    expect(await getDraft(db, IMPORT)).toMatchObject({ text: PASTED });
  });

  it('[CL-IHM-11] deletes an expired device copy when the screen opens offline', async () => {
    const first = await open();
    await typeAndSend(first);
    first.unmount();
    onLine.mockReturnValue(false);
    const expiry = toEpochMs(now() + RETENTION_MS);
    onTestFinished(installFakeClock(fixedClock(expiry)));

    const { result } = await open();

    expect(result.current.text).toBe('');
    expect(await readCopy(draftKey(IMPORT))).toBeUndefined();
  });

  it('[CL-IHM-11] [CL-DSN-22] deletes offline the expired copies of the other screens when a screen opens', async () => {
    const typedAt = toEpochMs(now() - RETENTION_MS);
    const otherScreen: DraftTarget = { kind: 'research_result', requestId: 7 };
    await putContact({ withdrawnEventCount: 0, retentionDays: 7 });
    await putCopy({
      key: draftKey(otherScreen),
      target: otherScreen,
      text: PASTED,
      updatedAt: typedAt,
      sent: false,
      withdrawnEventCount: 0,
      status: 'kept',
    });
    onLine.mockReturnValue(false);

    await open();

    expect(await listCopies()).toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });

  it('[IHM-42] shows the last change when an earlier one is answered after it', async () => {
    const view = await open();
    const clock = fixedClock(now());
    onTestFinished(installFakeClock(clock));

    act(() => {
      view.result.current.change('An earlier text.');
      clock.advance(1);
      view.result.current.change(PASTED);
    });
    await waitFor(async () => {
      await expect(readCopy(draftKey(IMPORT))).resolves.toMatchObject({ text: PASTED, sent: true });
    });

    expect(view.result.current).toMatchObject({ text: PASTED, sent: true });
  });

  it('[IHM-42] resumes on this device the draft another device saved', async () => {
    await saveDraft(db, {
      target: IMPORT,
      text: PASTED,
      updatedAt: SAVED_ELSEWHERE_AT,
      knownWithdrawnEventCount: 0,
      originDevice: 'Laptop',
    });

    const { result } = await open();

    expect(result.current).toMatchObject({
      text: PASTED,
      updatedAt: SAVED_ELSEWHERE_AT,
      sent: true,
    });
  });

  it('[IHM-42] [DSN-32] deletes both copies when the draft is discarded', async () => {
    const view = await open();
    await typeAndSend(view);

    expect(await act(async () => view.result.current.discard())).toBe('discarded');
    expect(view.result.current.text).toBe('');
    expect(await getDraft(db, IMPORT)).toBeNull();
    expect(await readCopy(draftKey(IMPORT))).toBeUndefined();
  });

  it('[IHM-42] [DSN-32] forgets the device copy once the import is saved, which deletes the server copy', async () => {
    const view = await open();
    await typeAndSend(view);

    await discardDraft(db, IMPORT);
    await act(async () => view.result.current.saved());

    expect(view.result.current.status).toBeNull();
    expect(await readCopy(draftKey(IMPORT))).toBeUndefined();
  });

  it('[CL-DSN-22] discards a draft typed offline when events were withdrawn meanwhile, and says so', async () => {
    const view = await open();
    onLine.mockReturnValue(false);
    await typeUnsent(view);
    await db.insert(withdrawnEventCounter).values({ value: 1 });

    goOnline();

    await waitFor(() => {
      expect(view.result.current.unsentDiscarded).toBe(true);
    });
    expect(view.result.current.text).toBe('');
    expect(await getDraft(db, IMPORT)).toBeNull();
    expect(sentence('sensitiveData.offlineDraftsDiscarded')).toBe(
      'Drafts typed offline were discarded because events were withdrawn or declined for sensitivity meanwhile.',
    );
  });

  it('[CL-DSN-22] discards a change typed while another device withdrew an event', async () => {
    const view = await open();
    await db.insert(withdrawnEventCounter).values({ value: 1 });

    act(() => {
      view.result.current.change(PASTED);
    });

    await waitFor(() => {
      expect(view.result.current.unsentDiscarded).toBe(true);
    });
    expect(view.result.current.text).toBe('');
  });

  it('[IHM-42] [CL-IMP-27] keeps on the device a text the server refuses as too large, with the refusal', async () => {
    const view = await open();

    act(() => {
      view.result.current.change('a'.repeat(2_000_001));
    });

    await waitFor(() => {
      expect(view.result.current.refusal).toBe('The pasted text is 2.01 MB, over the 2 MB limit.');
    });
    expect(view.result.current.sent).toBe(false);
    expect(await hasUnsentDeviceDrafts()).toBe(true);
  });
});
