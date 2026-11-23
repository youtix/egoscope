import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { CHARACTERS } from '../units';

import type { FamilyEntries } from '../entry';

// The default and bounds of 13 Sensitive data (module map §6, CL-TRV-16).
const MAX_DESCRIPTION_LENGTH = 200;
const SHORTEST_CAP = 80;
const LONGEST_CAP = 500;

const entry = entriesOf(1);

/** The parameters of 13 Sensitive data (DSN-20). */
export const EVENTS = {
  'events.maxDescriptionLength': entry({
    label: 'Maximum description length',
    sentence: "The longest description of an event, which also caps the app's other free texts.",
    unit: 'characters, counted in code points after trimming; also caps the other free texts (CL-IMP-26, CL-DET-18, CL-TAX-11)',
    kind: integer(SHORTEST_CAP, LONGEST_CAP, CHARACTERS),
    defaultValue: MAX_DESCRIPTION_LENGTH,
    requirement: 'DSN-20',
    source: 'H-DSN-01',
  }),
} as const satisfies FamilyEntries<'events'>;
