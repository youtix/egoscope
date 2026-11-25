// The "detected after tip-off" mark of a detected event (DET-33, CL-DET-16): computed at
// each reading, never stored, from the event's creation instant and the scheduled start
// of its measured game once established, otherwise of its expected game. Once the
// measured game is established, it matches the tracked case's "recorded after tip-off"
// (SUI-06). The scheduled start of a game whose time is to be determined is its deemed
// start, the beginning of its US date (CL-STA-14), which the caller gives.

import type { EpochMs } from '../types';

/** What the "detected after tip-off" mark of a detected event is computed from (DET-33, CL-DET-16). */
export type LateDetectionInput = Readonly<{
  /** The event's creation instant. */
  createdAt: EpochMs;
  /** The scheduled start of its measured game once established (attachToMeasuredGame), null before. */
  measuredGameStartAt: EpochMs | null;
  /** The scheduled start of its expected game (expectedGameOf), null while it is unknown. */
  expectedGameStartAt: EpochMs | null;
}>;

/**
 * Whether a detected event carries the mark "detected after tip-off" (DET-33, CL-DET-16,
 * SUI-06). Once its measured game is established, the mark is set when that game's
 * scheduled start is at or before the event's creation instant, which confirms or lifts
 * the mark the expected game gave; before that, it is set when the expected game's
 * scheduled start is at or before that instant; with neither game known, it is not set.
 */
export function isDetectedAfterTipOff(input: LateDetectionInput): boolean {
  const tipOffAt = input.measuredGameStartAt ?? input.expectedGameStartAt;
  return tipOffAt !== null && tipOffAt <= input.createdAt;
}
