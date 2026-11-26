import { asc, SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTestDatabase, eventTypes, parameterChanges, parameterOverrides } from '@/lib/db';
import { list, record } from '@/lib/journal';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { getParam, lastCalculationChange, listRegistry } from './accessors';
import { noteCalculationChange, resetParam, setParam } from './overrides';

import type { ParamValue } from './catalog';
import type { OverridableKey } from './entry';
import type { Database, Transaction } from '@/lib/db';

const SAVED_AT = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const RETENTION = 'journal.retentionDays';
const SWITCH = 'taxonomy.switchedOffCriterion';

/** The rows of the result of a raw query. */
const rowsOf = (result: unknown): readonly unknown[] =>
  z.object({ rows: z.array(z.unknown()) }).parse(result).rows;

const LOCK_STATEMENT = 'select pg_advisory_xact_lock(hashtext($1)) ["egoscope.parameter-saves"]';

/**
 * `tx` as it is, with every call that starts a statement noted in `statements`, in order: a
 * raw statement by its text and parameters, any other by the name of the method.
 */
function recordingStatements(tx: Transaction, statements: string[]): Transaction {
  const dialect = new PgDialect();
  return new Proxy(tx, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== 'function') {
        return member;
      }
      return (...args: readonly unknown[]) => {
        const [first] = args;
        if (property === 'execute' && first instanceof SQL) {
          const { sql: text, params } = dialect.sqlToQuery(first);
          statements.push(`${text} ${JSON.stringify(params)}`);
        } else {
          statements.push(String(property));
        }
        return Reflect.apply(member, target, args) as unknown;
      };
    },
  });
}

const REFUSED_RETENTION = {
  ok: false,
  error: { kind: 'out_of_bounds', explanation: 'Journal retention accepts 7 to 365 days.' },
};
const PLAN = {
  computedAt: SAVED_AT,
  entries: [{ task: 'purge', dueAt: toEpochMs(SAVED_AT + 3_600_000) }],
  probes: [],
} as const;

/** The params and the wake plan as a deployment loads them, over the process's fake cache. */
async function deployment() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_first');
  const wakePlan = await import('@/lib/wake-plan');
  const params = await import('.');
  return { ...wakePlan, ...params };
}

describe('the overrides of the parameters', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(SAVED_AT));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, 60_000);

  /** Saves `value` as the value of `key`, in a transaction of its own. */
  async function save<K extends OverridableKey>(key: K, value: ParamValue<K>, version: number) {
    return db.transaction(async (tx) => setParam(tx, { key, value, expectedVersion: version }));
  }

  /** Restores the default of the journal retention, in a transaction of its own. */
  async function resetRetention(version: number) {
    return db.transaction(async (tx) =>
      resetParam(tx, { key: RETENTION, expectedVersion: version }),
    );
  }

  /** The texts of the journal, newest first. */
  async function journal(): Promise<readonly string[]> {
    const page = await list(db, { timeZone: 'Europe/Paris', pageSize: 10 });
    return page.entries.map(({ text }) => text);
  }

  /** The history of the changes, oldest first. */
  async function history() {
    return db
      .select({
        parameterKey: parameterChanges.parameterKey,
        changedAt: parameterChanges.changedAt,
        oldValue: parameterChanges.oldValue,
        newValue: parameterChanges.newValue,
        affectsCalculations: parameterChanges.affectsCalculations,
        journalEntryId: parameterChanges.journalEntryId,
      })
      .from(parameterChanges)
      .orderBy(asc(parameterChanges.id));
  }

  it('[TRV-35] [TRV-36] saves a value within its bounds, which the next read uses', async () => {
    const before = await getParam(db, RETENTION);
    const saved = await save(RETENTION, 120, 0);

    expect([before, saved]).toStrictEqual([90, { ok: true, value: { changed: true, version: 1 } }]);
    expect(await getParam(db, RETENTION)).toBe(120);
  });

  it('[TRV-35] [TRV-41] [TRV-42] journals a change by its label with both values written with their unit, and keeps them with its instant', async () => {
    await save(RETENTION, 120, 0);
    const page = await list(db, { timeZone: 'Europe/Paris', pageSize: 10 });

    expect(page.entries.map(({ text }) => text)).toStrictEqual([
      'Journal retention changed from 90 days to 120 days. The new value applies from now on. What to do: nothing.',
    ]);
    expect(await history()).toStrictEqual([
      {
        parameterKey: RETENTION,
        changedAt: new Date(SAVED_AT),
        oldValue: 90,
        newValue: 120,
        affectsCalculations: false,
        journalEntryId: page.entries[0]?.id,
      },
    ]);
  });

  it('[TRV-35] [CA-TRV-11] [CL-TRV-16] refuses a value outside its bounds with a plain explanation, and changes nothing', async () => {
    const refusals = [await save(RETENTION, 366, 0), await save(RETENTION, 6, 0)];

    expect(refusals).toStrictEqual([REFUSED_RETENTION, REFUSED_RETENTION]);
    expect(await getParam(db, RETENTION)).toBe(90);
    expect([await journal(), await history()]).toStrictEqual([[], []]);
  });

  it('[CL-TRV-16] [CA-TRV-11] refuses a value that breaks a bound with another parameter, naming its value in force', async () => {
    const tooHigh = await save('players.indicativeMin', 31, 0);
    await save('players.indicativeMin', 25, 0);
    const belowMinimum = await save('players.maxActive', 24, 0);

    expect([tooHigh, belowMinimum]).toStrictEqual([
      {
        ok: false,
        error: {
          kind: 'out_of_bounds',
          explanation:
            'Indicative minimum of players accepts 0 to 100 active players, at most the maximum; 0 means no reminder. Maximum active players is 30 active players.',
        },
      },
      {
        ok: false,
        error: {
          kind: 'out_of_bounds',
          explanation:
            'Maximum active players accepts 1 to 100 active players, at least the indicative minimum. Indicative minimum of players is 25 active players.',
        },
      },
    ]);
    expect(await save('players.maxActive', 25, 0)).toStrictEqual({
      ok: true,
      value: { changed: true, version: 1 },
    });
  });

  it('[CL-TRV-16] [CA-TRV-11] refuses to restore a default that would break a bound with another parameter', async () => {
    await save('players.maxActive', 60, 0);
    await save('players.indicativeMin', 50, 0);

    expect(
      await db.transaction(async (tx) =>
        resetParam(tx, { key: 'players.maxActive', expectedVersion: 1 }),
      ),
    ).toStrictEqual({
      ok: false,
      error: {
        kind: 'out_of_bounds',
        explanation:
          'Maximum active players accepts 1 to 100 active players, at least the indicative minimum. Indicative minimum of players is 50 active players.',
      },
    });
    expect(await getParam(db, 'players.maxActive')).toBe(60);
  });

  it('[CL-TRV-16] holds one lock over every save and reset of a parameter until its transaction ends', async () => {
    const advisoryLocks = sql`select count(*)::int as held from pg_locks where locktype = 'advisory'`;
    const held: unknown[] = [];
    await db.transaction(async (tx) => {
      await setParam(tx, { key: RETENTION, value: 120, expectedVersion: 0 });
      const afterSave = await tx.execute(advisoryLocks);
      held.push(rowsOf(afterSave));
      await resetParam(tx, { key: RETENTION, expectedVersion: 1 });
      const afterReset = await tx.execute(advisoryLocks);
      held.push(rowsOf(afterReset));
    });
    const afterCommit = await db.execute(advisoryLocks);
    held.push(rowsOf(afterCommit));

    expect(held).toStrictEqual([[{ held: 1 }], [{ held: 1 }], [{ held: 0 }]]);
  });

  it('[CL-TRV-16] takes the lock before every read of a save, the bound check included', async () => {
    const statements: string[] = [];
    const saved = await db.transaction(async (tx) =>
      setParam(recordingStatements(tx, statements), {
        key: 'players.maxActive',
        value: 25,
        expectedVersion: 0,
      }),
    );

    expect(saved).toStrictEqual({ ok: true, value: { changed: true, version: 1 } });
    expect(statements[0]).toBe(LOCK_STATEMENT);
    expect(statements.slice(1)).toContain('select');
  });

  it('[CL-TRV-16] takes the lock before every read of a reset, the version check and the bound check included', async () => {
    await save('players.maxActive', 25, 0);
    const statements: string[] = [];
    const reset = await db.transaction(async (tx) =>
      resetParam(recordingStatements(tx, statements), {
        key: 'players.maxActive',
        expectedVersion: 1,
      }),
    );

    expect(reset).toStrictEqual({ ok: true, value: { changed: true, version: 2 } });
    expect(statements[0]).toBe(LOCK_STATEMENT);
    expect(statements.slice(1)).toContain('select');
  });

  it('[CL-IHM-18] refuses a save sent with a stale version, with the value as it now stands', async () => {
    await save(RETENTION, 120, 0);

    expect(await save(RETENTION, 150, 0)).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: { value: 120, version: 1 } },
    });
    expect(await save(RETENTION, 150, 1)).toStrictEqual({
      ok: true,
      value: { changed: true, version: 2 },
    });
    expect(await getParam(db, RETENTION)).toBe(150);
  });

  it('[TRV-35] changes nothing for a value equal to the one in force', async () => {
    expect(await save(RETENTION, 90, 0)).toStrictEqual({
      ok: true,
      value: { changed: false, version: 0 },
    });
    expect([await journal(), await history()]).toStrictEqual([[], []]);
  });

  it('[TRV-35] [TRV-41] restores the default, journaled, and kept in the history', async () => {
    await save(RETENTION, 120, 0);
    const restored = await resetRetention(1);
    const [newest] = await journal();
    const changes = await history();

    expect(restored).toStrictEqual({ ok: true, value: { changed: true, version: 2 } });
    expect(await getParam(db, RETENTION)).toBe(90);
    expect(newest).toBe(
      'Journal retention went back to its default value, 90 days; it was 120 days. The default value applies from now on. What to do: nothing.',
    );
    expect(changes.at(-1)).toMatchObject({ oldValue: 120, newValue: 90 });
  });

  it('[CL-IHM-18] never gives back after a reset a version once shown', async () => {
    await save(RETENTION, 120, 0);
    await resetRetention(1);

    expect(await save(RETENTION, 130, 1)).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: { value: 90, version: 2 } },
    });
    expect(await save(RETENTION, 130, 2)).toStrictEqual({
      ok: true,
      value: { changed: true, version: 3 },
    });
  });

  it('[TRV-35] [CL-IHM-18] restores nothing at the default, and refuses a stale reset', async () => {
    expect(await resetRetention(0)).toStrictEqual({
      ok: true,
      value: { changed: false, version: 0 },
    });
    await save(RETENTION, 120, 0);

    expect(await resetRetention(0)).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: { value: 120, version: 1 } },
    });
    expect(await db.select().from(parameterOverrides)).toHaveLength(1);
  });

  it('[TRV-35] [CL-TRV-17] journals the change of a Calc parameter with the recalculation it brings', async () => {
    await save('sensitivity.minValidCases', 6, 0);
    const [change] = await history();

    expect(await journal()).toStrictEqual([
      'Valid cases for a player verdict changed from 5 valid cases to 6 valid cases. Every profile is recalculated with it, and the date of the last parameter change moves. What to do: nothing.',
    ]);
    expect(change?.affectsCalculations).toBe(true);
  });

  it('[TRV-35] [TRV-42] [CL-TRV-17] journals the reset of a Calc parameter with the recalculation it brings, and moves the date of the last change', async () => {
    await save('sensitivity.minValidCases', 6, 0);
    const reset = await db.transaction(async (tx) =>
      resetParam(tx, { key: 'sensitivity.minValidCases', expectedVersion: 1 }),
    );
    const [newest] = await journal();
    const changes = await history();
    const resetChange = changes.at(-1);

    expect(reset).toStrictEqual({ ok: true, value: { changed: true, version: 2 } });
    expect(newest).toBe(
      'Valid cases for a player verdict went back to its default value, 5 valid cases; it was 6 valid cases. The default value applies from now on. Every profile is recalculated with it, and the date of the last parameter change moves. What to do: nothing.',
    );
    expect(resetChange).toMatchObject({ affectsCalculations: true, oldValue: 6, newValue: 5 });
    expect(await lastCalculationChange(db)).toStrictEqual({
      changedAt: SAVED_AT,
      journalEntryId: resetChange?.journalEntryId,
    });
  });

  it('[CL-TRV-17] [IHM-37] refuses to save or reset the per-type criterion switch, which the types set', async () => {
    const explanation =
      'This setting is set on each type sheet, with the confirmation of its consequence.';
    const refusals = await db.transaction(async (tx) => [
      // @ts-expect-error -- the switch holds no value of its own.
      await setParam(tx, { key: SWITCH, value: 'SEN-12', expectedVersion: 0 }),
      // @ts-expect-error -- the switch holds no value of its own.
      await resetParam(tx, { key: SWITCH, expectedVersion: 0 }),
    ]);

    expect(refusals).toStrictEqual([
      { ok: false, error: { kind: 'read_only', explanation } },
      { ok: false, error: { kind: 'read_only', explanation } },
    ]);
    expect(await db.select().from(parameterOverrides)).toStrictEqual([]);
  });

  it('[IHM-14] [CL-IHM-05] stores a time zone in the spelling of the zone database, and journals it by its city', async () => {
    const sameZone = await save('display.timeZone', 'europe/paris', 0);
    const unknown = await save('display.timeZone', 'Mars/Olympus', 0);
    await save('display.timeZone', 'america/new_york', 0);

    expect([sameZone, unknown]).toStrictEqual([
      { ok: true, value: { changed: false, version: 0 } },
      {
        ok: false,
        error: {
          kind: 'out_of_bounds',
          explanation: 'Time zone accepts any zone of the IANA time-zone database.',
        },
      },
    ]);
    expect(await getParam(db, 'display.timeZone')).toBe('America/New_York');
    expect(await journal()).toStrictEqual([
      'Time zone changed from Paris time to New York time. The new value applies from now on. What to do: nothing.',
    ]);
  });

  it('[TRV-03] [CL-TRV-16] takes a quota limit once entered, and refuses to blank it', async () => {
    await save('quotas.statsSource.requestsPerDay', 100_000, 0);
    const [change] = await history();

    expect(await save('quotas.statsSource.requestsPerDay', null, 1)).toMatchObject({
      ok: false,
      error: { kind: 'out_of_bounds' },
    });
    expect(await journal()).toStrictEqual([
      'Quota limits per service — the stats source, requests a day changed from not set to 100,000 requests. The new value applies from now on. What to do: nothing.',
    ]);
    expect(change).toMatchObject({ oldValue: null, newValue: 100_000 });
  });

  it('[TRV-35] [CL-TRV-17] moves the date of the last change when a type switches a criterion off, without a value of its own', async () => {
    await db.insert(eventTypes).values({ id: 'trade-request', origin: 'scoping', name: 'Trade' });
    const journalEntryId = await db.transaction(async (tx) => {
      const id = await record(tx, {
        messageKey: 'criterion_switch_changed',
        eventTypeId: 'trade-request',
      });
      await noteCalculationChange(tx, {
        oldValue: null,
        newValue: 'playing_time_too_low',
        journalEntryId: id,
      });
      return id;
    });
    const rows = await listRegistry(db, 1);

    expect(await lastCalculationChange(db)).toStrictEqual({ changedAt: SAVED_AT, journalEntryId });
    expect(await history()).toStrictEqual([
      {
        parameterKey: SWITCH,
        changedAt: new Date(SAVED_AT),
        oldValue: null,
        newValue: 'playing_time_too_low',
        affectsCalculations: true,
        journalEntryId,
      },
    ]);
    expect(rows.find(({ key }) => key === SWITCH)?.setting).toBeNull();
  });

  describe('the wake plan', () => {
    beforeEach(() => {
      vi.stubGlobal(PROCESS_FAKE, undefined);
    });

    it('[TRV-25] [TRV-36] drops the plan when a Sched parameter or the time zone changes, and keeps it otherwise', async () => {
      const { readPlan, resetParam: restore, setParam: change, writePlan } = await deployment();
      const isPlanKept = async () => {
        const reading = await readPlan(SAVED_AT);
        return reading.ok;
      };
      const kept: boolean[] = [];
      await writePlan(PLAN);

      await db.transaction(async (tx) =>
        change(tx, { key: RETENTION, value: 120, expectedVersion: 0 }),
      );
      kept.push(await isPlanKept());
      await db.transaction(async (tx) =>
        change(tx, { key: 'scheduler.purgeTime', value: '05:00', expectedVersion: 0 }),
      );
      kept.push(await isPlanKept());
      await writePlan(PLAN);
      await db.transaction(async (tx) =>
        change(tx, { key: 'display.timeZone', value: 'America/New_York', expectedVersion: 0 }),
      );
      kept.push(await isPlanKept());
      await writePlan(PLAN);
      await db.transaction(async (tx) =>
        restore(tx, { key: 'scheduler.purgeTime', expectedVersion: 1 }),
      );
      kept.push(await isPlanKept());

      expect(kept).toStrictEqual([true, false, false, false]);
    });
  });
});
