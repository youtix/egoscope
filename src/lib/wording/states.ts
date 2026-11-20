// The labels of every state the application shows: the common states of 00 (VUE-08)
// and every other state set of the specs, which the glossary names `…Status` (« état »,
// « statut », glossary section 2), with the UI labels of glossary section 4.1, in its
// order. A state whose UI label the glossary leaves out ("—", or a note such as
// "(the mark's label)") is never shown, so it has none here.
import { fill } from './template';

import type { FillArgs } from './template';

/** Each state set of glossary section 4.1, by its type name, and its states: code value, UI label. */
export const STATUS_LABELS = {
  // --- Players -------------------------------------------------------------------
  PlayerStatus: [
    ['active', 'Active'],
    ['paused', 'Paused'],
    ['withdrawn', 'Withdrawn'],
  ],
  PauseSuggestionStatus: [['suggested', 'Suggest pausing {player}']],
  StatsSourceMappingStatus: [
    ['to_establish', 'Mapping to establish'],
    ['established', 'Mapping established'],
  ],
  PlayerBacktestStatus: [
    ['never_requested', 'Never requested'],
    ['request_to_do', 'Request to do'],
    ['imported', 'Imported on {date}'],
    ['supplementary_request_to_do', 'Supplementary request to do'],
    ['full_redo_to_do', 'Full redo to do'],
  ],

  // --- Event types -----------------------------------------------------------------
  EventTypeStatus: [
    ['proposed', 'Proposed'],
    ['validated', 'Validated'],
    ['rejected', 'Rejected'],
    ['withdrawn', 'Withdrawn'],
  ],

  // --- Events (EventMarkStatus shows the mark's own label, never a state) ------------
  DetectedEventStatus: [
    ['detected', 'Detected'],
    ['dismissed', 'Dismissed'],
  ],

  // --- Cases -----------------------------------------------------------------------
  CaseStatus: [
    ['awaiting_game', 'Awaiting game'],
    ['measured', 'Measured'],
    ['excluded', 'Excluded (doubtful case)'],
    ['not_measurable', 'Not measurable'],
  ],

  // --- Backtest requests and import --------------------------------------------------
  BacktestRequestStatus: [
    ['to_do', 'To do'],
    ['imported', 'Imported'],
    ['canceled', 'Canceled'],
  ],
  LinkStatus: [['not_found', 'Not found']],
  ImportDraftStatus: [
    ['kept', 'Draft saved at {time}'],
    ['request_already_imported', 'Request already imported'],
  ],

  // --- Games and statistics ----------------------------------------------------------
  GameStatus: [
    ['scheduled', 'Scheduled'],
    ['in_progress', 'In progress'],
    ['final', 'Final'],
    ['postponed', 'Postponed'],
    ['canceled', 'Canceled'],
  ],
  BoxScoreStatus: [
    ['complete', 'Complete'],
    ['incomplete', 'Incomplete'],
    ['suspect', 'Suspect'],
    ['unavailable', 'Unavailable'],
  ],
  SeasonBaselineStatus: [
    ['final', 'Final'],
    ['provisional', 'Provisional'],
    ['building', 'Being built'],
    ['insufficient', 'Insufficient'],
  ],
  GapStatus: [
    ['provisional', 'Provisional'],
    ['final', 'Final'],
  ],

  // --- Press collection ----------------------------------------------------------------
  ActivationStatus: [
    ['active', 'Active'],
    ['deactivated', 'Deactivated'],
    ['withdrawn', 'Withdrawn'],
  ],
  HealthStatus: [
    ['never_read', 'Never read'],
    ['working', 'Working'],
    ['down', 'Down since {date}'],
    ['silent', 'Silent since {date}'],
  ],
  ArticleProcessingStatus: [
    ['to_analyze', 'To analyze'],
    ['awaiting_classification', 'Awaiting classification'],
    ['not_relevant', 'Not relevant'],
    ['attached', 'Attached'],
    ['linked_to_proposal', 'Linked to a proposal'],
  ],

  // --- Alert sheets ------------------------------------------------------------------
  AlertSheetStatus: [
    ['open', 'Open'],
    ['closed', 'Closed'],
    ['canceled', 'Canceled'],
  ],

  // --- Notifications -----------------------------------------------------------------
  TelegramLinkStatus: [
    ['not_linked', 'Not linked'],
    ['awaiting_confirmation', 'Awaiting confirmation'],
    ['linked', 'Linked since {date}'],
    ['broken', 'Broken'],
  ],
  NotificationMessageStatus: [
    ['to_send', 'To send'],
    ['deferred', 'Deferred'],
    ['sent', 'Sent'],
    ['grouped', 'Grouped'],
    ['discarded', 'Discarded'],
    ['failed', 'Failed'],
  ],

  // --- Operations --------------------------------------------------------------------
  IncidentStatus: [
    ['open', 'Open'],
    ['closed', 'Closed'],
  ],
  ServiceStatus: [
    ['normal', 'Normal'],
    ['degraded', 'Degraded'],
    ['unavailable', 'Unavailable'],
  ],
  QuotaStatus: [
    ['warning', 'Quota warning'],
    ['reached', 'Quota reached'],
  ],
  VolumeStatus: [['warning', 'Database volume warning']],
  AccountPasswordStatus: [['initial', 'Choose your password']],
  BackupStatus: [
    ['done', 'Done'],
    ['failed', 'Failed'],
  ],
  RequirementStatus: [
    ['done', 'Done'],
    ['partial', 'Partial'],
    ['not_done', 'Not done'],
  ],
} as const;

/** A state set of the glossary, by its type name: `'CaseStatus'`. */
export type StatusSet = keyof typeof STATUS_LABELS;

type Entry<S extends StatusSet> = (typeof STATUS_LABELS)[S][number];

/** A state of `S` that the application shows, by its stored code value: `'awaiting_game'`. */
export type StatusValue<S extends StatusSet> = Entry<S>[0];

type StatusLabel<S extends StatusSet, V extends StatusValue<S>> = Extract<
  Entry<S>,
  readonly [V, string]
>[1];

// The same table, read by its code values.
const SETS: Readonly<Record<string, readonly (readonly [string, string])[]>> = STATUS_LABELS;
const LABELS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(
  Object.entries(SETS).map(([set, states]) => [set, new Map(states)]),
);

/**
 * The one English label of a state (VUE-08, IHM-15, CL-VUE-02): "Paused" for the
 * player status `paused`, "Excluded (doubtful case)" for the case status `excluded`.
 * A label with a placeholder takes its value already written, a date through the
 * formatters of `@/lib/time`: `label('HealthStatus', 'down', { date })` gives
 * "Down since Wed 18 Nov 2026".
 */
export function label<S extends StatusSet, V extends StatusValue<S>>(
  set: S,
  value: V,
  ...values: FillArgs<StatusLabel<S, V>>
): string {
  const template = LABELS.get(set)?.get(value);
  if (template === undefined) {
    throw new Error(`The state ${set} ${value} has no label.`);
  }
  return fill(template, values);
}
