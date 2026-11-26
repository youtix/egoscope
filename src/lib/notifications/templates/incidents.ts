// The incident messages (TEL-15, CL-TEL-04, CL-TEL-08) and the export reminder (TRV-54,
// H-TEL-07).

import { formatDuration } from '@/lib/time';
import { formatCount, sentence } from '@/lib/wording';

import {
  clock,
  firstLine,
  gameText,
  link,
  LIST_SEPARATOR,
  message,
  plain,
  writtenFor,
} from './text';

import type {
  ExportReminderData,
  IncidentData,
  IncidentEndData,
  NotifiedIncidentKind,
} from './data';
import type { QuotaIncidentCause } from '@/lib/incidents';

// The names of the incidents after "Incident —" (glossary section 9.2), the quota's naming
// its service.
const INCIDENT_NAMES: ReadonlyMap<
  Exclude<NotifiedIncidentKind, 'quota_reached'>,
  () => string
> = new Map<Exclude<NotifiedIncidentKind, 'quota_reached'>, () => string>([
  ['press_source_down', () => sentence('notifications.pressSourceDown')],
  ['collection_impossible', () => sentence('notifications.collectionImpossible')],
  ['press_source_silent', () => sentence('notifications.pressSourceSilent')],
  ['stats_source_unavailable', () => sentence('notifications.statsSourceUnavailable')],
  ['stats_source_schema_changed', () => sentence('notifications.statsSourceFormatChanged')],
  ['task_not_run', () => sentence('notifications.taskNotRun')],
  ['backup_failed', () => sentence('notifications.backupFailed')],
  ['logins_refused', () => sentence('notifications.loginsRefused')],
]);
// What each incident means for the owner (TEL-15, glossary section 7.6).
const CONSEQUENCES: ReadonlyMap<NotifiedIncidentKind, () => string> = new Map<
  NotifiedIncidentKind,
  () => string
>([
  ['press_source_down', () => sentence('interface.incidentConsequencePressSourceDown')],
  ['collection_impossible', () => sentence('interface.incidentConsequenceCollectionImpossible')],
  ['press_source_silent', () => sentence('interface.incidentConsequencePressSourceSilent')],
  ['quota_reached', () => sentence('interface.incidentConsequenceQuotaReached')],
  [
    'stats_source_unavailable',
    () => sentence('interface.incidentConsequenceStatsSourceUnavailable'),
  ],
  [
    'stats_source_schema_changed',
    () => sentence('interface.incidentConsequenceStatsSourceSchemaChanged'),
  ],
  ['task_not_run', () => sentence('interface.incidentConsequenceTaskNotRun')],
  ['backup_failed', () => sentence('interface.incidentConsequenceBackupFailed')],
  ['logins_refused', () => sentence('interface.incidentConsequenceLoginsRefused')],
]);
// The cause of a classification quota incident (DET-11, CL-DET-05).
const CAUSES: ReadonlyMap<QuotaIncidentCause, () => string> = new Map<
  QuotaIncidentCause,
  () => string
>([
  ['limit_reached', () => sentence('notifications.causeLimitReached')],
  ['refused_before_limit', () => sentence('notifications.causeRefusedBeforeLimit')],
  ['not_answering', () => sentence('notifications.causeNotAnswering')],
]);

/** The incident's nature after "Incident —", by the function it touches (TEL-15, Q-02). */
function nature(kind: NotifiedIncidentKind, subjects: readonly string[]): string {
  return kind === 'quota_reached'
    ? sentence('notifications.quotaReachedFor', { service: subjects.join(LIST_SEPARATOR) })
    : writtenFor(INCIDENT_NAMES, kind);
}

/** The sources or services touched, which the quota's nature already names. */
function affectedLine(kind: NotifiedIncidentKind, subjects: readonly string[]): string | null {
  if (kind === 'quota_reached' || subjects.length === 0) {
    return null;
  }
  const affected = subjects.join(LIST_SEPARATOR);
  return plain(sentence('notifications.incidentAffected', { subjects: affected }));
}

/** The press sources for a source down, the journal filtered on the incident otherwise (TEL-15). */
const incidentLink = (kind: NotifiedIncidentKind, url: string): string =>
  link(
    url,
    kind === 'press_source_down'
      ? sentence('notifications.seeSources')
      : sentence('notifications.seeJournal'),
  );

/** The items of a classification quota incident (DET-11, CL-DET-05, CL-TEL-04). */
function classificationLines(
  classification: NonNullable<IncidentData['classification']>,
  zone: string,
): readonly (string | null)[] {
  const nearest = classification.nearestPlayer;
  const resume = classification.plannedResumeAt;
  const waiting = formatCount(classification.waitingArticles);
  const nearestLine =
    nearest === null
      ? sentence('notifications.noNearestPlayer')
      : sentence('notifications.nearestPlayer', {
          player: nearest.playerName,
          game: gameText(nearest.game, zone),
        });
  const resumeLine =
    resume === null
      ? null
      : plain(sentence('notifications.plannedResume', { at: clock(resume, zone) }));
  return [
    plain(sentence('notifications.waitingArticles', { n: waiting })),
    plain(nearestLine),
    resumeLine,
    plain(writtenFor(CAUSES, classification.cause)),
  ];
}

/**
 * The start of an incident, or its reminder: its nature, since when, what it touches and
 * what it means, the items of a classification quota, and the link (TEL-15, CL-TEL-04).
 */
export function incident(data: IncidentData, zone: string): string {
  const kind = data.incidentKind;
  const title = sentence('notifications.incidentTitle', { nature: nature(kind, data.subjects) });
  const since = sentence('notifications.incidentSince', { at: clock(data.since, zone) });
  const classification =
    data.classification === null ? [] : classificationLines(data.classification, zone);
  return message([
    firstLine(title),
    plain(since),
    affectedLine(kind, data.subjects),
    plain(writtenFor(CONSEQUENCES, kind)),
    ...classification,
    incidentLink(kind, data.url),
  ]);
}

/**
 * The end of an incident whose start was sent: the interruption from start to end with its
 * length (TEL-15, CL-TEL-08).
 */
export function incidentEnd(data: IncidentEndData, zone: string): string {
  const kind = data.incidentKind;
  const title = sentence('notifications.incidentResolvedTitle', {
    nature: nature(kind, data.subjects),
  });
  const interruption = sentence('notifications.interruption', {
    start: clock(data.startedAt, zone),
    end: clock(data.endedAt, zone),
    duration: formatDuration(data.endedAt - data.startedAt),
  });
  return message([
    firstLine(title),
    plain(interruption),
    affectedLine(kind, data.subjects),
    incidentLink(kind, data.url),
  ]);
}

/**
 * The reminder to export the data: the last full export, or none yet, and the link to the
 * export (TRV-54, H-TEL-07).
 */
export function exportReminder(data: ExportReminderData, zone: string): string {
  const last = data.lastExportAt;
  const title = sentence('notifications.incidentTitle', {
    nature: sentence('notifications.exportReminder'),
  });
  const lastLine =
    last === null
      ? sentence('notifications.noExportYet')
      : sentence('notifications.lastExport', { at: clock(last, zone) });
  return message([
    firstLine(title),
    plain(lastLine),
    plain(sentence('interface.incidentConsequenceExportReminder')),
    link(data.exportUrl, sentence('notifications.openExport')),
  ]);
}
