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
 * glossary's message (CL-IMP-27); an import copy typed before the counter grew, which the
 * device discards (CL-DSN-22); a request or a proposal that no longer exists (CL-DSN-17).
 */
export type SaveDraftError =
  | Readonly<{ kind: 'text_too_large'; message: string }>
  | Readonly<{ kind: 'events_withdrawn'; withdrawnEventCount: number }>
  | Readonly<{ kind: 'target_gone' }>;

/** A copy saved on the server, with the counter at that instant (CL-DSN-22). */
export type SaveDraftResult = Result<Readonly<{ withdrawnEventCount: number }>, SaveDraftError>;

/** The server copy of a draft, for the screen of another device (IHM-42, CL-DSN-17). */
export type StoredDraft = Readonly<{ text: string; updatedAt: EpochMs; originDevice: string }>;

/** The server's answer about a copy that the device had sent (CL-DSN-22). */
export type SentCopyStatus = Readonly<{
  target: DraftTarget;
  exists: boolean;
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
