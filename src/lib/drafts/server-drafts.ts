import 'server-only';

import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import { checkPastedTextSize } from '@/lib/ai-exchange';
import { backtestRequests, drafts, eventTypes, withdrawnEventCounter } from '@/lib/db';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';

import { expiredSince } from './draft-target';

import type { DraftUpload, SaveDraftResult, StoredDraft } from './contract';
import type { DraftTarget } from './draft-target';
import type { Executor } from '@/lib/params';
import type { SQL } from 'drizzle-orm';

/** The rows of a draft's target (CL-DSN-17). */
function ofTarget(target: DraftTarget): SQL | undefined {
  if (target.kind === 'research_result') {
    return and(eq(drafts.kind, 'research_result'), eq(drafts.backtestRequestId, target.requestId));
  }
  return and(
    eq(drafts.kind, 'exploration_response'),
    target.eventTypeId === null
      ? isNull(drafts.explorationEventTypeId)
      : eq(drafts.explorationEventTypeId, target.eventTypeId),
  );
}

/** The withdrawn-events counter, 0 before its first row (DSN-29, CL-DSN-22). */
export async function withdrawnEventCount(executor: Executor): Promise<number> {
  const [counter] = await executor
    .select({ value: withdrawnEventCounter.value })
    .from(withdrawnEventCounter);
  return counter?.value ?? 0;
}

/** Says whether the request or the proposal of a draft still exists (CL-DSN-17). */
async function doesTargetExist(executor: Executor, target: DraftTarget): Promise<boolean> {
  if (target.kind === 'research_result') {
    const requests = await executor
      .select({ id: backtestRequests.id })
      .from(backtestRequests)
      .where(eq(backtestRequests.id, target.requestId));
    return requests.length > 0;
  }
  if (target.eventTypeId === null) {
    return true;
  }
  const types = await executor
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(eq(eventTypes.id, target.eventTypeId));
  return types.length > 0;
}

/**
 * Keeps a device's copy as the server copy of its draft, the one other record of the
 * pasted text, so that another device can resume it (IHM-42, DSN-32, CL-DSN-17). The copy
 * keeps the instant it was typed at, never later than now, and the device it came from;
 * no journal entry or log line holds its text (CL-IHM-10). Refuses a text above
 * `imports.maxPastedTextMegabytes` (CL-IMP-27), a request or proposal that no longer
 * exists, and an import copy typed before the withdrawn-events counter grew (CL-DSN-22).
 */
export async function saveDraft(
  executor: Executor,
  upload: DraftUpload & Readonly<{ originDevice: string }>,
): Promise<SaveDraftResult> {
  const size = checkPastedTextSize(
    upload.text,
    await getParam(executor, 'imports.maxPastedTextMegabytes'),
  );
  if (!size.ok) {
    return size;
  }
  if (!(await doesTargetExist(executor, upload.target))) {
    return err({ kind: 'target_gone' });
  }
  const count = await withdrawnEventCount(executor);
  const known = upload.knownWithdrawnEventCount;
  if (upload.target.kind === 'research_result' && (known === null || count > known)) {
    return err({ kind: 'events_withdrawn', withdrawnEventCount: count });
  }
  const copy = {
    text: upload.text,
    updatedAt: new Date(Math.min(upload.updatedAt, now())),
    originDevice: upload.originDevice,
  };
  const inserted = await executor
    .insert(drafts)
    .values({
      ...copy,
      kind: upload.target.kind,
      backtestRequestId: upload.target.kind === 'research_result' ? upload.target.requestId : null,
      explorationEventTypeId:
        upload.target.kind === 'exploration_response' ? upload.target.eventTypeId : null,
    })
    .onConflictDoNothing()
    .returning({ id: drafts.id });
  if (inserted.length === 0) {
    await executor.update(drafts).set(copy).where(ofTarget(upload.target));
  }
  return ok({ withdrawnEventCount: count });
}

/**
 * The server copy of a draft, from whichever device typed it, or `null` when there is
 * none or it has expired, since an expired draft is never shown again (IHM-42, CL-IHM-11).
 */
export async function getDraft(
  executor: Executor,
  target: DraftTarget,
): Promise<StoredDraft | null> {
  const [row] = await executor
    .select({ text: drafts.text, updatedAt: drafts.updatedAt, originDevice: drafts.originDevice })
    .from(drafts)
    .where(ofTarget(target));
  if (row === undefined) {
    return null;
  }
  const updatedAt = toEpochMs(row.updatedAt.getTime());
  const retentionDays = await getParam(executor, 'display.draftRetentionDays');
  return updatedAt <= expiredSince(now(), retentionDays)
    ? null
    : { text: row.text, updatedAt, originDevice: row.originDevice };
}

/**
 * Deletes the server copy of a draft: the owner discarded it, or its import or its
 * proposals are saved, in the caller's transaction (IHM-42, DSN-32).
 */
export async function discardDraft(executor: Executor, target: DraftTarget): Promise<void> {
  await executor.delete(drafts).where(ofTarget(target));
}

/**
 * Deletes the server copies of the import drafts of `requestIds`, in the caller's
 * transaction, for a withdrawal: no journal entry, which would designate the player;
 * exploration drafts stay (CL-DSN-22, DSN-32).
 */
export async function discardDraftsOfRequests(
  executor: Executor,
  requestIds: readonly number[],
): Promise<void> {
  if (requestIds.length > 0) {
    await executor
      .delete(drafts)
      .where(
        and(eq(drafts.kind, 'research_result'), inArray(drafts.backtestRequestId, [...requestIds])),
      );
  }
}

/**
 * Deletes every server copy, the restore's last step, in its transaction; each device
 * erases its copies at its next contact, which the session ending `restored` tells it
 * (CL-TRV-05, CL-TRV-06, CL-DSN-17).
 */
export async function eraseAllDrafts(executor: Executor): Promise<void> {
  await executor.delete(drafts).where(isNotNull(drafts.id));
}

/**
 * Deletes the server copies whose last change is `display.draftRetentionDays` old or
 * more, for the daily purge, and returns how many went (IHM-42, CL-IHM-11, TRV-25).
 */
export async function purgeExpired(executor: Executor): Promise<number> {
  const retentionDays = await getParam(executor, 'display.draftRetentionDays');
  const cutoff = new Date(expiredSince(now(), retentionDays));
  const purged = await executor
    .delete(drafts)
    .where(lte(drafts.updatedAt, cutoff))
    .returning({ id: drafts.id });
  return purged.length;
}
