// The supplements that the app proposes and creates only once the owner accepts them
// (CL-BKT-25): one limited to a type after its validation, reactivation or broadening
// (BKT-05), and one for what an import left uncovered (BKT-06). Both are computed from
// the coverage whenever they are shown, never stored (CL-BKT-26), with the counting
// periods and first uncovered days that the extents use (CL-BKT-05).

import { countingPeriods } from './counting';
import { supplementExtent } from './extents';

import type { IsoDate } from '../types';
import type { TypeCoverage } from './counting';
import type { CoveredResearchType, ExtentResult } from './extents';

/**
 * Whether an already-processed player is proposed the supplement of a research type
 * (BKT-05, CL-BKT-26): while no period of his coverage counts for the type (CL-BKT-05
 * rule 1), because it was never covered, or only under a sheet version older than its
 * latest broadening version, whatever the order of his imports and of the type's
 * validation, reactivation or broadening. The proposal lasts as long as that gap, and
 * the supplement asks the type over his whole career (BKT-09). The caller lists the
 * players with at least one saved import (BKT-10) and research types only (CL-BKT-03).
 */
export function isTypeSupplementNeeded(coverage: TypeCoverage): boolean {
  return countingPeriods(coverage).length === 0;
}

/**
 * The supplement offered after an import (BKT-06, CL-BKT-07): every planned type of the
 * imported request, those that a reduction took out of its prompt included, that still
 * has an uncovered day up to the day the owner accepts it, each from its first
 * uncovered day to that day, his calendar date (CL-BKT-05, CL-BKT-10); a type complete
 * by then is left out, and `coverage_complete` means that there is nothing left to
 * offer. Nothing exists before the acceptance, whose day ends the periods. Throws a
 * RangeError for a calendar-derived type, which no request plans (CL-BKT-03).
 */
export function incompleteImportSupplement(
  plannedTypes: readonly CoveredResearchType[],
  firstNbaGameOn: IsoDate | undefined,
  acceptedOn: IsoDate,
): ExtentResult {
  return supplementExtent(plannedTypes, firstNbaGameOn, acceptedOn);
}
