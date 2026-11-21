// The state and reason of a case (SEN-07, SEN-44, SEN-47, STA-45, CL-SEN-05): the first
// rule of CL-SEN-05 that applies gives it its one state and one reason. Before the walk,
// the season of the reference instant (covered, read), the Lot 2 dating mark and the
// stats-source mapping; then the attachment of its event, walk and precedence included
// (measured-game part), the box score of the measured game and its season baseline
// (baseline part); and last its normalized gap. A computed gap makes the case measured:
// the doubtful-case criteria and the manual decisions that exclude it come after.

import { seasonOfDate } from '../schedule/seasons';
import { normalizedGap } from './normalized-gap';

import type { SeasonBaseline } from '../baseline/season-baseline';
import type { Attachment } from '../measured-game/attachment';
import type { SeasonSpan } from '../schedule/seasons';
import type { GameId, IsoDate } from '../types';
import type { GapStatus } from './normalized-gap';

/** The state of a case (SEN-07), as it is stored. */
export type CaseStatus = 'awaiting_game' | 'measured' | 'excluded' | 'not_measurable';

/** Why a case awaits its game (SEN-07, SEN-47), as it is stored. */
type AwaitingGameReason =
  | 'game_not_played_yet'
  | 'statistics_pending'
  | 'mapping_not_established'
  | 'baseline_building'
  | 'precedence_to_verify'
  | 'dating_to_verify';

/** Why a case is not measurable (SEN-07, CL-SEN-03), as it is stored. */
type NotMeasurableReason =
  | 'no_game_within_window'
  | 'box_score_incomplete'
  | 'box_score_suspect'
  | 'box_score_unavailable'
  | 'insufficient_baseline'
  | 'season_not_covered'
  | 'precedence_not_established'
  | 'derived_game_missed';

/**
 * The reason of a case awaiting its game or not measurable (SEN-07), as it is stored; an
 * excluded case carries its triggered criteria instead.
 */
export type CaseStatusReason = AwaitingGameReason | NotMeasurableReason;

/**
 * The event of a case as its state reads it (CL-SEN-05): a calendar-derived event; or a
 * historical or detected event with the day its season is told from (STA-48), the US
 * Eastern date of its reference instant (CL-TRV-03) as time.gameDay gives it, or the date
 * of an event known in advance (CL-SEN-04).
 */
export type CaseStateEvent =
  | Readonly<{ origin: 'calendar' }>
  | Readonly<{ origin: 'historical' | 'detected'; referenceDayOn: IsoDate }>;

/**
 * What the state of a case reads of the seasons (STA-45, STA-48, CL-STA-22, CL-STA-30).
 * The source's first season, as the stats-source port gives it (1993-94 for the chosen
 * source); the spans of the seasons whose schedule is stored (seasonSpan), in any order;
 * the seasons whose games have been read, `coverage_fetched_at` set, in any order, each
 * with whether one of its games has player lines, `phases_with_lines` not empty
 * (games-and-statistics 1.10); and, between seasons, the coming season while the source
 * has not published its schedule, null otherwise.
 */
export type CaseSeasons = Readonly<{
  firstCoveredSeason: string;
  spans: readonly SeasonSpan[];
  readSeasons: readonly Readonly<{ season: string; hasPlayerLines: boolean }>[];
  unpublishedSeason: string | null;
}>;

/**
 * The statistics of a measured game, which he played (CL-SEN-05 steps 8 and 9): the
 * status of his box score (BoxScoreStatus, STA-09, STA-10); when complete, his performance
 * index and the baseline of the game's season and baseline phase, the measured game left
 * out (seasonBaseline); when incomplete or suspect, whether the game is still in its
 * correction window (GameConsolidation, STA-33).
 */
export type MeasuredGameStatistics =
  | Readonly<{ boxScoreStatus: 'complete'; performanceIndex: number; baseline: SeasonBaseline }>
  | Readonly<{
      boxScoreStatus: 'incomplete' | 'suspect';
      consolidation: 'in_correction_window' | 'consolidated';
    }>;

/**
 * What the state of a case is decided from (CL-SEN-05): its event; the seasons; whether a
 * detected event carries the Lot 2 mark "dating to verify" (SEN-45), false for any other;
 * whether the player's stats-source mapping is established (STA-03); the event's own
 * attachment (attachToMeasuredGame); and the statistics of the game it measured, which
 * caseState asks for that game alone, once the rules before it let the case reach it.
 */
export type CaseStateInput = Readonly<{
  event: CaseStateEvent;
  seasons: CaseSeasons;
  isDatingToVerify: boolean;
  isMappingEstablished: boolean;
  attachment: Attachment;
  statisticsOf: (measuredGameId: GameId) => MeasuredGameStatistics;
}>;

/**
 * The state of a case (SEN-07): awaiting its game or not measurable, with its reason; or
 * measured, with its normalized gap and the gap's status, which no other state has. Its
 * measured game is the data model's `measured_game_id`: the game the walk stopped at, as
 * the attachment gives it, and none when a rule before the walk decides.
 */
export type CaseState =
  | Readonly<{
      status: 'awaiting_game';
      statusReason: AwaitingGameReason;
      measuredGameId: GameId | null;
      normalizedGap: null;
      gapStatus: null;
    }>
  | Readonly<{
      status: 'not_measurable';
      statusReason: NotMeasurableReason;
      measuredGameId: GameId | null;
      normalizedGap: null;
      gapStatus: null;
    }>
  | Readonly<{
      status: 'measured';
      statusReason: null;
      measuredGameId: GameId;
      normalizedGap: number;
      gapStatus: GapStatus;
    }>;

/**
 * What the seasons say of a reference day that keeps it from the walk (STA-45, STA-48,
 * CL-STA-22, CL-STA-30): its season is not covered, or it is not read yet or not known.
 */
type SeasonReading = 'not_covered' | 'to_read';

// The reason of a measured game's box score once the game is consolidated (CL-SEN-05 step 8).
const CONSOLIDATED_BOX_SCORE_REASON: Readonly<
  Record<'incomplete' | 'suspect', NotMeasurableReason>
> = { incomplete: 'box_score_incomplete', suspect: 'box_score_suspect' };

function awaiting(statusReason: AwaitingGameReason, measuredGameId: GameId | null): CaseState {
  return {
    status: 'awaiting_game',
    statusReason,
    measuredGameId,
    normalizedGap: null,
    gapStatus: null,
  };
}

function notMeasurable(
  statusReason: NotMeasurableReason,
  measuredGameId: GameId | null,
): CaseState {
  return {
    status: 'not_measurable',
    statusReason,
    measuredGameId,
    normalizedGap: null,
    gapStatus: null,
  };
}

/** Whether the span of `season` is stored and closed, its last game known (seasonSpan). */
function hasEnded(season: string, spans: readonly SeasonSpan[]): boolean {
  return spans.some((span) => span.season === season && span.lastGameOn !== null);
}

/**
 * What the seasons say of the reference day `dayOn` (STA-45, STA-48, CL-STA-22, CL-STA-30),
 * null when they let the walk apply. Not covered: a day before the source's first season,
 * which needs no span when the day's season is not known (season_not_read) and both of
 * its candidates are earlier, and otherwise that season's span, the day before its first
 * game; or a day of a season that has ended, its games read, and none of them with player
 * lines. To read: a day whose season is not known, one of its candidates the source's
 * first season or a later one, or a season whose games are not read yet, but the coming
 * season while its schedule is unpublished.
 */
function seasonReadingOf(dayOn: IsoDate, seasons: CaseSeasons): SeasonReading | null {
  const first = seasons.spans.find(({ season }) => season === seasons.firstCoveredSeason);
  if (first !== undefined && dayOn < first.firstGameOn) {
    return 'not_covered';
  }
  const found = seasonOfDate(dayOn, seasons.spans);
  if (!found.ok) {
    // Season names compare in their order, their first year written first in four digits.
    const isBeforeSource = found.error.candidates.every(
      (season) => season < seasons.firstCoveredSeason,
    );
    return isBeforeSource ? 'not_covered' : 'to_read';
  }
  const read = seasons.readSeasons.find(({ season }) => season === found.season);
  if (read === undefined) {
    return found.season === seasons.unpublishedSeason ? null : 'to_read';
  }
  return read.hasPlayerLines || !hasEnded(found.season, seasons.spans) ? null : 'not_covered';
}

/**
 * The rules before the walk (CL-SEN-05 steps 2 to 5), null when none applies: a season
 * not covered; the dating mark; a mapping not established; a season to read, which the
 * source has to give, "precedence to verify" for a historical event and "statistics
 * pending" for a detected one.
 */
function beforeWalk(
  event: Extract<CaseStateEvent, { referenceDayOn: IsoDate }>,
  input: CaseStateInput,
): CaseState | null {
  const reading = seasonReadingOf(event.referenceDayOn, input.seasons);
  if (reading === 'not_covered') {
    return notMeasurable('season_not_covered', null);
  }
  if (input.isDatingToVerify) {
    return awaiting('dating_to_verify', null);
  }
  if (!input.isMappingEstablished) {
    return awaiting('mapping_not_established', null);
  }
  if (reading === 'to_read') {
    return awaiting(
      event.origin === 'historical' ? 'precedence_to_verify' : 'statistics_pending',
      null,
    );
  }
  return null;
}

/**
 * The state at a game he played (CL-SEN-05 steps 8 to 10): an incomplete or suspect box
 * score awaits while the game is in its correction window, then makes the case not
 * measurable; a baseline being built awaits, an insufficient one makes it not measurable;
 * a final or provisional one gives the gap, and the case is measured.
 */
function measuredState(measuredGameId: GameId, statistics: MeasuredGameStatistics): CaseState {
  if (statistics.boxScoreStatus !== 'complete') {
    return statistics.consolidation === 'in_correction_window'
      ? awaiting('statistics_pending', measuredGameId)
      : notMeasurable(CONSOLIDATED_BOX_SCORE_REASON[statistics.boxScoreStatus], measuredGameId);
  }
  const { baseline, performanceIndex } = statistics;
  if (baseline.status === 'final' || baseline.status === 'provisional') {
    return {
      status: 'measured',
      statusReason: null,
      measuredGameId,
      ...normalizedGap(performanceIndex, baseline),
    };
  }
  return baseline.status === 'building'
    ? awaiting('baseline_building', measuredGameId)
    : notMeasurable('insufficient_baseline', measuredGameId);
}

/**
 * The state that the attachment gives (CL-SEN-05 steps 1, 6 and 7): its own end and game
 * when it reached no game he played, the walk's reason coming before the precedence; the
 * state at the measured game otherwise.
 */
function attachedState(input: CaseStateInput): CaseState {
  const { attachment } = input;
  if (attachment.status === 'awaiting_game') {
    return awaiting(attachment.reason, attachment.measuredGameId);
  }
  if (attachment.status === 'not_measurable') {
    return notMeasurable(attachment.reason, attachment.measuredGameId);
  }
  return measuredState(attachment.measuredGameId, input.statisticsOf(attachment.measuredGameId));
}

/**
 * The state and reason of a case (SEN-07, SEN-08 to SEN-10, SEN-44, SEN-47, STA-45,
 * CL-SEN-05, CL-SEN-08, CL-STA-22, CL-STA-30): the first rule that applies, in order. A
 * calendar-derived event goes to its derived game (step 1). The others: a reference day
 * in a season the source does not cover makes the case not measurable, "season not
 * covered by the source" (2); the dating mark holds it pending (3), then a mapping not
 * established (4), then a season not read yet, whose schedule the source has to give,
 * "precedence to verify" for a historical event and "statistics pending" for a detected
 * one (5); the coming season between seasons, unpublished, lets the walk apply, with no
 * further game stored. Then the attachment (6 and 7): the walk's end, the precedence not
 * established making the case not measurable with no game, an uncertain one already
 * shifted once. At the game he played: an incomplete or suspect box score (8), the
 * baseline (9), then the gap (10), never rounded, provisional while the baseline is,
 * which no other state has: a case whose precedence is to verify or not established
 * enters no calculation (SEN-44). The rules before the walk give no measured game.
 */
export function caseState(input: CaseStateInput): CaseState {
  const { event } = input;
  const decided = event.origin === 'calendar' ? null : beforeWalk(event, input);
  return decided ?? attachedState(input);
}
