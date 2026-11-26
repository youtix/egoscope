// What a device and the server tell each other about drafts (IHM-42, CL-DSN-22): plain
// values, which cross the boundary of a Server Action.
import type { DraftTarget } from './draft-target';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/**
 * A device copy sent to the server: its text, the instant it was typed at, so that it
 * expires on its own schedule, and the withdrawn-events counter the device last received
 * before it was typed, `null` before any contact (IHM-42, CL-DSN-22).
 */
export type DraftUpload = Readonly<{
  target: DraftTarget;
  text: string;
  updatedAt: EpochMs;
  knownWithdrawnEventCount: number | null;
}>;

/**
 * Why the server refused a copy: a text above `imports.maxPastedTextMegabytes`, with the
 * glossary's message (CL-IMP-27); a text holding a NUL character, which the database cannot
 * keep, so that the device keeps it alone (DSN-32); an import copy typed before the
 * counter grew, which the device discards (CL-DSN-22); a request or a proposal that no
 * longer exists (CL-DSN-17).
 */
export type SaveDraftError =
  | Readonly<{ kind: 'text_too_large'; message: string }>
  | Readonly<{ kind: 'unstorable_text' }>
  | Readonly<{ kind: 'events_withdrawn'; withdrawnEventCount: number }>
  | Readonly<{ kind: 'target_gone' }>;

/**
 * A copy the server accepted: the counter at that instant (CL-DSN-22), whether it wrote it,
 * `false` when the server holds a later change, which it keeps, and an instant. When the
 * copy was written, `updatedAt` is the instant the server stored as the copy's last change,
 * never later than the server's clock, which the device keeps for its sent copy so that both
 * copies compare on the server's instants (CL-DSN-17). When it was not, the server stored
 * nothing: `updatedAt` is the upload's own instant clamped to the server's clock, which the
 * device ignores.
 */
export type SavedCopy = Readonly<{
  withdrawnEventCount: number;
  wasWritten: boolean;
  updatedAt: EpochMs;
}>;

/** The server's answer to a device's copy: accepted, or refused and why (IHM-42, CL-DSN-17, CL-DSN-22). */
export type SaveDraftResult = Result<SavedCopy, SaveDraftError>;

/** The server copy of a draft, for the screen of another device (IHM-42, CL-DSN-17). */
export type StoredDraft = Readonly<{ text: string; updatedAt: EpochMs; originDevice: string }>;

/**
 * The server's answer about a copy that the device had sent: the last change of its server
 * copy, `null` when there is none, so that the device takes a later change made on another
 * device (IHM-42, CL-DSN-17), and whether its request is imported (CL-DSN-22).
 */
export type SentCopyStatus = Readonly<{
  target: DraftTarget;
  updatedAt: EpochMs | null;
  requestImported: boolean;
}>;

/**
 * The server's answer at a device's contact: the withdrawn-events counter, the retention,
 * and the status of each copy the device had sent, naming no other request (CL-DSN-22,
 * CL-IHM-11).
 */
export type DraftCheck = Readonly<{
  withdrawnEventCount: number;
  retentionDays: number;
  copies: readonly SentCopyStatus[];
}>;

/**
 * The route's Server Actions that a draft screen gives `usePasteDraft`: each checks the
 * session and calls the matching server operation; a call that fails, offline or with an
 * expired session, rejects, and the device keeps its copy (IHM-42, IHM-58).
 */
export type DraftServer = Readonly<{
  check: (sent: readonly DraftTarget[]) => Promise<DraftCheck>;
  load: (target: DraftTarget) => Promise<StoredDraft | null>;
  save: (upload: DraftUpload) => Promise<SaveDraftResult>;
  discard: (target: DraftTarget) => Promise<void>;
}>;
