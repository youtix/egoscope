import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { SOURCES } from '../units';

import type { FamilyEntries } from '../entry';

// The default and bounds of 05 Backtest request (module map §6, CL-TRV-16).
const MAX_SOURCES = 3;
const MOST_SOURCES = 10;

const entry = entriesOf(1);

/** The parameters of 05 Backtest request (BKT-21, H-BKT-09). */
export const BACKTESTS = {
  'backtests.maxSourcesPerEvent': entry({
    label: 'Maximum sources per event',
    sentence: 'How many sources the research prompt asks for, and an import keeps, for each event.',
    unit: 'sources',
    kind: integer(1, MOST_SOURCES, SOURCES),
    defaultValue: MAX_SOURCES,
    requirement: 'BKT-21',
    source: 'H-BKT-09',
  }),
} as const satisfies FamilyEntries<'backtests'>;
