// The recording timing of a tracked case (SUI-06, CL-SUI-03, CL-SUI-13, CL-DET-16): recorded
// in time or after tip-off, from its creation instant and the last known scheduled start of
// the game it is judged against, the only instant that the rules compare. The rule is the one
// of a detected event's "detected after tip-off" mark, which CL-DET-16 makes equal to it.

import { isDetectedAfterTipOff } from '../measured-game/late-detection';

import type { LateDetectionInput } from '../measured-game/late-detection';

/** The glossary's `RecordingTiming` (SUI-06): recorded in time or after tip-off. */
export type RecordingTiming = 'recorded_in_time' | 'recorded_after_tip_off';

/**
 * What a tracked case's recording timing is judged from (SUI-06, CL-DET-16): its creation
 * instant and the last known scheduled starts of its measured game, null until one is
 * established, and of its expected game, null while none is known, as for a detected event.
 */
export type RecordingTimingInput = LateDetectionInput;

/**
 * Gives a tracked case's recording timing (SUI-06, CL-SUI-13, CL-DET-16, CL-SUI-03): recorded
 * in time when its creation instant is strictly before the scheduled start of its measured
 * game, recorded after tip-off otherwise. While no measured game is established it is judged
 * against the expected game, and it is undetermined, null, without either. After a
 * post-tip-off decision changes the measured game, it follows the new game, while the frozen
 * forecast stays the one chosen against the first.
 */
export function recordingTiming(input: RecordingTimingInput): RecordingTiming | null {
  if (input.measuredGameStartAt === null && input.expectedGameStartAt === null) {
    return null;
  }
  return isDetectedAfterTipOff(input) ? 'recorded_after_tip_off' : 'recorded_in_time';
}
