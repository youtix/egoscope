import { getTableConfig, PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { bytea, notBlank, oneOf, subsetOf, timestamptz } from './builders';

import type { SQL } from 'drizzle-orm';

// A table whose columns the conditions name, as a schema file's checks do.
const probes = pgTable('probes', {
  kind: text('kind'),
  causes: text('causes').array(),
  seenAt: timestamptz('seen_at'),
  digest: bytea('digest'),
});

/** The SQL text of `condition`, as drizzle-kit writes it into a migration. */
const sqlOf = (condition: SQL): string => new PgDialect().sqlToQuery(condition).sql;

describe('the schema builders', () => {
  it('hold a column to the values of a stored set, each quoted as an SQL literal', () => {
    expect(sqlOf(oneOf(probes.kind, ['open', 'closed']))).toBe(
      `"probes"."kind" IN ('open', 'closed')`,
    );
    expect(sqlOf(oneOf(probes.kind, ["owner's"]))).toBe(`"probes"."kind" IN ('owner''s')`);
  });

  it('hold every element of an array column to the values of a stored set', () => {
    expect(sqlOf(subsetOf(probes.causes, ['limit_reached', 'not_answering']))).toBe(
      `"probes"."causes" <@ ARRAY['limit_reached', 'not_answering']`,
    );
  });

  it('hold a text to a character other than white space of any kind, which btrim alone misses', () => {
    expect(sqlOf(notBlank(probes.kind))).toBe(
      String.raw`"probes"."kind" ~ '[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'`,
    );
  });

  it('[TRV-68] give an instant the type timestamptz, and bytes the type bytea', () => {
    const types = getTableConfig(probes).columns.map((column) => column.getSQLType());

    expect(types).toStrictEqual(['text', 'text[]', 'timestamp with time zone', 'bytea']);
  });
});
