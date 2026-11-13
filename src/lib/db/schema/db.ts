import { sql } from 'drizzle-orm';
import { check, integer, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The first start of the application in production, its go-live: one row
 * (`id = 1`), from which the withdrawn-events counter counts (DSN-29) and the
 * export reminder starts while no full export was ever downloaded (CL-TRV-22).
 * The seed task writes it at the first start. The instant is a `timestamptz`
 * (TRV-68).
 */
export const installation = pgTable(
  'installation',
  {
    id: smallint('id').primaryKey(),
    firstStartedAt: timestamp('first_started_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('installation_id_check', sql`${table.id} = 1`)],
);

/**
 * Gapless numbers: one counter per name, `import_sequence`, or
 * `request_reference_` followed by the four-digit year, incremented in the
 * transaction that uses the number. The counters outlive the rows they
 * numbered, so that no import number or request reference is ever issued twice
 * (IMP-31, BKT-12, CL-BKT-11).
 */
export const sequenceCounters = pgTable(
  'sequence_counters',
  {
    name: text('name').primaryKey(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (table) => [check('sequence_counters_last_value_check', sql`${table.lastValue} >= 0`)],
);
