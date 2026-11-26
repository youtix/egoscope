// The data of each message kind, as the notifications domain model writes it (section 5):
// what the composer gathers and the templates write (TEL-04 to TEL-16, TEL-21).

import type { AlertSheetCaveatRow, AlertSheetExpectedGameRow, AlertSheetRow } from '@/lib/alerts';
import type { IncidentKind, QuotaIncidentCause } from '@/lib/incidents';
import type { EpochMs, IsoDate } from '@/lib/time';
import type { TrackedCaseRow, TrackedGameResultRow } from '@/lib/tracking';

type DatePrecision = 'exact' | 'approximate' | 'none';
export type CaveatKind = AlertSheetCaveatRow['kind'];
// A moved reference date sends no update (ALE-21, TEL-12): the other reasons of ALE-23.
export type ExpectedGameChangeReason = Exclude<
  NonNullable<AlertSheetExpectedGameRow['supersessionReason']>,
  'reference_date_moved'
>;
export type CaseCategory = NonNullable<TrackedCaseRow['category']>;
export type VerdictLevel = 'possible' | 'probable' | 'inconclusive';
export type VerdictDirection = 'increase' | 'decrease';
export type ProfileConfidence = 'low' | 'medium' | 'high';
// The incident kinds that a message announces (glossary section 9.2, "notified"), the export
// reminder having a message of its own.
export type NotifiedIncidentKind = Exclude<
  IncidentKind,
  | 'feed_too_short'
  | 'quota_warning'
  | 'database_volume_warning'
  | 'telegram_link_broken'
  | 'export_reminder'
>;

/** A game that a message names (CL-SUI-13, CL-IHM-07). */
export type MessageGame = Readonly<{
  gameId: number;
  scheduledStartAt: EpochMs;
  usDate: IsoDate;
  opponentName: string;
  isHome: boolean | null;
}>;

/** How a message designates an event: player, type and source, never its description (TEL-06). */
export type EventDesignation =
  | Readonly<{
      origin: 'detected';
      // null: a type marked « sujet intime », written "sensitive event" (DSN-35)
      typeName: string | null;
      source: Readonly<{ outletName: string; publishedAt: EpochMs; precision: DatePrecision }>;
    }>
  | Readonly<{ origin: 'calendar'; typeName: string; game: MessageGame }>;

/** A profile as an alert sheet froze it (SEN-38, TEL-11). */
export type MessageProfile = Readonly<{
  meanGap: number;
  rangeLow: number;
  rangeHigh: number;
  validCount: number;
  historicalCount: number;
  trackedCount: number;
  verdictLevel: VerdictLevel;
  direction: VerdictDirection | null;
  profileConfidence: ProfileConfidence;
}>;

/** The general trend of a type, shown below the case threshold (SEN-31). */
export type MessageTrend = Omit<MessageProfile, 'historicalCount' | 'trackedCount'> &
  Readonly<{ playerCount: number }>;

/** A request to do for a player who is not profiled (TEL-09). */
export type BacktestRequestToDoData = Readonly<{
  kind: 'backtest_request_to_do';
  playerName: string;
  teamName: string | null;
  event: EventDesignation;
  deadline: MessageGame | null;
  // null once tip-off has passed
  timeRemainingMs: number | null;
  tipOffPassed: boolean;
  isUrgent: boolean;
  requestUrl: string;
}>;

/** A new detected event that changes a request's deadline (CL-TEL-18). */
export type DeadlineChangedData = Readonly<{
  kind: 'deadline_changed';
  playerName: string;
  event: EventDesignation;
  deadline: MessageGame;
  // null once tip-off has passed
  timeRemainingMs: number | null;
  previousDeadlineStartAt: EpochMs | null;
  typeNotInRequest: boolean;
  tipOffPassed: boolean;
  isUrgent: boolean;
  requestUrl: string;
}>;

/** A detection-born request still to do before its deadline (TEL-10). */
export type DeadlineReminderData = Readonly<{
  kind: 'deadline_reminder';
  playerName: string;
  deadline: MessageGame;
  leadHours: number;
  isUrgent: boolean;
  requestUrl: string;
}>;

/** One section of an alert sheet: its type and its frozen values (TEL-11, SEN-31). */
export type AlertSection = Readonly<{
  typeName: string | null;
  values:
    | Readonly<{ kind: 'profile'; profile: MessageProfile }>
    | Readonly<{
        kind: 'below_threshold';
        validCount: number;
        threshold: number;
        trend: MessageTrend | null;
      }>;
}>;

/** An alert sheet produced for a profiled player (TEL-11, TEL-21). */
export type AlertData = Readonly<{
  kind: 'alert';
  sheetNumber: number;
  playerName: string;
  events: readonly EventDesignation[];
  sections: readonly AlertSection[];
  expectedGame: MessageGame | null;
  caveatKinds: readonly CaveatKind[];
  isLate: boolean;
  isUrgent: boolean;
  typeNotCovered: boolean;
  complementaryRequest: boolean;
  sheetUrl: string;
}>;

/** A useful change of an open alert sheet (TEL-12, CL-TEL-21). */
export type AlertUpdateData = Readonly<{
  kind: 'alert_update';
  sheetNumber: number;
  playerName: string;
  change:
    | Readonly<{ kind: 'new_event'; event: EventDesignation }>
    | Readonly<{
        kind: 'expected_game_changed';
        previousGame: MessageGame | null;
        reason: ExpectedGameChangeReason;
        expectedGame: MessageGame | null;
      }>
    | Readonly<{
        kind: 'event_no_longer_applies';
        typeName: string;
        game: MessageGame;
        reason: string;
      }>;
  sheetStatus: AlertSheetRow['status'];
  isUrgent: boolean;
  sheetUrl: string;
}>;

/** What a message reads of a tracked game result (tracking-and-validation.md §5.1). */
export type TrackedResultContent = Readonly<{
  kind: TrackedGameResultRow['kind'];
  normalizedGap: number | null;
  gapStatus: 'provisional' | 'final' | null;
  indicativeComparison: number | null;
  category: CaseCategory | null;
  recordedAfterTipOff: boolean;
  lateForecast: boolean;
  profile: Readonly<{
    validCount: number;
    meanGap: number;
    rangeLow: number;
    rangeHigh: number;
    verdictLevel: VerdictLevel;
    direction: VerdictDirection | null;
    verdictChanged: boolean;
  }>;
  noBacktestYet: boolean;
}>;

/** The result of one tracked game (TEL-13, CL-TEL-16). */
export type TrackedGameResultData = Readonly<{
  kind: 'tracked_game_result';
  playerName: string;
  game: Readonly<{ scheduledStartAt: EpochMs; usDate: IsoDate; opponentName: string }> | null;
  result: TrackedResultContent;
  // the reason that replaces the measurement
  statusReasonLabel: string | null;
  belowThreshold: Readonly<{ validCount: number; threshold: number }> | null;
  targetUrl: string;
  validationTableUrl: string;
}>;

/** A type that the detection proposes (TEL-14, CL-TEL-10). */
export type NewTypeProposalData = Readonly<{
  kind: 'new_type_proposal';
  // null: « texte non conservé » (CL-DET-18)
  name: string | null;
  definition: string | null;
  articleCount: number;
  proposedAt: EpochMs;
  typeUrl: string;
}>;

/** The start of an incident, or its reminder (TEL-15, CL-TEL-04). */
export type IncidentData = Readonly<{
  kind: 'incident_start' | 'incident_reminder';
  incidentKind: NotifiedIncidentKind;
  // the outlet names of the sources, or the service role's label
  subjects: readonly string[];
  since: EpochMs;
  // the classification quota incident only (DET-11, CL-DET-05)
  classification: Readonly<{
    waitingArticles: number;
    nearestPlayer: Readonly<{ playerName: string; game: MessageGame }> | null;
    plannedResumeAt: EpochMs | null;
    cause: QuotaIncidentCause;
  }> | null;
  url: string;
}>;

/** The end of an incident whose start was sent (TEL-15, CL-TEL-08). */
export type IncidentEndData = Readonly<{
  kind: 'incident_end';
  incidentKind: NotifiedIncidentKind;
  subjects: readonly string[];
  startedAt: EpochMs;
  endedAt: EpochMs;
  url: string;
}>;

/** The reminder to export the data (TRV-54, H-TEL-07). */
export type ExportReminderData = Readonly<{
  kind: 'export_reminder';
  lastExportAt: EpochMs | null;
  exportUrl: string;
}>;

/** One fact of a digest, on one line with its link (TEL-19). */
export type DigestLine = Readonly<{ text: string; afterTipOff: boolean; url: string }>;

/** A pass digest, the quiet-hours digest or the catch-up (TEL-19, TEL-20, CL-TEL-11, CL-TEL-12). */
export type DigestData = Readonly<{
  kind: 'pass_digest' | 'quiet_hours_digest' | 'catch_up';
  title:
    | Readonly<{ kind: 'pass'; taskName: string; passStartedAt: EpochMs }>
    | Readonly<{ kind: 'tracked_results'; count: number }>
    | Readonly<{ kind: 'quiet_hours'; from: string; to: string }>
    | Readonly<{ kind: 'catch_up'; periodStartAt: EpochMs; periodEndAt: EpochMs }>;
  lines: readonly DigestLine[];
  moreCount: number;
  homeUrl: string;
}>;

/** A message outside every category (TEL-16, CL-TEL-02, CL-TEL-07, CL-TEL-19). */
export type ServiceMessageData =
  | Readonly<{ kind: 'link_confirmation'; settingsUrl: string }>
  | Readonly<{ kind: 'test_message'; sentAt: EpochMs; settingsUrl: string }>
  | Readonly<{
      kind: 'daily_cap_reached';
      sentCount: number;
      nextDayStartsAt: EpochMs;
      homeUrl: string;
    }>
  | Readonly<{ kind: 'chat_unlinked_notice' }>;

/** The data of any message of the catalogue (notifications domain model, section 5). */
export type TemplateData =
  | BacktestRequestToDoData
  | DeadlineChangedData
  | DeadlineReminderData
  | AlertData
  | AlertUpdateData
  | TrackedGameResultData
  | NewTypeProposalData
  | IncidentData
  | IncidentEndData
  | ExportReminderData
  | DigestData
  | ServiceMessageData;
