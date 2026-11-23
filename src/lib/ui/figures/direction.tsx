import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The direction of a sensitivity or a verdict, by its stored value (SEN-24): the
 * figures' copy of the engine's `VerdictDirection`, which `ui` cannot import, kept
 * equal to it by a type test of the gallery.
 */
export type FigureVerdictDirection = 'increase' | 'decrease';

// The one look of both directions: the size and color of the text around it, and one
// weight for both, so that neither reads as good or bad news (IHM-47, H-04).
const DIRECTION_CLASSES = 'font-medium';

/** The word of a direction, "increase" or "decrease" (SEN-24, IHM-47). */
export function directionWord(direction: FigureVerdictDirection): string {
  return sentence(direction === 'increase' ? 'sensitivity.increase' : 'sensitivity.decrease');
}

/**
 * The direction that a written gap shows by its sign, "+0.60" an increase and
 * "−0.60" a decrease, and none for a gap that rounds to zero, "0.00" (IHM-47,
 * CL-IHM-03).
 */
export function shownDirection(writtenGap: string): FigureVerdictDirection | undefined {
  if (writtenGap.startsWith('+')) {
    return 'increase';
  }
  return writtenGap.startsWith('\u{2212}') ? 'decrease' : undefined;
}

export type DirectionProps = Readonly<{ direction: FigureVerdictDirection }>;

/**
 * The direction written in full, "increase" or "decrease", beside the sign of a gap
 * (IHM-47, CA-IHM-10). Both directions take the same size, place and style, and the
 * word says the direction, never a color.
 */
export function Direction({ direction }: DirectionProps): ReactNode {
  return <span className={DIRECTION_CLASSES}>{directionWord(direction)}</span>;
}
