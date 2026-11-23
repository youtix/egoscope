import { factsOf } from '../entry';

import type { EntryFacts } from '../entry';

/** The key of the per-type criterion switch, which holds no value of its own (ADR 0016). */
export const SWITCHED_OFF_CRITERION_KEY = 'taxonomy.switchedOffCriterion';

/**
 * The per-type doubtful-criterion switch (ADR 0016, CL-TAX-17), listed only for its
 * "affects calculations" mark: its value lives on each type sheet, where it is set
 * with the confirmation of IHM-37, so it never has an override (CL-TRV-17, CL-IHM-12).
 */
export const SWITCHED_OFF_CRITERION: EntryFacts = factsOf(
  {
    label: 'Criterion switched off',
    sentence:
      'The doubtful-case criterion that one event type ignores; it is set on the type sheet.',
    unit: 'one doubtful-case criterion of a type',
    allowed:
      'at most one of SEN-12 to SEN-15, or SEN-06 while "Treat co-occurring cases as doubtful" is on',
    requirement: 'TAX-01',
    source: 'ADR 0016',
    affectsCalculations: true,
    editedOn: '/types',
  },
  1,
);
