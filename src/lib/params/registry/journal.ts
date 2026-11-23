import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { DAYS, DAYS_PER_WEEK, DAYS_PER_YEAR } from '../units';

import type { FamilyEntries } from '../entry';

// The default of 14 Cross-cutting requirements (module map §6, CL-TRV-16).
const RETENTION_DAYS = 90;

const entry = entriesOf(1);

/** The parameters of the activity journal (TRV-48). */
export const JOURNAL = {
  'journal.retentionDays': entry({
    label: 'Journal retention',
    sentence: 'How long the entries of the activity journal are kept.',
    unit: 'days',
    kind: integer(DAYS_PER_WEEK, DAYS_PER_YEAR, DAYS),
    defaultValue: RETENTION_DAYS,
    requirement: 'TRV-48',
    source: 'H-TRV-08',
  }),
} as const satisfies FamilyEntries<'journal'>;
