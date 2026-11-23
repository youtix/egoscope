import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  createTestDatabase,
  parameterChanges,
  parameterOverrides,
  parameterSnapshots,
} from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import registryKeys from '@data/fixtures/params/registry-keys.json';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import {
  getParam,
  getParams,
  lastCalculationChange,
  listRegistry,
  snapshotCalculationParams,
  valueAt,
} from './accessors';
import { resetParam, setParam } from './overrides';

import type { ParamValue } from './catalog';
import type { OverridableKey } from './entry';
import type { Database } from '@/lib/db';
import type { EpochMs, FixedClock } from '@/lib/time';

const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const HOUR = 3_600_000;
const SWITCH = 'taxonomy.switchedOffCriterion';
const RETENTION = 'journal.retentionDays';
const THRESHOLD = 'tracking.categoryThreshold';

// The values of the engine's parameters by their keys, in code-point order.
const ENGINE_DEFAULTS = Object.fromEntries(
  Object.entries(engineParams)
    .flatMap(([family, values]) =>
      Object.entries(values).map(([name, value]) => [`${family}.${name}`, value] as const),
    )
    .toSorted(([left], [right]) => (left < right ? -1 : 1)),
);

/** The instant `hours` after the start. */
const at = (hours: number): EpochMs => toEpochMs(START + hours * HOUR);

describe('the values of the parameters', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(START);
    const restoreClock = installFakeClock(clock);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, 60_000);

  /** Saves `value` as the value of `key`, in a transaction of its own. */
  async function save<K extends OverridableKey>(key: K, value: ParamValue<K>, version: number) {
    return db.transaction(async (tx) => setParam(tx, { key, value, expectedVersion: version }));
  }

  /** Restores the default of `key`, in a transaction of its own. */
  async function reset(key: OverridableKey, version: number) {
    return db.transaction(async (tx) => resetParam(tx, { key, expectedVersion: version }));
  }

  /** The row of `key` on the parameters screen while only Lot 1 runs. */
  async function rowOf(key: string) {
    const rows = await listRegistry(db, 1);
    return rows.find((row) => row.key === key);
  }

  it('[TRV-36] [TRV-38] reads each value with the type of its key, and refuses at run time a value of another type', async () => {
    expectTypeOf(getParam(db, 'players.maxActive')).resolves.toEqualTypeOf<number>();
    expectTypeOf(getParam(db, 'collection.times')).resolves.toEqualTypeOf<readonly string[]>();
    expectTypeOf(getParam(db, 'games.postseasonBaseline')).resolves.toEqualTypeOf<
      'postseason' | 'regular_season'
    >();
    expectTypeOf(getParam(db, 'quotas.groq.tokensPerDay')).resolves.toEqualTypeOf<number | null>();
    // @ts-expect-error -- no parameter has this key.
    expectTypeOf(getParam).toBeCallableWith(db, 'players.minimum');
    const refused = await db.transaction(async (tx) =>
      // @ts-expect-error -- the maximum of active players is a number.
      setParam(tx, { key: 'players.maxActive', value: 'thirty', expectedVersion: 0 }),
    );

    expect(refused).toMatchObject({ ok: false, error: { kind: 'out_of_bounds' } });
    expect([
      await getParam(db, 'players.maxActive'),
      await getParam(db, 'collection.times'),
      await getParam(db, 'notifications.quietHours'),
      await getParam(db, 'quotas.groq.tokensPerDay'),
    ]).toStrictEqual([30, ['16:30', '23:00'], { start: '23:00', end: '08:00' }, null]);
  });

  it('[TRV-36] reads every value in force from one read, overrides and defaults alike', async () => {
    await save('players.maxActive', 25, 0);
    await save('collection.times', ['07:00', '16:30', '23:00'], 0);
    const params = await getParams(db);

    expect([
      params.get('players.maxActive'),
      params.get('collection.times'),
      params.get(RETENTION),
    ]).toStrictEqual([25, ['07:00', '16:30', '23:00'], 90]);
  });

  it('[TRV-36] [CL-TRV-16] reads as its default a stored value that the registry no longer accepts', async () => {
    await db.insert(parameterOverrides).values({
      parameterKey: RETENTION,
      value: 1000,
      changedAt: new Date(START),
    });
    const params = await getParams(db);

    expect([await getParam(db, RETENTION), params.get(RETENTION)]).toStrictEqual([90, 90]);
  });

  it('[SUI-08] [TRV-35] gives the value that a parameter had at an instant, from the history of its changes', async () => {
    clock.advance(HOUR);
    await save(THRESHOLD, 0.3, 0);
    clock.advance(2 * HOUR);
    await save(THRESHOLD, 0.35, 1);
    clock.advance(2 * HOUR);
    await reset(THRESHOLD, 2);
    const thresholds = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map(async (hours) => valueAt(db, THRESHOLD, at(hours))),
    );

    expect(thresholds).toStrictEqual([0.25, 0.3, 0.3, 0.35, 0.35, 0.25, 0.25]);
    expect(await valueAt(db, 'tracking.minTrackedCasesForAssessment', at(0))).toBe(10);
  });

  it('[TRV-34] [TRV-38] [CL-IHM-23] lists every parameter in the order of section 6, and only those of Lot 1 while only Lot 1 runs', async () => {
    const lot2 = await listRegistry(db, 2);
    const lot1 = await listRegistry(db, 1);

    expect(lot2.map(({ key }) => key)).toStrictEqual(registryKeys.map(({ key }) => key));
    expect(lot1.map(({ key }) => key)).toStrictEqual(
      lot2.filter(({ lot }) => lot === 1).map(({ key }) => key),
    );
    expect([lot1.length, lot2.length]).toStrictEqual([82, 131]);
    expect(lot1.some(({ key }) => key.startsWith('notifications.'))).toBe(false);
  });

  it('[TRV-34] [CL-IHM-18] shows each value in force and its default written, its version and its last change', async () => {
    clock.advance(HOUR);
    await save(RETENTION, 120, 0);
    const retention = await rowOf(RETENTION);
    const zone = await rowOf('display.timeZone');

    expect(retention).toStrictEqual({
      ...retention,
      label: 'Journal retention',
      allowed: '7 to 365 days',
      file: '14',
      lot: 1,
      setting: {
        value: 120,
        written: '120 days',
        defaultValue: 90,
        defaultWritten: '90 days',
        version: 1,
        lastChangedAt: at(1),
      },
    });
    expect(zone?.setting).toStrictEqual({
      value: 'Europe/Paris',
      written: 'Paris time',
      defaultValue: 'Europe/Paris',
      defaultWritten: 'Paris time',
      version: 0,
      lastChangedAt: null,
    });
  });

  it('[TRV-34] keeps the version moving after a reset, which leaves no override', async () => {
    await save(RETENTION, 120, 0);
    clock.advance(HOUR);
    await reset(RETENTION, 1);
    const row = await rowOf(RETENTION);

    expect(row?.setting).toMatchObject({ value: 90, version: 2, lastChangedAt: at(1) });
  });

  it('[CL-TRV-17] [IHM-37] lists the criterion switch with its mark and the link to the types, and no value', async () => {
    expect(await rowOf(SWITCH)).toMatchObject({
      key: SWITCH,
      affectsCalculations: true,
      editedOn: '/types',
      setting: null,
    });
  });

  it('[TRV-35] [CL-TRV-17] [CL-IHM-12] moves the date of the last change only when a Calc parameter changes', async () => {
    const atFirst = await lastCalculationChange(db);
    await save(RETENTION, 120, 0);
    const afterOther = await lastCalculationChange(db);
    clock.advance(HOUR);
    await save('sensitivity.minValidCases', 6, 0);
    const changes = await db
      .select({ journalEntryId: parameterChanges.journalEntryId })
      .from(parameterChanges)
      .orderBy(asc(parameterChanges.id));
    const afterCalc = await lastCalculationChange(db);
    clock.advance(HOUR);
    await save('display.listPageSize', 25, 0);
    const afterDisplay = await lastCalculationChange(db);
    clock.advance(HOUR);
    await reset('sensitivity.minValidCases', 1);
    const afterReset = await lastCalculationChange(db);

    expect([atFirst, afterOther]).toStrictEqual([null, null]);
    expect(afterCalc).toStrictEqual({
      changedAt: at(1),
      journalEntryId: changes[1]?.journalEntryId,
    });
    expect(afterDisplay).toStrictEqual(afterCalc);
    expect(afterReset?.changedAt).toBe(at(3));
  });

  it('[SEN-36] [TRV-35] snapshots the Calc values in force once per distinct set, and gives back its id', async () => {
    const first = await snapshotCalculationParams(db);
    const again = await snapshotCalculationParams(db);
    await save(RETENTION, 120, 0);
    const afterOther = await snapshotCalculationParams(db);
    await save('sensitivity.minValidCases', 6, 0);
    const changed = await snapshotCalculationParams(db);
    await reset('sensitivity.minValidCases', 1);
    const restored = await snapshotCalculationParams(db);
    const snapshots = await db
      .select({ id: parameterSnapshots.id, values: parameterSnapshots.values })
      .from(parameterSnapshots)
      .orderBy(asc(parameterSnapshots.id));

    expect([again, afterOther, restored]).toStrictEqual([first, first, first]);
    expect(changed).not.toBe(first);
    expect(snapshots).toStrictEqual([
      { id: first, values: ENGINE_DEFAULTS },
      { id: changed, values: { ...ENGINE_DEFAULTS, 'sensitivity.minValidCases': 6 } },
    ]);
  });
});
