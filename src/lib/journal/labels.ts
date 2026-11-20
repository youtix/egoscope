// The English words of the journal's entries. From the glossary, as it writes them: the
// category and level labels and the service-role labels (section 4.1), the task names
// (section 9.1) and the incident names (section 9.2); and, with their first letter in
// lower case, the labels of the refusals, causes and notification categories that a
// message names inside a sentence. The journal's own words name the run triggers, the
// services and the Telegram conversations inside a sentence. Each table lists the codes
// of its stored set as pairs, code then words; the tests compare them with the glossary.
import type {
  IncidentKind,
  JournalEntryCategory,
  JournalLevel,
  ServiceRole,
  TaskKey,
  TaskRunTrigger,
} from './entries';

/** How a stranger's Telegram update reached the bot: the kind of its conversation (CL-TRV-21). */
export type ConversationKind = 'private' | 'group' | 'channel';

/** The words of each code of one stored set. */
export type Words<K extends string> = ReadonlyMap<K, string>;

/** A table of words, code then words; `K`, when not given, is the union of its codes. */
function words<const K extends string>(pairs: readonly (readonly [K, string])[]): Words<K> {
  return new Map(pairs);
}

/** The words of `code`, which its table holds for every code of its set (a test says so). */
export function wordsFor<K extends string>(table: Words<K>, code: K): string {
  const found = table.get(code);
  if (found === undefined) {
    throw new Error(`No words for the code ${code}.`);
  }
  return found;
}

/** The codes that `table` names, as the non-empty list that `z.enum` takes. */
export function codesOf<K extends string>(table: Words<K>): [K, ...K[]] {
  const [first, ...rest] = table.keys();
  if (first === undefined) {
    throw new Error('A table of words holds no code.');
  }
  return [first, ...rest];
}

export const CATEGORY_LABELS = words<JournalEntryCategory>([
  ['task_pass', 'Task'],
  ['profile_recalculation', 'Recalculation'],
  ['service_failure', 'Service failure'],
  ['incident', 'Incident'],
  ['user_action', 'Your action'],
  ['import_refused', 'Import refused'],
  ['parameter_change', 'Parameter change'],
  ['login_refused', 'Login refused'],
  ['login_lockout', 'Login locked'],
  ['telegram_message', 'Telegram message'],
  ['trigger_refused', 'Refused trigger'],
]);

export const LEVEL_LABELS = words<JournalLevel>([
  ['info', 'Info'],
  ['warning', 'Warning'],
  ['incident', 'Incident'],
]);

export const TASK_NAMES = words<TaskKey>([
  ['statistics-update', 'Schedule and statistics update'],
  ['statistics-fetch', 'Pending statistics fetch resumption'],
  ['calendar-derivation', 'Calendar derivation'],
  ['recalculation', 'Recalculation'],
  ['link-check', 'Link check'],
  ['purge', 'Data purge'],
  ['backup', 'Backup'],
  ['news-collection', 'News collection'],
  ['detection', 'Event detection'],
  ['classification-resume', 'Classification queue resumption'],
  ['game-tracking', 'Game tracking'],
  ['notification-dispatch', 'Notification sending'],
]);

export const TRIGGER_WORDS = words<TaskRunTrigger>([
  ['scheduled', 'scheduled'],
  ['on_demand', 'on-demand'],
]);

// Inside a sentence: "a call to the stats source failed".
export const SERVICE_WORDS = words<ServiceRole>([
  ['hosting', 'hosting'],
  ['database', 'database'],
  ['stats_source', 'stats source'],
  ['language_model', 'language model'],
  ['news_feeds', 'news feeds'],
  ['notifications', 'notification service'],
  ['trigger_service', 'task trigger'],
  ['backup_storage', 'backup storage'],
]);

// The labels of the service roles, which end the names of the quota incidents.
export const SERVICE_LABELS = words<ServiceRole>([
  ['hosting', 'Hosting'],
  ['database', 'Database'],
  ['stats_source', 'Stats source'],
  ['language_model', 'Language model'],
  ['news_feeds', 'News feeds'],
  ['notifications', 'Notifications'],
  ['trigger_service', 'Task trigger'],
  ['backup_storage', 'Backup storage'],
]);

// "Quota reached" and "Quota warning" are followed by their service: "Quota reached — Language model".
export const INCIDENT_NAMES = words<IncidentKind>([
  ['press_source_down', 'Press source down'],
  ['collection_impossible', 'Collection impossible'],
  ['press_source_silent', 'Silent press source'],
  ['feed_too_short', 'Add a collection time'],
  ['quota_reached', 'Quota reached'],
  ['quota_warning', 'Quota warning'],
  ['database_volume_warning', 'Database volume warning'],
  ['stats_source_unavailable', 'Stats source unavailable'],
  ['stats_source_schema_changed', 'Stats source format changed'],
  ['task_not_run', 'Task not run'],
  ['backup_failed', 'Backup failed'],
  ['logins_refused', 'Logins refused'],
  ['telegram_link_broken', 'Telegram link broken'],
  ['export_reminder', 'Export reminder'],
]);

export const CONVERSATION_WORDS = words<ConversationKind>([
  ['private', 'a private chat'],
  ['group', 'a group'],
  ['channel', 'a channel'],
]);

// Why a pasted research result was refused in full (`BlockingErrorKind`, CL-IMP-33).
export const BLOCKING_ERROR_WORDS = words([
  ['text_too_large', 'text too large'],
  ['no_result_found', 'no recognizable result'],
  ['several_results', 'several results pasted'],
  ['syntax_error', 'JSON syntax error'],
  ['cut_not_recoverable', 'result cut'],
  ['unknown_version', 'unknown format version'],
  ['not_a_backtest_result', 'not a backtest result'],
  ['other_request', 'result for another request'],
  ['player_not_found', 'player not found'],
  ['covered_types_invalid', 'covered types missing or not requested'],
  ['covered_period_invalid', 'covered period invalid'],
  ['events_missing', 'events list missing'],
]);

// What made a recalculation necessary (`VerdictChangeCause`, SEN-37).
export const CAUSE_WORDS = words([
  ['new_cases', 'new cases'],
  ['stats_correction', 'statistics correction'],
  ['baseline_updated', 'baseline updated'],
  ['manual_decision', 'manual decision'],
  ['event_dismissed', 'event dismissed'],
  ['parameter_change', 'parameter change'],
  ['recalculation', 'recalculation'],
  ['event_corrected_or_removed', 'event corrected or removed'],
  ['event_reinstated', 'event reinstated'],
  ['taxonomy_changed', 'taxonomy changed'],
]);

// The category of a Telegram message (`NotificationCategory`, TEL-24).
export const NOTIFICATION_CATEGORY_WORDS = words([
  ['backtest_requests', 'backtest requests'],
  ['alerts', 'alerts'],
  ['tracked_results', 'tracked results'],
  ['type_proposals', 'type proposals'],
  ['incidents', 'incidents'],
]);
