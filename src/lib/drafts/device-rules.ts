// What a device does with each of its copies at a contact with the server (CL-DSN-22,
// CL-IHM-11), judged from what the server answered alone.
import { draftExpiresAt, draftKey } from './draft-target';

import type { DraftCheck } from './contract';
import type { DeviceCopy } from './device-store';
import type { EpochMs } from '@/lib/time';

/**
 * The fate of a device copy: kept as it is; replaced by its server copy, which another
 * device changed later (IHM-42, CL-DSN-17); marked "Request already imported"; dropped,
 * expired or gone from the server; discarded unsent because events were withdrawn or
 * declined for sensitivity meanwhile; or sent (CL-DSN-22).
 */
export type CopyFate =
  'keep' | 'take_server' | 'mark_imported' | 'drop' | 'discard_unsent' | 'send';

/**
 * Says whether a device copy has expired at `at`, by the retention the device last
 * received; a device that never received one keeps its copies (CL-IHM-11).
 */
export function hasExpired(copy: DeviceCopy, retentionDays: number | null, at: EpochMs): boolean {
  return retentionDays !== null && draftExpiresAt(copy.updatedAt, retentionDays) <= at;
}

/**
 * Says whether the counter may have grown since the copy recorded it: it has, or the copy
 * recorded none and some event was ever withdrawn (CL-DSN-22).
 */
function hasCounterGrown(copy: DeviceCopy, check: DraftCheck): boolean {
  return check.withdrawnEventCount > (copy.withdrawnEventCount ?? 0);
}

/**
 * The fate of a copy the device had sent (CL-DSN-22): kept while its server copy exists,
 * replaced by it when it holds a later change (IHM-42, CL-DSN-17), and, once it is gone,
 * marked `request_already_imported` or dropped.
 */
function sentCopyFate(copy: DeviceCopy, check: DraftCheck): CopyFate {
  const status = check.copies.find((sent) => draftKey(sent.target) === copy.key);
  if (status === undefined) {
    return 'keep';
  }
  if (status.updatedAt !== null) {
    return status.updatedAt > copy.updatedAt ? 'take_server' : 'keep';
  }
  return status.requestImported && !hasCounterGrown(copy, check) ? 'mark_imported' : 'drop';
}

/**
 * The fate of `copy` at a contact whose answer is `check`, at `at` (CL-DSN-22, CL-IHM-11):
 * an expired copy goes; a sent copy stays while its server copy exists, unless that
 * server copy holds a later change, which the device takes (IHM-42, CL-DSN-17), is marked
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
  return sentCopyFate(copy, check);
}
