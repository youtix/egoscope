import { entriesOf } from '../entry';
import { decimal, integer } from '../kinds';
import { GAP_BOUNDS, noun } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 10 Automatic tracking and validation (module map §6, CL-TRV-16).
const CATEGORY_THRESHOLD = 0.25;
const MIN_TRACKED_CASES = 10;
const MOST_MIN_TRACKED_CASES = 200;

const entry = entriesOf(2);

/** The parameters of 10 Automatic tracking and validation (SUI-22, SUI-26): both affect calculations. */
export const TRACKING = {
  'tracking.categoryThreshold': entry({
    label: 'Category threshold',
    sentence:
      'A tracked case is confirmed when its gap in forecast direction reaches this, belied when it reaches the opposite.',
    unit: 'normalized gap in forecast direction',
    kind: decimal(GAP_BOUNDS),
    defaultValue: CATEGORY_THRESHOLD,
    requirement: 'SUI-22',
    source: 'H-SUI-05',
    affectsCalculations: true,
  }),
  'tracking.minTrackedCasesForAssessment': entry({
    label: 'Minimum tracked cases for an assessment',
    sentence:
      'The validation table gives an assessment only from this many tracked cases with a frozen forecast.',
    unit: 'tracked cases with a frozen forecast',
    kind: integer(1, MOST_MIN_TRACKED_CASES, noun('tracked case', 'tracked cases')),
    defaultValue: MIN_TRACKED_CASES,
    requirement: 'SUI-26',
    source: 'H-SUI-06',
    affectsCalculations: true,
  }),
} as const satisfies FamilyEntries<'tracking'>;
