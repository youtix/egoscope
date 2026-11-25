// The state and the late mark of an alert sheet (ALE-24, ALE-26, CL-ALE-04, CL-ALE-06,
// CL-ALE-13, CL-ALE-14, CL-ALE-16). The state follows the sheet's events at all times:
// open while one of its non-dismissed events has a case awaiting its game, closed once
// every such case has left it, canceled when no non-dismissed event is left, with the
// reason of the change that left none. The late mark compares the sheet's timing instant
// with the tip-off of its game, the last known scheduled start (CL-SUI-13): that of its
// expected game until file 08 establishes the measured game, then that of the measured
// game. Every instant is received as data.

import type { CaseStatus } from '../cases/case-state';
import type { EpochMs } from '../types';

/** Why a sheet is canceled (ALE-22, ALE-31, CL-ALE-13), as it is stored. */
export type AlertSheetCancellationReason =
  'all_events_dismissed' | 'attachment_corrected' | 'event_no_longer_applies';

/** The state of a sheet (ALE-26), its cancellation reason with it when canceled. */
export type AlertSheetState =
  | Readonly<{ status: 'open' | 'closed' }>
  | Readonly<{ status: 'canceled'; cancellationReason: AlertSheetCancellationReason }>;

/** An event of the sheet as its state reads it (ALE-26): dismissed or not, and the status of its case. */
export type SheetStateEvent = Readonly<{ isDismissed: boolean; caseStatus: CaseStatus }>;

/**
 * A change that can leave a sheet no non-dismissed event: the owner dismisses one of its
 * events (ALE-22); a player correction or a merge takes one away (ALE-31); a
 * calendar-derived event is dropped (CL-ALE-13); one of its events is withdrawn
 * (CL-ALE-16).
 */
export type CancelingChange =
  'event_dismissed' | 'attachment_corrected' | 'event_no_longer_applies' | 'event_withdrawn';

/**
 * What a sheet's state is given from (ALE-26): its events after the change, dismissed ones
 * included; its state before it, null for a sheet being produced; and the change, when it
 * can leave no non-dismissed event, null for any other, such as a production, an event that
 * joins or is reinstated, or a case that leaves awaiting its game.
 */
export type SheetStateInput = Readonly<{
  events: readonly SheetStateEvent[];
  previous: AlertSheetState | null;
  change: CancelingChange | null;
}>;

/** The timing of a sheet as its late mark reads it (ALE-24, CL-ALE-04, CL-SUI-13). */
export type SheetTiming = Readonly<{
  /** Its production instant (ALE-06). */
  producedAt: EpochMs;
  /**
   * For a sheet produced while its profile was being computed (ALE-05), the instant its
   * profile values entered it; null for any other sheet, and while they have not.
   */
  profileValuesEnteredAt: EpochMs | null;
  /** The scheduled start of its expected game (SUI-03), null while no expected game is known. */
  expectedGameStartAt: EpochMs | null;
  /** The scheduled start of its measured game once file 08 establishes it (SEN-01), null until then. */
  measuredGameStartAt: EpochMs | null;
}>;

/**
 * The reason of a sheet left with no non-dismissed event (ALE-26, CL-ALE-16): a sheet
 * already canceled keeps its reason, unless a withdrawal leaves it events, all dismissed;
 * otherwise "attachment corrected" after a correction or a merge, "event no longer
 * applies" after a dropped calendar-derived event, each named as its change, and "all
 * events dismissed" after any other change, a withdrawal giving the state the remaining
 * events give, as if the withdrawn event had never been on the sheet.
 */
function cancellationReasonOf({
  events,
  previous,
  change,
}: SheetStateInput): AlertSheetCancellationReason {
  const isWithdrawalLeavingEvents = change === 'event_withdrawn' && events.length > 0;
  if (!isWithdrawalLeavingEvents && previous?.status === 'canceled') {
    return previous.cancellationReason;
  }
  return change === 'attachment_corrected' || change === 'event_no_longer_applies'
    ? change
    : 'all_events_dismissed';
}

/**
 * The state of a sheet after a change (ALE-24, ALE-26, CL-ALE-06, CL-ALE-13, CL-ALE-14,
 * CL-ALE-16). Open while one of its non-dismissed events has a case awaiting its game;
 * closed when every such case is measured, excluded or not measurable, a sheet produced
 * after its case is measured being born closed; canceled when no non-dismissed event is
 * left: with "all events dismissed" when the owner dismissed the last one, closed sheet
 * included, "attachment corrected" when a player correction or a merge took it away, and
 * "event no longer applies" when it was a dropped calendar-derived event. A canceled
 * sheet reopens, or closes again, as soon as a non-dismissed event is back on it, by
 * reinstatement or as a new event of its game, and otherwise keeps its reason; at a
 * withdrawal, a sheet that keeps events takes the state they give, as if the withdrawn
 * event had never been on it, "all events dismissed" when they all are.
 */
export function sheetState(input: SheetStateInput): AlertSheetState {
  const live = input.events.filter((event) => !event.isDismissed);
  if (live.length > 0) {
    return {
      status: live.some((event) => event.caseStatus === 'awaiting_game') ? 'open' : 'closed',
    };
  }
  return { status: 'canceled', cancellationReason: cancellationReasonOf(input) };
}

/**
 * The late mark of a sheet (ALE-24, CL-ALE-04, CL-SUI-13). Its timing instant is its
 * production instant or, for a sheet produced while its profile was being computed, the
 * instant its profile values entered it. The sheet is late when that instant is at or
 * after the scheduled start of its measured game once file 08 establishes it, and until
 * then of its expected game; with neither known, it is not.
 */
export function isLateSheet(timing: SheetTiming): boolean {
  const timingInstantAt = timing.profileValuesEnteredAt ?? timing.producedAt;
  const tipOffAt = timing.measuredGameStartAt ?? timing.expectedGameStartAt;
  return tipOffAt !== null && timingInstantAt >= tipOffAt;
}
