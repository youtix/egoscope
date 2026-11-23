import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { POINTS, WHOLE } from '../units';

import type { FamilyEntries } from '../entry';

// The default of 09 Alert sheet (module map §6, CL-TRV-16).
const VIGILANCE_MARGIN = 10;

const entry = entriesOf(2);

/** The parameters of 09 Alert sheet (ALE-16), read in Lot 2 only. */
export const ALERTS = {
  'alerts.confidenceVigilanceMargin': entry({
    label: 'Vigilance margin',
    sentence:
      'An alert whose detection confidence is less than this above the threshold is marked for vigilance.',
    unit: 'points above the detection threshold',
    kind: integer(0, WHOLE, POINTS),
    defaultValue: VIGILANCE_MARGIN,
    requirement: 'ALE-16',
    source: 'H-ALE-06',
  }),
} as const satisfies FamilyEntries<'alerts'>;
