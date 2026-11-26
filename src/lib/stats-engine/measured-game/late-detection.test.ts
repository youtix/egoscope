import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isDetectedAfterTipOff } from './late-detection';

// The tip-off of the expected game, 7:30 p.m. US Eastern on 4 November 2024.
const TIP_OFF = 1_730_766_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
// The next game of the player's team, two days later.
const NEXT_TIP_OFF = TIP_OFF + 2 * DAY_MS;

describe('isDetectedAfterTipOff', () => {
  it('[DET-33] [CL-DET-16] sets the mark when the expected game had started at the creation of the event', () => {
    const late = { measuredGameStartAt: null, expectedGameStartAt: TIP_OFF };

    expect(isDetectedAfterTipOff({ ...late, createdAt: TIP_OFF + 90 * MINUTE_MS })).toBe(true);
    // Created at the very tip-off: the start is at or before the creation instant.
    expect(isDetectedAfterTipOff({ ...late, createdAt: TIP_OFF })).toBe(true);
  });

  it('[DET-33] [CL-DET-16] leaves the mark unset when the expected game starts after the creation of the event', () => {
    expect(
      isDetectedAfterTipOff({
        createdAt: TIP_OFF - 1,
        measuredGameStartAt: null,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe(false);
  });

  it('[DET-33] [CL-DET-16] confirms the mark once the measured game is the expected game that had started', () => {
    expect(
      isDetectedAfterTipOff({
        createdAt: TIP_OFF + 90 * MINUTE_MS,
        measuredGameStartAt: TIP_OFF,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe(true);
  });

  it('[DET-33] [CL-DET-16] lifts the mark once the measured game turns out to start after the creation of the event', () => {
    // He sat out the expected game, so his measured game is the next one.
    expect(
      isDetectedAfterTipOff({
        createdAt: TIP_OFF + 90 * MINUTE_MS,
        measuredGameStartAt: NEXT_TIP_OFF,
        expectedGameStartAt: TIP_OFF,
      }),
    ).toBe(false);
  });

  it('[DET-33] [CL-DET-16] sets the mark once the measured game started before the creation, whatever the expected game said', () => {
    expect(
      isDetectedAfterTipOff({
        createdAt: TIP_OFF + 90 * MINUTE_MS,
        measuredGameStartAt: TIP_OFF,
        expectedGameStartAt: NEXT_TIP_OFF,
      }),
    ).toBe(true);
  });

  it('[DET-33] [CL-DET-16] leaves the mark unset while neither the measured nor the expected game is known', () => {
    expect(
      isDetectedAfterTipOff({
        createdAt: TIP_OFF,
        measuredGameStartAt: null,
        expectedGameStartAt: null,
      }),
    ).toBe(false);
  });

  it('[DET-33] [CL-DET-16] once the measured game is established, sets the mark exactly when the case is not recorded in time', () => {
    // A tracked case is recorded in time when created before its measured game's scheduled
    // start (SUI-06), and the mark then matches "recorded after tip-off".
    const instant = fc.integer({ min: 0, max: 4_102_444_800_000 });

    fc.assert(
      fc.property(instant, instant, fc.option(instant), (createdAt, startAt, expectedAt) => {
        const isRecordedInTime = createdAt < startAt;

        expect(
          isDetectedAfterTipOff({
            createdAt,
            measuredGameStartAt: startAt,
            expectedGameStartAt: expectedAt,
          }),
        ).toBe(!isRecordedInTime);
      }),
    );
  });
});
