// The server half of the drafts, as the tests of the device half reach it: the device half
// never imports `drafts` (module map, `device-drafts`), so its tests drive the real server
// operations through these helpers, as a route's Server Actions would.
import { sql } from 'drizzle-orm';

import { withdrawnEventCounter } from '@/lib/db';
import {
  checkDeviceDrafts,
  discardDraft,
  discardDraftsOfRequests,
  getDraft,
  saveDraft,
} from '@/lib/drafts';

import type { Database } from '@/lib/db';
import type { DraftServer } from '@/lib/device-drafts';
import type { Executor } from '@/lib/params';

/**
 * The route's Server Actions of the device named `originDevice`, each calling the server
 * operation of `drafts` on `executor`, the session check left out (IHM-42, CL-DSN-17,
 * CL-DSN-22).
 */
export function draftServerOf(executor: Executor, originDevice: string): DraftServer {
  return {
    check: async (sent) => checkDeviceDrafts(executor, sent),
    load: async (target) => getDraft(executor, target),
    save: async (upload) => saveDraft(executor, { ...upload, originDevice }),
    discard: async (target) => discardDraft(executor, target),
  };
}

/**
 * What a withdrawal does to the drafts, in one transaction: discards the server copies of
 * the import drafts of `requestIds` and grows the withdrawn-events counter by one
 * (CL-DSN-22, DSN-29).
 */
export async function withdrawDrafts(db: Database, requestIds: readonly number[]): Promise<void> {
  await db.transaction(async (tx) => {
    await discardDraftsOfRequests(tx, requestIds);
    await tx
      .insert(withdrawnEventCounter)
      .values({ value: 1 })
      .onConflictDoUpdate({
        target: withdrawnEventCounter.id,
        set: { value: sql`${withdrawnEventCounter.value} + 1` },
      });
  });
}
