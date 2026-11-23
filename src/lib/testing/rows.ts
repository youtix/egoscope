import type { ConditionalRead, StatsSourceOutcome } from '@/lib/stats-source';

/**
 * The first of `rows`, which an insert of one row returns or a lookup of a known key
 * finds: none is a bug of the factory or of the scenario that asked, named by `what`.
 */
export function firstRow<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Expected ${what}, found none.`);
  }
  return row;
}

/**
 * `value`, a nullable column that the rows a factory wrote always fill: null is a bug of
 * the factory or of the scenario that asked, named by `what`.
 */
export function present<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`Expected ${what}, found null.`);
  }
  return value;
}

/**
 * What a first read of the statistics-source fake gives: a fresh fake, asked with no
 * version known, always reads, so anything else is a bug of the factory, named by `what`.
 */
export function readData<T>(outcome: StatsSourceOutcome<ConditionalRead<T>>, what: string): T {
  if (!outcome.ok || outcome.value.kind !== 'read') {
    throw new Error(`Expected ${what} from the statistics-source fake, which did not read.`);
  }
  return outcome.value.data;
}
