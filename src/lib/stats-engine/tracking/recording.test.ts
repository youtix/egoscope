import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { frozenForecast } from './forecast';
import { recordingTiming } from './recording';

import type { Forecast, ForecastVersion } from './forecast';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// A game's scheduled start: the rules compare instants only, never displayed hours.
const TIP_OFF = 1000 * HOUR;

describe('recordingTiming', () => {
  it("[SUI-06] records in time a case created strictly before its measured game's scheduled start", () => {
    expect(
      recordingTiming({
        createdAt: TIP_OFF - 150 * MINUTE,
        measuredGameStartAt: TIP_OFF,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe('recorded_in_time');
    expect(
      recordingTiming({
        createdAt: TIP_OFF - 1,
        measuredGameStartAt: TIP_OFF,
        expectedGameStartAt: null,
      }),
    ).toBe('recorded_in_time');
  });

  it('[SUI-06] [CL-SUI-13] records after tip-off a case created at or after the scheduled start', () => {
    expect(
      recordingTiming({
        createdAt: TIP_OFF,
        measuredGameStartAt: TIP_OFF,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe('recorded_after_tip_off');
    expect(
      recordingTiming({
        createdAt: TIP_OFF + 390 * MINUTE,
        measuredGameStartAt: TIP_OFF,
        expectedGameStartAt: null,
      }),
    ).toBe('recorded_after_tip_off');
  });

  it('[SUI-06] [CL-DET-16] judges against the expected game while no measured game is established, and is undetermined without either', () => {
    expect(
      recordingTiming({
        createdAt: TIP_OFF - HOUR,
        measuredGameStartAt: null,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe('recorded_in_time');
    expect(
      recordingTiming({
        createdAt: TIP_OFF,
        measuredGameStartAt: null,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe('recorded_after_tip_off');
    expect(
      recordingTiming({ createdAt: TIP_OFF, measuredGameStartAt: null, expectedGameStartAt: null }),
    ).toBeNull();
  });

  it('[SUI-06] [CL-DET-16] judges against the measured game once established, whatever the expected game', () => {
    expect(
      recordingTiming({
        createdAt: TIP_OFF - HOUR,
        measuredGameStartAt: TIP_OFF + 72 * HOUR,
        expectedGameStartAt: TIP_OFF - 2 * HOUR,
      }),
    ).toBe('recorded_in_time');
    expect(
      recordingTiming({
        createdAt: TIP_OFF - HOUR,
        measuredGameStartAt: TIP_OFF - 2 * HOUR,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe('recorded_after_tip_off');
  });

  it('[SUI-06] [CL-SUI-03] follows a measured game that a post-tip-off decision changed, while the frozen forecast stays', () => {
    const createdAt = TIP_OFF - HOUR;
    const forecast: Forecast = {
      source: 'general_trend',
      level: 'possible',
      direction: 'increase',
      announcedMeanGap: 0.42,
      caseCount: 24,
      profileConfidence: 'medium',
    };
    const versions: ForecastVersion[] = [{ effectiveAt: createdAt, forecast }];
    const earlierGameStart = TIP_OFF - 48 * HOUR;

    expect(
      recordingTiming({ createdAt, measuredGameStartAt: TIP_OFF, expectedGameStartAt: TIP_OFF }),
    ).toBe('recorded_in_time');
    expect(frozenForecast(versions, TIP_OFF)).toStrictEqual({
      state: 'frozen',
      forecast,
      frozenAt: TIP_OFF,
    });
    expect(
      recordingTiming({
        createdAt,
        measuredGameStartAt: earlierGameStart,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe('recorded_after_tip_off');
    // Chosen again against the new game, the forecast would be none: it is chosen once.
    expect(frozenForecast(versions, earlierGameStart).state).toBe('none');
  });

  it('[SUI-06] records in time exactly the cases created strictly before the start they are judged against', () => {
    const anyStart = fc.integer({ min: 0, max: 1_000_000 });
    const anyCase = fc.record({
      start: anyStart,
      late: fc.nat(),
      early: fc.integer({ min: 1 }),
      expected: fc.option(anyStart, { nil: null }),
    });

    fc.assert(
      fc.property(anyCase, ({ start, late, early, expected }) => {
        expect(
          recordingTiming({
            createdAt: start - early,
            measuredGameStartAt: start,
            expectedGameStartAt: expected,
          }),
        ).toBe('recorded_in_time');
        expect(
          recordingTiming({
            createdAt: start + late,
            measuredGameStartAt: start,
            expectedGameStartAt: expected,
          }),
        ).toBe('recorded_after_tip_off');
        expect(
          recordingTiming({
            createdAt: start + late,
            measuredGameStartAt: null,
            expectedGameStartAt: start,
          }),
        ).toBe('recorded_after_tip_off');
      }),
    );
  });
});
