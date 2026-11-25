// What a draft belongs to and when it expires, shared by the server copy and the
// device copy (IHM-42, CL-DSN-17, CL-IHM-11).
import { toEpochMs } from '@/lib/time';

import type { EpochMs } from '@/lib/time';

/** The glossary's `DraftKind`: the text of a research result or of an exploration response (IHM-42, DSN-32). */
export type DraftKind = 'research_result' | 'exploration_response';

/** The glossary's `ImportDraftStatus` of a device copy (IHM-42, CL-DSN-22). */
export type ImportDraftStatus = 'kept' | 'request_already_imported';

/**
 * The one draft a screen keeps (CL-DSN-17): the import draft of a backtest request, or
 * the exploration draft of a targeted proposal, `null` for the general screen.
 */
export type DraftTarget =
  | Readonly<{ kind: 'research_result'; requestId: number }>
  | Readonly<{ kind: 'exploration_response'; eventTypeId: string | null }>;

// A day of the retention, 24 hours of absolute time.
const MS_PER_DAY = 86_400_000;

/** The key of a draft's target, the same for its device copy and its server copy (CL-DSN-17). */
export function draftKey(target: DraftTarget): string {
  return target.kind === 'research_result'
    ? `research_result:${String(target.requestId)}`
    : `exploration_response:${target.eventTypeId ?? ''}`;
}

/**
 * The instant a draft expires: `retentionDays` (the `display.draftRetentionDays`
 * parameter) after its last change, the only date it keeps (IHM-42, CL-IHM-11).
 */
export function draftExpiresAt(updatedAt: EpochMs, retentionDays: number): EpochMs {
  return toEpochMs(updatedAt + retentionDays * MS_PER_DAY);
}

/**
 * The last change at or before which a draft has expired at `at`: `retentionDays` before
 * it (IHM-42, CL-IHM-11).
 */
export function expiredSince(at: EpochMs, retentionDays: number): EpochMs {
  return toEpochMs(at - retentionDays * MS_PER_DAY);
}
