import { incidents } from '@/lib/db';

import type { taskRuns } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/**
 * The complete list of incident kinds, the glossary's `IncidentKind` (section 9.2; module
 * map §2.1): incidents, and the warnings and reminders handled like them. The failed
 * messages of TEL-36 are a banner, not an incident.
 */
export const INCIDENT_KINDS = incidents.kind.enumValues;

/** A kind of incident (TRV-45). */
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** The "{service function}" of a quota incident, the glossary's `ServiceRole` (TRV-05, TRV-09). */
export type ServiceRole = (typeof incidents.serviceRole.enumValues)[number];

/** A cause that a `quota_reached` incident names, the glossary's `QuotaIncidentCause` (CL-TRV-11). */
export type QuotaIncidentCause = (typeof incidents.$inferSelect.quotaCauses)[number];

/**
 * Why the stats source is unavailable: it has not answered for the delay of STA-37, or it
 * was late on consecutive competition days, "not refreshed since …" (CL-TRV-23). Each is a
 * cause of its own, which closes on its own recovery.
 */
export type StatsSourceUnavailableCause = 'not_answering' | 'source_late';

type TaskKey = (typeof taskRuns.$inferSelect)['taskKey'];
type QuotaKind = Extract<IncidentKind, 'quota_reached' | 'quota_warning'>;
type PressSourceKind = Extract<
  IncidentKind,
  'press_source_down' | 'press_source_silent' | 'feed_too_short'
>;
type OneCauseKind = Exclude<
  IncidentKind,
  QuotaKind | PressSourceKind | 'stats_source_unavailable' | 'task_not_run' | 'backup_failed'
>;

/**
 * One cause of an incident, which tells two incidents of a kind apart (operations.md §1.3):
 * the service of a quota incident, whichever limit or refusal caused it (CL-TRV-11), the
 * stats source's cause, the task, the backup failure cause (CL-TRV-04), the press source;
 * the other kinds have one cause each.
 */
export type IncidentCause =
  | Readonly<{ kind: 'quota_reached'; serviceRole: ServiceRole }>
  | Readonly<{ kind: 'quota_warning'; serviceRole: ServiceRole }>
  | Readonly<{ kind: 'stats_source_unavailable'; cause: StatsSourceUnavailableCause }>
  | Readonly<{ kind: 'task_not_run'; task: TaskKey }>
  | Readonly<{ kind: 'backup_failed'; cause: string }>
  | Readonly<{ kind: PressSourceKind; pressSourceId: number }>
  | Readonly<{ kind: OneCauseKind }>;

/** At least one cause of a quota incident, which its message names. */
export type QuotaCauses = readonly [QuotaIncidentCause, ...QuotaIncidentCause[]];

/**
 * The opening of a `quota_reached` incident with its causes; the language model's is the
 * one classification incident, which keeps the number of eligible articles when it opens
 * (CL-DET-04, CL-DET-05; DET-11).
 */
type QuotaReachedOpening =
  | Readonly<{
      kind: 'quota_reached';
      serviceRole: 'language_model';
      quotaCauses: QuotaCauses;
      waitingArticles: number;
    }>
  | Readonly<{
      kind: 'quota_reached';
      serviceRole: Exclude<ServiceRole, 'language_model'>;
      quotaCauses: QuotaCauses;
    }>;

/**
 * What opens an incident: its cause, with what a quota incident names, and `since`, when
 * the cause began if a delay passed before the incident opens, as the 12 hours of failures
 * of STA-37 (CA-TRV-14); now otherwise.
 */
export type IncidentOpening = (
  Exclude<IncidentCause, Readonly<{ kind: 'quota_reached' }>> | QuotaReachedOpening
) &
  Readonly<{ since?: EpochMs }>;

// The kinds whose level is a warning, and the one reminder; every other kind is an incident.
const WARNING_KINDS: ReadonlySet<IncidentKind> = new Set<IncidentKind>([
  'press_source_silent',
  'feed_too_short',
  'quota_warning',
  'database_volume_warning',
]);
const REMINDER_KIND: IncidentKind = 'export_reminder';

/** How the owner meets an incident: a level fixed per kind, never stored (glossary 9.2). */
export function levelOf(kind: IncidentKind): 'incident' | 'warning' | 'reminder' {
  if (kind === REMINDER_KIND) {
    return 'reminder';
  }
  return WARNING_KINDS.has(kind) ? 'warning' : 'incident';
}

/** The `cause_key` that stores `cause`: empty for a kind of one cause (operations.md §1.3). */
export function causeKeyOf(cause: IncidentCause): string {
  if ('serviceRole' in cause) {
    return cause.serviceRole;
  }
  if ('pressSourceId' in cause) {
    return String(cause.pressSourceId);
  }
  if ('task' in cause) {
    return cause.task;
  }
  return 'cause' in cause ? cause.cause : '';
}
