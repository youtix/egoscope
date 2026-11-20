import { sql } from 'drizzle-orm';
import { customType, timestamp } from 'drizzle-orm/pg-core';

import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTimestampBuilderInitial } from 'drizzle-orm/pg-core';

/**
 * A column that holds an absolute instant, `timestamptz`, read as a Date: no
 * table stores a naive local timestamp (TRV-68).
 */
export function timestamptz<TName extends string>(name: TName): PgTimestampBuilderInitial<TName> {
  return timestamp(name, { withTimezone: true });
}

/**
 * A `bytea` column, which Drizzle does not provide: raw bytes, such as the hash
 * kept in the place of a secret (TRV-64).
 */
export const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });

/** The values of a stored set as SQL string literals, quotes doubled: 'open', 'closed'. */
function literals(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));
}

/**
 * The condition of a CHECK that holds `column` to one value of a stored set,
 * built from the one `as const` array of its values, as the data model's
 * conventions ask of every enumeration. A null passes, as in any CHECK.
 */
export function oneOf(column: PgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${literals(values)})`;
}

/** The condition of a CHECK that holds every element of the array `column` to a stored set. */
export function subsetOf(column: PgColumn, values: readonly string[]): SQL {
  return sql`${column} <@ ARRAY[${literals(values)}]`;
}
