import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isLateSheet, sheetState } from './state';

import type { CaseStatus } from '../cases/case-state';
import type { AlertSheetState, CancelingChange, SheetStateEvent, SheetTiming } from './state';

const AWAITING: SheetStateEvent = { isDismissed: false, caseStatus: 'awaiting_game' };
const MEASURED: SheetStateEvent = { isDismissed: false, caseStatus: 'measured' };
const EXCLUDED: SheetStateEvent = { isDismissed: false, caseStatus: 'excluded' };
const NOT_MEASURABLE: SheetStateEvent = { isDismissed: false, caseStatus: 'not_measurable' };
const DISMISSED_AWAITING: SheetStateEvent = { isDismissed: true, caseStatus: 'awaiting_game' };
const DISMISSED_MEASURED: SheetStateEvent = { isDismissed: true, caseStatus: 'measured' };

const OPEN: AlertSheetState = { status: 'open' };
const CLOSED: AlertSheetState = { status: 'closed' };
const ALL_DISMISSED: AlertSheetState = {
  status: 'canceled',
  cancellationReason: 'all_events_dismissed',
};
const CORRECTED: AlertSheetState = {
  status: 'canceled',
  cancellationReason: 'attachment_corrected',
};
const NO_LONGER_APPLIES: AlertSheetState = {
  status: 'canceled',
  cancellationReason: 'event_no_longer_applies',
};

/** The state of a sheet after the withdrawal of one of its events, from the events it keeps. */
function withdrawn(events: readonly SheetStateEvent[], previous: AlertSheetState): AlertSheetState {
  return sheetState({ events, previous, change: 'event_withdrawn' });
}

describe('sheetState', () => {
  it('[ALE-26] keeps a sheet open while one of its non-dismissed events has a case awaiting its game', () => {
    expect(
      sheetState({ events: [MEASURED, AWAITING], previous: OPEN, change: null }),
    ).toStrictEqual(OPEN);
    expect(sheetState({ events: [AWAITING], previous: null, change: null })).toStrictEqual(OPEN);
  });

  it.each([
    ['measured', [MEASURED]],
    ['excluded', [EXCLUDED]],
    ['not measurable', [NOT_MEASURABLE]],
    ['measured, excluded or not measurable', [MEASURED, EXCLUDED, NOT_MEASURABLE]],
  ])('[ALE-26] closes a sheet whose non-dismissed cases are all %s', (_label, events) => {
    expect(sheetState({ events, previous: OPEN, change: null })).toStrictEqual(CLOSED);
  });

  it('[ALE-26] reads no case of a dismissed event', () => {
    expect(
      sheetState({ events: [DISMISSED_AWAITING, MEASURED], previous: OPEN, change: null }),
    ).toStrictEqual(CLOSED);
  });

  it('[ALE-24] produces closed a sheet whose case is already measured', () => {
    expect(sheetState({ events: [MEASURED], previous: null, change: null })).toStrictEqual(CLOSED);
  });

  it('[ALE-26] cancels a sheet whose events are all dismissed, with "all events dismissed"', () => {
    expect(
      sheetState({
        events: [DISMISSED_AWAITING, DISMISSED_MEASURED],
        previous: null,
        change: null,
      }),
    ).toStrictEqual(ALL_DISMISSED);
  });

  it('[ALE-26] cancels with "all events dismissed" a sheet whose last non-dismissed event the owner dismisses', () => {
    expect(
      sheetState({
        events: [DISMISSED_MEASURED, DISMISSED_AWAITING],
        previous: OPEN,
        change: 'event_dismissed',
      }),
    ).toStrictEqual(ALL_DISMISSED);
  });

  it('[ALE-26] cancels with "attachment corrected" a sheet that a correction or a merge leaves no non-dismissed event', () => {
    expect(
      sheetState({ events: [DISMISSED_AWAITING], previous: OPEN, change: 'attachment_corrected' }),
    ).toStrictEqual(CORRECTED);
    expect(
      sheetState({ events: [], previous: CLOSED, change: 'attachment_corrected' }),
    ).toStrictEqual(CORRECTED);
  });

  it('[ALE-26] [CL-ALE-13] cancels with "event no longer applies" a sheet whose last non-dismissed event was a dropped calendar-derived event', () => {
    expect(
      sheetState({ events: [], previous: OPEN, change: 'event_no_longer_applies' }),
    ).toStrictEqual(NO_LONGER_APPLIES);
    expect(
      sheetState({
        events: [DISMISSED_MEASURED],
        previous: OPEN,
        change: 'event_no_longer_applies',
      }),
    ).toStrictEqual(NO_LONGER_APPLIES);
  });

  it('[ALE-26] [CL-ALE-13] does not cancel a sheet that a change leaves a non-dismissed event', () => {
    const changes: readonly CancelingChange[] = [
      'event_dismissed',
      'attachment_corrected',
      'event_no_longer_applies',
      'event_withdrawn',
    ];
    for (const change of changes) {
      expect(
        sheetState({ events: [DISMISSED_MEASURED, AWAITING], previous: OPEN, change }),
      ).toStrictEqual(OPEN);
      expect(sheetState({ events: [MEASURED], previous: OPEN, change })).toStrictEqual(CLOSED);
    }
  });

  it('[ALE-26] keeps the reason of a canceled sheet while no non-dismissed event comes back', () => {
    expect(
      sheetState({ events: [DISMISSED_MEASURED], previous: CORRECTED, change: null }),
    ).toStrictEqual(CORRECTED);
    expect(
      sheetState({
        events: [DISMISSED_AWAITING],
        previous: ALL_DISMISSED,
        change: 'attachment_corrected',
      }),
    ).toStrictEqual(ALL_DISMISSED);
    expect(sheetState({ events: [], previous: NO_LONGER_APPLIES, change: null })).toStrictEqual(
      NO_LONGER_APPLIES,
    );
  });

  it('[CL-ALE-06] cancels a closed sheet whose last non-dismissed event is dismissed, and closes it again at reinstatement', () => {
    const canceled = sheetState({
      events: [DISMISSED_MEASURED],
      previous: CLOSED,
      change: 'event_dismissed',
    });
    expect(canceled).toStrictEqual(ALL_DISMISSED);
    expect(sheetState({ events: [MEASURED], previous: canceled, change: null })).toStrictEqual(
      CLOSED,
    );
  });

  it('[CL-ALE-14] reopens a canceled sheet that a new event of its game joins', () => {
    expect(
      sheetState({ events: [DISMISSED_MEASURED, AWAITING], previous: ALL_DISMISSED, change: null }),
    ).toStrictEqual(OPEN);
    expect(sheetState({ events: [AWAITING], previous: CORRECTED, change: null })).toStrictEqual(
      OPEN,
    );
  });

  it('[ALE-26] [CL-ALE-16] gives a sheet that keeps events at a withdrawal the state its remaining events give', () => {
    expect(withdrawn([AWAITING, DISMISSED_MEASURED], CLOSED)).toStrictEqual(OPEN);
    expect(withdrawn([MEASURED, DISMISSED_AWAITING], OPEN)).toStrictEqual(CLOSED);
    expect(withdrawn([MEASURED], ALL_DISMISSED)).toStrictEqual(CLOSED);
  });

  it('[ALE-26] [CL-ALE-16] cancels with "all events dismissed" a sheet that a withdrawal leaves only dismissed events, whatever its reason before', () => {
    expect(withdrawn([DISMISSED_AWAITING], OPEN)).toStrictEqual(ALL_DISMISSED);
    expect(withdrawn([DISMISSED_MEASURED], CORRECTED)).toStrictEqual(ALL_DISMISSED);
    expect(withdrawn([DISMISSED_MEASURED], NO_LONGER_APPLIES)).toStrictEqual(ALL_DISMISSED);
  });

  it('[CL-ALE-16] leaves its reason to a canceled sheet that keeps no event when an event that left it is withdrawn', () => {
    expect(
      sheetState({ events: [], previous: CORRECTED, change: 'event_withdrawn' }),
    ).toStrictEqual(CORRECTED);
  });
});

// --- Random sheets ------------------------------------------------------------------

const CASE_STATUSES: readonly CaseStatus[] = [
  'awaiting_game',
  'measured',
  'excluded',
  'not_measurable',
];
const eventArbitrary = fc.record({
  isDismissed: fc.boolean(),
  caseStatus: fc.constantFrom(...CASE_STATUSES),
});
const eventsArbitrary = fc.array(eventArbitrary, { maxLength: 8, size: 'max' });
const stateArbitrary = fc.constantFrom(OPEN, CLOSED, ALL_DISMISSED, CORRECTED, NO_LONGER_APPLIES);
const changeArbitrary = fc.constantFrom<CancelingChange | null>(
  null,
  'event_dismissed',
  'attachment_corrected',
  'event_no_longer_applies',
  'event_withdrawn',
);
const inputArbitrary = fc.record({
  events: eventsArbitrary,
  previous: fc.option(stateArbitrary, { nil: null }),
  change: changeArbitrary,
});
/** A sheet that keeps a non-dismissed event among its events. */
const keepingInputArbitrary = fc
  .tuple(inputArbitrary, eventArbitrary, fc.nat())
  .map(([input, event, at]) => ({
    ...input,
    events: input.events.toSpliced(at % (input.events.length + 1), 0, {
      ...event,
      isDismissed: false,
    }),
  }));
const dismissedEventsArbitrary = fc.array(
  eventArbitrary.map((event) => ({ ...event, isDismissed: true })),
  { maxLength: 4, size: 'max' },
);

/** ALE-26 read on the events: canceled with none non-dismissed, else open while one awaits. */
function statusOf(events: readonly SheetStateEvent[]): AlertSheetState['status'] {
  const live = events.filter(({ isDismissed }) => !isDismissed);
  if (live.length === 0) {
    return 'canceled';
  }
  return live.some(({ caseStatus }) => caseStatus === 'awaiting_game') ? 'open' : 'closed';
}

describe('sheetState over random sheets', () => {
  it('[ALE-26] is open, closed or canceled exactly as its non-dismissed events and their cases say', () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        expect(sheetState(input).status).toBe(statusOf(input.events));
      }),
    );
  });

  it('[ALE-26] does not depend on the order of the events', () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        expect(sheetState({ ...input, events: input.events.toReversed() })).toStrictEqual(
          sheetState(input),
        );
      }),
    );
  });

  it('[ALE-26] reads no dismissed event of a sheet that keeps a non-dismissed one', () => {
    fc.assert(
      fc.property(keepingInputArbitrary, dismissedEventsArbitrary, (input, dismissed) => {
        expect(sheetState({ ...input, events: [...dismissed, ...input.events] })).toStrictEqual(
          sheetState(input),
        );
      }),
    );
  });
});

// --- Late mark ----------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Tonight's game, 19:30 New York time on 2026-01-14, and its make-up two days later.
const TIP_OFF = Date.UTC(2026, 0, 15, 0, 30);
const MAKE_UP_TIP_OFF = TIP_OFF + 48 * HOUR;

/** A sheet produced at `producedAt`, its profile values in at production, for tonight's game. */
function timing(producedAt: number, overrides: Partial<SheetTiming> = {}): SheetTiming {
  return {
    producedAt,
    profileValuesEnteredAt: null,
    expectedGameStartAt: TIP_OFF,
    measuredGameStartAt: null,
    ...overrides,
  };
}

describe('isLateSheet', () => {
  it('[ALE-24] [CL-ALE-04] marks late a sheet produced at or after its expected game’s scheduled start', () => {
    expect(isLateSheet(timing(TIP_OFF - 1))).toBe(false);
    expect(isLateSheet(timing(TIP_OFF - 3 * HOUR))).toBe(false);
    expect(isLateSheet(timing(TIP_OFF))).toBe(true);
    expect(isLateSheet(timing(TIP_OFF + 20 * MINUTE))).toBe(true);
  });

  it('[ALE-24] [CL-ALE-04] judges a sheet produced while its profile was being computed by the instant its values entered', () => {
    const producedAt = TIP_OFF - 2 * HOUR;

    expect(isLateSheet(timing(producedAt, { profileValuesEnteredAt: TIP_OFF + MINUTE }))).toBe(
      true,
    );
    expect(isLateSheet(timing(producedAt, { profileValuesEnteredAt: TIP_OFF }))).toBe(true);
    expect(isLateSheet(timing(producedAt, { profileValuesEnteredAt: TIP_OFF - MINUTE }))).toBe(
      false,
    );
    expect(isLateSheet(timing(TIP_OFF + HOUR, { profileValuesEnteredAt: null }))).toBe(true);
  });

  it('[ALE-24] [CL-ALE-04] never marks late a sheet with no known expected game', () => {
    expect(isLateSheet(timing(TIP_OFF + 30 * 24 * HOUR, { expectedGameStartAt: null }))).toBe(
      false,
    );
    expect(isLateSheet(timing(0, { expectedGameStartAt: null }))).toBe(false);
  });

  it('[ALE-24] [CL-ALE-04] judges the sheet again against its measured game once it is established', () => {
    // Produced after tonight's tip-off; the player missed tonight's game and plays the make-up.
    const producedLate = TIP_OFF + HOUR;
    expect(isLateSheet(timing(producedLate))).toBe(true);
    expect(isLateSheet(timing(producedLate, { measuredGameStartAt: MAKE_UP_TIP_OFF }))).toBe(false);
    expect(isLateSheet(timing(producedLate, { measuredGameStartAt: TIP_OFF }))).toBe(true);
    // No expected game was known, and the measured game started as the sheet was produced.
    expect(
      isLateSheet(
        timing(producedLate, { expectedGameStartAt: null, measuredGameStartAt: producedLate }),
      ),
    ).toBe(true);
  });

  it('[ALE-24] [CL-ALE-04] judges against the measured game the instant the profile values entered', () => {
    // Produced before tonight's tip-off, its profile values entered around the make-up's.
    const producedEarly = TIP_OFF - HOUR;
    const entered = (profileValuesEnteredAt: number): SheetTiming =>
      timing(producedEarly, { profileValuesEnteredAt, measuredGameStartAt: MAKE_UP_TIP_OFF });

    expect(isLateSheet(entered(MAKE_UP_TIP_OFF - MINUTE))).toBe(false);
    expect(isLateSheet(entered(MAKE_UP_TIP_OFF))).toBe(true);
  });
});

describe('isLateSheet over random instants', () => {
  const instant = fc.integer({ min: 0, max: 4_102_444_800_000 });
  const maybeInstant = fc.option(instant, { nil: null });
  const timingArbitrary = fc.record({
    producedAt: instant,
    profileValuesEnteredAt: maybeInstant,
    expectedGameStartAt: maybeInstant,
    measuredGameStartAt: maybeInstant,
  });

  it('[ALE-24] [CL-ALE-04] is late exactly when the timing instant is at or after the tip-off of the game it is judged by', () => {
    fc.assert(
      fc.property(timingArbitrary, (sheetTiming) => {
        const timingInstantAt = sheetTiming.profileValuesEnteredAt ?? sheetTiming.producedAt;
        const tipOffAt = sheetTiming.measuredGameStartAt ?? sheetTiming.expectedGameStartAt;

        expect(isLateSheet(sheetTiming)).toBe(tipOffAt !== null && timingInstantAt >= tipOffAt);
      }),
    );
  });

  it('[CL-ALE-04] reads no expected game once the measured game is established', () => {
    fc.assert(
      fc.property(
        timingArbitrary,
        instant,
        maybeInstant,
        (sheetTiming, measured, otherExpected) => {
          const established = { ...sheetTiming, measuredGameStartAt: measured };

          expect(isLateSheet({ ...established, expectedGameStartAt: otherExpected })).toBe(
            isLateSheet(established),
          );
        },
      ),
    );
  });

  it('[ALE-24] [CL-ALE-04] never lifts the mark of a sheet whose profile values enter later', () => {
    fc.assert(
      fc.property(timingArbitrary, fc.nat(), (sheetTiming, delay) => {
        const timingInstantAt = sheetTiming.profileValuesEnteredAt ?? sheetTiming.producedAt;
        const later = { ...sheetTiming, profileValuesEnteredAt: timingInstantAt + delay };

        expect(isLateSheet(sheetTiming) && !isLateSheet(later)).toBe(false);
      }),
    );
  });
});
