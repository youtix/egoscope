import { describe, expect, it } from 'vitest';

import { casePlace, overallSubrowOf } from './case-place';

import type { CaseGap, TableTrackedCase, TrackedCaseOutcome } from './case-place';
import type { Forecast } from './forecast';

// Instants in milliseconds: the case is created at CREATED_AT, before its expected and
// measured games, which start at START.
const CASE_ID = 7;
const CREATED_AT = 1000;
const START = 10_000;
const BEFORE = START - 500;
const AFTER = START + 500;

const FORECAST: Forecast = {
  source: 'player_profile',
  level: 'possible',
  direction: 'increase',
  announcedMeanGap: 0.95,
  caseCount: 12,
  profileConfidence: 'medium',
};
const MEASURED: TrackedCaseOutcome = {
  status: 'measured',
  measuredGameStartAt: START,
  normalizedGap: 0.5,
  gapStatus: 'final',
};
const EXCLUDED: TrackedCaseOutcome = {
  status: 'excluded',
  measuredGameStartAt: START,
  normalizedGap: -0.3,
  gapStatus: 'provisional',
};
const PENDING: TrackedCaseOutcome = { status: 'awaiting_game', measuredGameStartAt: null };
const NOT_MEASURABLE: TrackedCaseOutcome = { status: 'not_measurable', measuredGameStartAt: null };
const MEASURED_GAP: CaseGap = {
  caseId: CASE_ID,
  measuredGameScheduledStartAt: START,
  normalizedGap: 0.5,
  gapStatus: 'final',
};
const EXCLUDED_GAP: CaseGap = { ...MEASURED_GAP, normalizedGap: -0.3, gapStatus: 'provisional' };

function placeOf(overrides: Partial<TableTrackedCase>): ReturnType<typeof casePlace> {
  return casePlace({
    caseId: CASE_ID,
    playerId: 'player-a',
    eventTypeId: 'type-x',
    createdAt: CREATED_AT,
    expectedGameStartAt: START,
    outcome: MEASURED,
    frozenForecast: { state: 'frozen', forecast: FORECAST },
    isCoOccurring: false,
    decisions: [],
    allEventsDismissedAt: null,
    ...overrides,
  });
}

function kindOf(overrides: Partial<TableTrackedCase>): string | null {
  return placeOf(overrides)?.kind ?? null;
}

describe('overallSubrowOf', () => {
  it('[SUI-28] [CL-SUI-16] places a forecast in the sub-row of its source and level, and none without one', () => {
    const forecasts: readonly (Forecast | null)[] = [
      { ...FORECAST, level: 'probable' },
      { ...FORECAST, level: 'possible' },
      { ...FORECAST, source: 'general_trend', level: 'probable' },
      { ...FORECAST, source: 'general_trend', level: 'possible' },
      null,
    ];
    expect(forecasts.map((forecast) => overallSubrowOf(forecast))).toStrictEqual([
      'probable_profile',
      'possible_profile',
      'general_trend',
      'general_trend',
      null,
    ]);
  });
});

describe('casePlace', () => {
  it('[SUI-24] [CL-SUI-02] tests a valid case recorded in time, untouched, with an event not dismissed, with or without a frozen forecast', () => {
    expect(placeOf({})).toStrictEqual({ kind: 'testing', gap: MEASURED_GAP });
    expect(placeOf({ frozenForecast: null })).toStrictEqual({ kind: 'testing', gap: MEASURED_GAP });
  });

  it('[SUI-25] [CL-SUI-08] places a valid case with a late forecast in the late-forecast part', () => {
    expect(placeOf({ frozenForecast: { state: 'late', forecast: FORECAST } })).toStrictEqual({
      kind: 'late',
      gap: MEASURED_GAP,
    });
  });

  it('[SUI-25] [SUI-06] counts a case created at or after tip-off among the cases recorded after it, whatever its status', () => {
    expect(placeOf({ createdAt: START })).toStrictEqual({
      kind: 'recorded_after_tip_off',
      gap: MEASURED_GAP,
    });
    expect(placeOf({ createdAt: AFTER, outcome: EXCLUDED })).toStrictEqual({
      kind: 'recorded_after_tip_off',
      gap: EXCLUDED_GAP,
    });
    expect(kindOf({ createdAt: START, outcome: PENDING })).toBe('recorded_after_tip_off');
  });

  it('[SUI-25] counts a case recorded in time by its status when it is excluded, not measurable or pending, even with a late forecast', () => {
    const lateForecast = { state: 'late', forecast: FORECAST } as const;
    expect(placeOf({ outcome: EXCLUDED, frozenForecast: lateForecast })).toStrictEqual({
      kind: 'excluded',
      gap: EXCLUDED_GAP,
    });
    expect(placeOf({ outcome: NOT_MEASURABLE, frozenForecast: lateForecast })).toStrictEqual({
      kind: 'not_measurable',
      gap: null,
    });
    expect(kindOf({ outcome: PENDING })).toBe('awaiting_game');
    // No game known: its recording timing is undetermined.
    expect(kindOf({ outcome: PENDING, expectedGameStartAt: null })).toBe('awaiting_game');
  });

  it('[SUI-16] [CL-DET-09] [CL-DET-15] shows a case all of whose events were dismissed nowhere before tip-off, and as an exit with its gap at or after it', () => {
    expect(placeOf({ allEventsDismissedAt: BEFORE })).toBeNull();
    expect(placeOf({ allEventsDismissedAt: START })).toStrictEqual({
      kind: 'exit',
      gap: MEASURED_GAP,
    });
    expect(placeOf({ createdAt: AFTER, allEventsDismissedAt: AFTER })).toStrictEqual({
      kind: 'exit',
      gap: MEASURED_GAP,
    });
  });

  it('[SUI-17] [CL-SUI-10] counts a case touched after tip-off by its latest decision, before its recording timing and its status', () => {
    expect(
      kindOf({ createdAt: AFTER, decisions: [{ effect: 'entry', decidedAt: AFTER + 1 }] }),
    ).toBe('entry');
    expect(
      placeOf({ outcome: EXCLUDED, decisions: [{ effect: 'exit', decidedAt: AFTER }] }),
    ).toStrictEqual({ kind: 'exit', gap: EXCLUDED_GAP });
    expect(
      placeOf({
        outcome: { status: 'awaiting_game', measuredGameStartAt: START },
        decisions: [{ effect: 'measured_game_change', decidedAt: AFTER }],
      }),
    ).toStrictEqual({ kind: 'measured_game_change', gap: null });
  });

  it('[SUI-16] [CL-DET-09] counts a case that keeps an undismissed event by its remaining events when its decision came before tip-off', () => {
    expect(kindOf({ outcome: EXCLUDED, decisions: [{ effect: 'exit', decidedAt: BEFORE }] })).toBe(
      'excluded',
    );
    expect(kindOf({ decisions: [{ effect: 'measured_game_change', decidedAt: BEFORE }] })).toBe(
      'testing',
    );
  });

  it('[SUI-16] [CL-DET-15] judges a decision against the measured game once established, else the expected game, else before', () => {
    const decisions = [{ effect: 'exit', decidedAt: BEFORE }] as const;
    expect(kindOf({ expectedGameStartAt: BEFORE - 1, decisions })).toBe('testing');
    expect(kindOf({ expectedGameStartAt: BEFORE, outcome: PENDING, decisions })).toBe('exit');
    expect(kindOf({ expectedGameStartAt: null, outcome: PENDING, decisions })).toBe(
      'awaiting_game',
    );
  });
});
