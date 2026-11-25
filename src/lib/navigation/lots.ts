import { activeLot } from '@/lib/env';

import type { Lot } from '@/lib/env';

/**
 * The lot gate (ADR 0001, module map section 3.1): whether this build serves the screens,
 * blocks, menu items and reactions of `lot`. Lot 1 is always served; Lot 2 only while
 * EGOSCOPE_LOT is 2, and its routes answer "not found" otherwise (IHM-16).
 */
export function isLotActive(lot: Lot): boolean {
  return lot <= activeLot();
}
