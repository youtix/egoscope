// What a device does with each of its copies at a contact with the server (CL-DSN-22,
// CL-IHM-11), judged from what the server answered alone.
import { draftExpiresAt, draftKey } from './draft-target';

import type { DraftCheck } from './contract';
import type { DeviceCopy } from './device-store';
import type { EpochMs } from '@/lib/time';

/**
 * The fate of a device copy: kept as it is; marked "Request already imported"; dropped,
 * expired or gone from the server; discarded unsent because events were withdrawn or
 * declined for sensitivity meanwhile; or sent (CL-DSN-22).
 */
export type CopyFate = 'keep' | 'mark_imported' | 'drop' | 'discard_unsent' | 'send';

/**
 * Says whether a device copy has expired at `at`, by the retention the device last
 * received; a device that never received one keeps its copies (CL-IHM-11).
 */
export function hasExpired(copy: DeviceCopy, retentionDays: number | null, at: EpochMs): boolean {
  return retentionDays !== null && draftExpiresAt(copy.updatedAt, retentionDays) <= at;
}

/** Says whether the counter has grown since the copy recorded it, or the copy recorded none. */
function hasCounterGrown(copy: DeviceCopy, check: DraftCheck): boolean {
  return copy.withdrawnEventCount === null || check.withdrawnEventCount > copy.withdrawnEventCount;
}

/**
 * The fate of `copy` at a contact whose answer is `check`, at `at` (CL-DSN-22, CL-IHM-11):
 * an expired copy goes; a sent copy stays while its server copy exists, is marked
 * `request_already_imported` when its request was imported meanwhile and the counter has
 * not grown, and is dropped otherwise; an import copy never sent is discarded when the
 * counter has grown, whatever its player, and is sent otherwise, as an exploration copy
 * always is.
 */
export function copyFate(copy: DeviceCopy, check: DraftCheck, at: EpochMs): CopyFate {
  if (hasExpired(copy, check.retentionDays, at)) {
    return 'drop';
  }
  if (!copy.sent) {
    return copy.target.kind === 'research_result' && hasCounterGrown(copy, check)
      ? 'discard_unsent'
      : 'send';
  }
  const status = check.copies.find((sent) => draftKey(sent.target) === copy.key);
  if (status === undefined || status.exists) {
    return 'keep';
  }
  return status.requestImported && !hasCounterGrown(copy, check) ? 'mark_imported' : 'drop';
}
