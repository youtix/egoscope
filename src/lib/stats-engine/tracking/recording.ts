// The recording timing of a tracked case (SUI-06, CL-SUI-03, CL-SUI-13, CL-DET-16): recorded
// in time or after tip-off, from its creation instant and the last known scheduled start of
// the game it is judged against, the only instant that the rules compare.

import type { EpochMs } from '../types';

/** The glossary's `RecordingTiming` (SUI-06): recorded in time or after tip-off. */
export type RecordingTiming = 'recorded_in_time' | 'recorded_after_tip_off';

/** What a tracked case's recording timing is judged from (SUI-06, CL-DET-16). */
export type RecordingTimingInput = Readonly<{
  /** The case's creation instant. */
  createdAt: EpochMs;
  /** The last known scheduled start of its current measured game, null until one is established. */
  measuredGameStartAt: EpochMs | null;
  /** The last known scheduled start of its expected game, null while none is known. */
  expectedGameStartAt: EpochMs | null;
}>;

/**
 * Gives a tracked case's recording timing (SUI-06, CL-SUI-13, CL-DET-16, CL-SUI-03): recorded
 * in time when its creation instant is strictly before the scheduled start of its measured
 * game, recorded after tip-off otherwise. While no measured game is established it is judged
 * against the expected game, and it is undetermined, null, without either. After a
 * post-tip-off decision changes the measured game, it follows the new game, while the frozen
 * forecast stays the one chosen against the first.
 */
export function recordingTiming(input: RecordingTimingInput): RecordingTiming | null {
  const startAt = input.measuredGameStartAt ?? input.expectedGameStartAt;
  if (startAt === null) {
    return null;
  }
  return input.createdAt < startAt ? 'recorded_in_time' : 'recorded_after_tip_off';
}
