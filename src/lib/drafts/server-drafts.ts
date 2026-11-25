import 'server-only';

import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import { checkPastedTextSize } from '@/lib/ai-exchange';
import { backtestRequests, drafts, eventTypes, withdrawnEventCounter } from '@/lib/db';
import { canStoreText, expiredSince } from '@/lib/device-drafts';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';

import type { DraftTarget, DraftUpload, SaveDraftResult, StoredDraft } from '@/lib/device-drafts';
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

/** A copy that `didWriteCopy` keeps: its text, the instant it was typed at and its device. */
type WrittenCopy = Readonly<{ text: string; updatedAt: Date; originDevice: string }>;

/**
 * Writes `copy` as the server copy of `target`'s draft, unless the server holds a later
 * change, since a draft keeps its last change, and says whether it wrote it (CL-DSN-17). A failed query carries every
 * parameter in its message, the pasted text among them, and Next.js logs the error of a
 * Server Action: the failure leaves this module as an error that names no parameter and
 * keeps no cause (DSN-32, CL-IHM-10).
 */
async function didWriteCopy(
  executor: Executor,
  target: DraftTarget,
  copy: WrittenCopy,
): Promise<boolean> {
  try {
    const inserted = await executor
      .insert(drafts)
      .values({
        ...copy,
        kind: target.kind,
        backtestRequestId: target.kind === 'research_result' ? target.requestId : null,
        explorationEventTypeId: target.kind === 'exploration_response' ? target.eventTypeId : null,
      })
      .onConflictDoNothing()
      .returning({ id: drafts.id });
    if (inserted.length > 0) {
      return true;
    }
    // A copy typed before the one the server holds, which arrives late, replaces nothing.
    const updated = await executor
      .update(drafts)
      .set(copy)
      .where(and(ofTarget(target), lte(drafts.updatedAt, copy.updatedAt)))
      .returning({ id: drafts.id });
    return updated.length > 0;
  } catch {
    // The query's error holds the pasted text: none of it may reach a log.
    throw new Error('The server copy of a draft could not be written.');
  }
}

/**
 * Keeps a device's copy as the server copy of its draft, the one other record of the
 * pasted text, so that another device can resume it (IHM-42, DSN-32, CL-DSN-17). The copy
 * keeps the instant it was typed at, never later than now, and the device it came from,
 * unless the server holds a later change, which it keeps and says so; no journal entry, log line or error holds its text (CL-IHM-10). Refuses a text above
 * `imports.maxPastedTextMegabytes` (CL-IMP-27), a text holding a NUL character, which the
 * database cannot keep and the device then keeps alone, a request or proposal that no
 * longer exists, and an import copy typed before the withdrawn-events counter grew
 * (CL-DSN-22).
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
  if (!canStoreText(upload.text)) {
    return err({ kind: 'unstorable_text' });
  }
  if (!(await doesTargetExist(executor, upload.target))) {
    return err({ kind: 'target_gone' });
  }
  const count = await withdrawnEventCount(executor);
  // A copy typed before any contact may predate a withdrawal, unless none ever happened.
  const known = upload.knownWithdrawnEventCount ?? 0;
  if (upload.target.kind === 'research_result' && count > known) {
    return err({ kind: 'events_withdrawn', withdrawnEventCount: count });
  }
  const updatedAt = toEpochMs(Math.min(upload.updatedAt, now()));
  const wasWritten = await didWriteCopy(executor, upload.target, {
    text: upload.text,
    updatedAt: new Date(updatedAt),
    originDevice: upload.originDevice,
  });
  return ok({ withdrawnEventCount: count, wasWritten, updatedAt });
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
