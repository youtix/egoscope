import { listOpen } from '@/lib/incidents';
import { sentence } from '@/lib/wording';

import type { Database, Transaction } from '@/lib/db';
import type { Lot } from '@/lib/env';
import type { IncidentKind, OpenIncident, ServiceRole } from '@/lib/incidents';
import type { EpochMs } from '@/lib/time';

type Reader = Database | Transaction;

/** The object a to-do item of the incidents section opens: the incident, by its identifier. */
export type IncidentRef = Readonly<{ kind: 'incident'; id: number }>;

/**
 * An open incident in the to-do list: what it is, since when it is open and what it
 * costs the owner, in plain English (IHM-20, TRV-42).
 */
export type IncidentTodoItem = Readonly<{
  ref: IncidentRef;
  incidentKind: IncidentKind;
  serviceRole: ServiceRole | null;
  startedAt: EpochMs;
  consequence: string;
}>;

/** The incidents section: the visible incidents and the count of hidden ones (IHM-20). */
export type IncidentsSection = Readonly<{
  items: readonly IncidentTodoItem[];
  hiddenCount: number;
}>;

// The consequence of each kind, by its fixed sentence: every kind has one.
const CONSEQUENCES: ReadonlyMap<IncidentKind, () => string> = new Map<IncidentKind, () => string>([
  ['press_source_down', () => sentence('interface.incidentConsequencePressSourceDown')],
  ['collection_impossible', () => sentence('interface.incidentConsequenceCollectionImpossible')],
  ['press_source_silent', () => sentence('interface.incidentConsequencePressSourceSilent')],
  ['feed_too_short', () => sentence('interface.incidentConsequenceFeedTooShort')],
  ['quota_reached', () => sentence('interface.incidentConsequenceQuotaReached')],
  ['quota_warning', () => sentence('interface.incidentConsequenceQuotaWarning')],
  ['database_volume_warning', () => sentence('interface.incidentConsequenceDatabaseVolumeWarning')],
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
  ['telegram_link_broken', () => sentence('interface.incidentConsequenceTelegramLinkBroken')],
  ['export_reminder', () => sentence('interface.incidentConsequenceExportReminder')],
]);

// The kinds that only Lot 2 opens: they appear in the list only when Lot 2 is active (IHM-20).
const LOT_2_KINDS: ReadonlySet<IncidentKind> = new Set<IncidentKind>([
  'press_source_down',
  'collection_impossible',
  'press_source_silent',
  'feed_too_short',
  'telegram_link_broken',
]);
const LOT_2: Lot = 2;

function consequenceOf(kind: IncidentKind): string {
  const write = CONSEQUENCES.get(kind);
  if (write === undefined) {
    throw new Error(`No consequence is written for the incident kind ${kind}.`);
  }
  return write();
}

function toItem(incident: OpenIncident): IncidentTodoItem {
  return {
    ref: { kind: 'incident', id: incident.id },
    incidentKind: incident.kind,
    serviceRole: incident.serviceRole,
    startedAt: incident.openedAt,
    consequence: consequenceOf(incident.kind),
  };
}

/**
 * The incidents section of the to-do list: the open incidents of the active lot, oldest
 * first, each with its start date and its consequence, without the hidden ones, which
 * the section counts instead (IHM-20, TRV-45, CL-IHM-20). A Lot 2 cause appears only
 * when Lot 2 is active.
 */
export async function incidentsSection(db: Reader, lot: Lot): Promise<IncidentsSection> {
  const opened = await listOpen(db);
  const open = opened.filter((incident) => lot === LOT_2 || !LOT_2_KINDS.has(incident.kind));
  return {
    items: open
      .filter((incident) => incident.hiddenAt === null)
      .map((incident) => toItem(incident)),
    hiddenCount: open.filter((incident) => incident.hiddenAt !== null).length,
  };
}
