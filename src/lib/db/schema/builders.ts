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

// White space of every kind, as escapes of a regular expression: the tab, the line
// breaks and the space, then the Unicode spaces and separators, the non-breaking
// ones and the byte order mark included.
const WHITE_SPACE = String.raw`\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff`;
// A character other than white space, as an SQL literal of a regular expression.
const NOT_ONLY_WHITE_SPACE = sql.raw(`'[^${WHITE_SPACE}]'`);

/**
 * The condition of a CHECK that `column` holds something other than white space,
 * of whatever kind: btrim removes spaces only, so a text of tabs or line breaks
 * alone would pass it. A player's name, a name variant and a type's name are
 * never blank (JOU-08, JOU-09, TAX-01).
 */
export function notBlank(column: PgColumn): SQL {
  return sql`${column} ~ ${NOT_ONLY_WHITE_SPACE}`;
}
