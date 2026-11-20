// What a player's coverage of one research type already holds (CL-BKT-05, rules 1 to
// 3): the covered periods that count, and the first day of his career that they leave
// uncovered. The extents of supplements, the coverage reads and the proposals of
// supplements share these rules. Dates are calendar dates written YYYY-MM-DD, compared
// as written (CL-IMP-09).

import type { IsoDate } from '../types';

/**
 * A period of a player's coverage of one type, both days included, with the sheet
 * version it was researched under (BKT-10): a row of `backtest_coverage_periods`, whose
 * version is 0 for a period that a type born of a split inherited (CL-BKT-06).
 */
export type CoveredPeriod = Readonly<{
  startOn: IsoDate;
  endOn: IsoDate;
  sheetVersionNumber: number;
}>;

/**
 * A player's coverage of one type: its covered periods, and the type's latest
 * broadening version, the latest version that TAX-24 applies to, that of a merge or a
 * split included (CL-BKT-06), or `undefined` when the type has none.
 */
export type TypeCoverage = Readonly<{
  coveredPeriods: readonly CoveredPeriod[];
  latestBroadeningVersion: number | undefined;
}>;

// A date written YYYY-MM-DD is the start of an instant written in ISO 8601.
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

// The calendar date right after `day`, in the same calendar. A day not written
// YYYY-MM-DD makes no date, which toISOString refuses with a RangeError: a bug.
function dayAfter(day: IsoDate): IsoDate {
  const [year = NaN, month = NaN, date = NaN] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, ISO_DATE_LENGTH);
}

// The first day from `day` on that lies in no counting period (rule 3): past the end of
// each period that holds it, until none does.
function uncoveredFrom(day: IsoDate, counting: readonly CoveredPeriod[]): IsoDate {
  const holding = counting.find((period) => period.startOn <= day && day <= period.endOn);
  return holding === undefined ? day : uncoveredFrom(dayAfter(holding.endOn), counting);
}

/**
 * The covered periods of a type that count (BKT-09, CL-BKT-05 rule 1): those recorded
 * under a sheet version that is not older than the type's latest broadening version,
 * since a type broadened since its last research is searched again over the whole
 * career, and all of them when the type has no broadening version. A merge or a split
 * that broadens a type stops the periods it inherited from counting (CL-BKT-06).
 */
export function countingPeriods(coverage: TypeCoverage): readonly CoveredPeriod[] {
  const { coveredPeriods, latestBroadeningVersion } = coverage;
  return latestBroadeningVersion === undefined
    ? coveredPeriods
    : coveredPeriods.filter((period) => period.sheetVersionNumber >= latestBroadeningVersion);
}

/**
 * The first day of a type that a player's coverage leaves uncovered (BKT-09, CL-BKT-05
 * rules 2 and 3): the earliest day, from the start of his career on, that lies in no
 * counting period. His career starts on his first NBA game's US date (STA-47,
 * CL-STA-12, CL-TRV-03) or, while the app does not know that date, on the earliest start
 * among the counting periods; with neither, the first uncovered day is unknown
 * (`undefined`). A type with no counting period is uncovered from the start of his
 * career, and a hole in the coverage is uncovered from its first day.
 */
export function firstUncoveredOn(
  coverage: TypeCoverage,
  firstNbaGameOn: IsoDate | undefined,
): IsoDate | undefined {
  const counting = countingPeriods(coverage);
  if (firstNbaGameOn !== undefined) {
    return uncoveredFrom(firstNbaGameOn, counting);
  }
  // The counting period that no other starts before opens his career.
  const earliest = counting.find((period) =>
    counting.every((other) => period.startOn <= other.startOn),
  );
  return earliest === undefined ? undefined : uncoveredFrom(earliest.startOn, counting);
}
