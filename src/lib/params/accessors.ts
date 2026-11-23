import 'server-only';

import { createHash } from 'node:crypto';

import { and, asc, count, desc, eq, gt, lte, max } from 'drizzle-orm';

import { parameterChanges, parameterOverrides, parameterSnapshots } from '@/lib/db';
import { now, toEpochMs } from '@/lib/time';

import { ALL_FACTS, CALCULATION_KEYS, ENTRIES, isOverridable } from './catalog';
import { writeValue } from './relations';

import type { ParameterKey, ParamReader, ParamValue } from './catalog';
import type { EntryFacts, Lot, OverridableKey } from './entry';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/** A connection or a transaction, to read or write through. */
export type Executor = Database | Transaction;

/**
 * The value of `key` that `stored` holds, an override or a value of the history: the
 * default when it holds none, or one that the registry no longer accepts.
 */
export function valueOf<K extends OverridableKey>(key: K, stored: unknown): ParamValue<K> {
  return ENTRIES[key].kind.parse(stored) ?? ENTRIES[key].defaultValue;
}

/**
 * The value in force of `key`, typed by its key: the owner's override, read at each
 * call so that a change applies from the next use, else the registry's default (TRV-34,
 * TRV-36).
 */
export async function getParam<K extends OverridableKey>(
  db: Executor,
  key: K,
): Promise<ParamValue<K>> {
  const [override] = await db
    .select({ value: parameterOverrides.value })
    .from(parameterOverrides)
    .where(eq(parameterOverrides.parameterKey, key));
  return valueOf(key, override?.value);
}

/**
 * Every value in force at once, from one read of the overrides, for a task or a
 * calculation that needs several (TRV-34, TRV-36): `(await getParams(db)).get(key)`.
 */
export async function getParams(db: Executor): Promise<ParamReader> {
  const overrides = await db
    .select({ key: parameterOverrides.parameterKey, value: parameterOverrides.value })
    .from(parameterOverrides);
  const stored = new Map(overrides.map(({ key, value }) => [key, value]));
  return { get: (key) => valueOf(key, stored.get(key)) };
}

/**
 * The value that `key` had at `instant`, from the history of its changes (TRV-35):
 * the new value of the last change made by then, else the old value of the first one
 * made after, else the value in force, which never changed; the threshold in force
 * when a forecast version was made, for one (SUI-08).
 */
export async function valueAt<K extends OverridableKey>(
  db: Executor,
  key: K,
  instant: EpochMs,
): Promise<ParamValue<K>> {
  const at = new Date(instant);
  const ofKey = eq(parameterChanges.parameterKey, key);
  const [before] = await db
    .select({ value: parameterChanges.newValue })
    .from(parameterChanges)
    .where(and(ofKey, lte(parameterChanges.changedAt, at)))
    .orderBy(desc(parameterChanges.changedAt), desc(parameterChanges.id))
    .limit(1);
  if (before !== undefined) {
    return valueOf(key, before.value);
  }
  const [after] = await db
    .select({ value: parameterChanges.oldValue })
    .from(parameterChanges)
    .where(and(ofKey, gt(parameterChanges.changedAt, at)))
    .orderBy(asc(parameterChanges.changedAt), asc(parameterChanges.id))
    .limit(1);
  return after === undefined ? getParam(db, key) : valueOf(key, after.value);
}

/** What the parameters screen shows of a parameter that holds a value (TRV-34). */
export type Setting = Readonly<{
  /** The value in force, and written for people with its unit. */
  value: ParamValue<OverridableKey>;
  written: string;
  /** The default, and written for people with its unit. */
  defaultValue: ParamValue<OverridableKey>;
  defaultWritten: string;
  /** The version the screen sends back with a save or a reset (CL-IHM-18). */
  version: number;
  /** When it last changed, or null when it never did. */
  lastChangedAt: EpochMs | null;
}>;

/**
 * One row of the parameters screen (TRV-34, CL-IHM-23): the facts of the registry, and
 * the setting of a parameter that holds a value; none for the per-type criterion switch,
 * which the screen lists read only, with a link to the types where it is set.
 */
export type RegistryRow = EntryFacts & Readonly<{ key: ParameterKey; setting: Setting | null }>;

/** The setting of `key` from its override and the count and last instant of its changes. */
function settingOf(
  key: OverridableKey,
  override: Readonly<{ value: unknown; rowVersion: number }> | undefined,
  changes: Readonly<{ count: number; last: Date | null }> | undefined,
): Setting {
  const value = valueOf(key, override?.value);
  const { defaultValue } = ENTRIES[key];
  const last = changes?.last ?? null;
  return {
    value,
    written: writeValue(key, value),
    defaultValue,
    defaultWritten: writeValue(key, defaultValue),
    version: override?.rowVersion ?? changes?.count ?? 0,
    lastChangedAt: last === null ? null : toEpochMs(last.getTime()),
  };
}

/**
 * The entries of the registry that the lots up to `lot` read, the active lot that
 * `activeLot()` of `@/lib/env` gives, in the order of module map section 6, with their
 * value in force, default, version and instant of last change, in two reads (TRV-34,
 * TRV-38): while only Lot 1 runs, the screen shows no Lot 2 parameter; each row says its
 * lot, and the screen where a value edited elsewhere is set (CL-IHM-23).
 */
export async function listRegistry(db: Executor, lot: Lot): Promise<readonly RegistryRow[]> {
  const overrides = await db
    .select({
      key: parameterOverrides.parameterKey,
      value: parameterOverrides.value,
      rowVersion: parameterOverrides.rowVersion,
    })
    .from(parameterOverrides);
  const changes = await db
    .select({
      key: parameterChanges.parameterKey,
      count: count(),
      last: max(parameterChanges.changedAt),
    })
    .from(parameterChanges)
    .groupBy(parameterChanges.parameterKey);
  const overrideOf = new Map(overrides.map((row) => [row.key, row]));
  const changesOf = new Map(changes.map((row) => [row.key, row]));
  return ALL_FACTS.filter(([, facts]) => facts.lot <= lot).map(([key, facts]) => ({
    ...facts,
    key,
    setting: isOverridable(key) ? settingOf(key, overrideOf.get(key), changesOf.get(key)) : null,
  }));
}

/** The last change that affects calculations, and the journal entry that records it (CL-IHM-12). */
export type CalculationChange = Readonly<{ changedAt: EpochMs; journalEntryId: number | null }>;

/**
 * The date of the last change that affects calculations, which the profiles and the
 * validation table show linked to its journal entry (TRV-35, SEN-37, SUI-25, IHM-51,
 * CL-IHM-12): a change of a parameter of files 07, 08 or 10, or of a type's criterion
 * switch (CL-TRV-17, ADR 0016); null while none was ever made.
 */
export async function lastCalculationChange(db: Executor): Promise<CalculationChange | null> {
  const [last] = await db
    .select({
      changedAt: parameterChanges.changedAt,
      journalEntryId: parameterChanges.journalEntryId,
    })
    .from(parameterChanges)
    .where(eq(parameterChanges.affectsCalculations, true))
    .orderBy(desc(parameterChanges.changedAt), desc(parameterChanges.id))
    .limit(1);
  return last === undefined
    ? null
    : { changedAt: toEpochMs(last.changedAt.getTime()), journalEntryId: last.journalEntryId };
}

/** The order of `left` and `right` by their code units, which no locale changes. */
const byCodeUnits = (left: string, right: string): number => (left < right ? -1 : 1);

// The keys of a snapshot in code-point order, the canonical form that its hash reads.
const SNAPSHOT_KEYS = CALCULATION_KEYS.toSorted(byCodeUnits);

/**
 * The snapshot of the values in force of every parameter that affects calculations,
 * defaults included, which profiles, trends and recalculation jobs reference (SEN-36,
 * TRV-35): stored once per distinct set, found again by the SHA-256 of its canonical
 * form, the keys in order. Returns its id.
 */
export async function snapshotCalculationParams(db: Executor): Promise<number> {
  const params = await getParams(db);
  const values = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, params.get(key)] as const));
  const valuesHash = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  const [snapshot] = await db
    .insert(parameterSnapshots)
    .values({ capturedAt: new Date(now()), values, valuesHash })
    .onConflictDoUpdate({ target: parameterSnapshots.valuesHash, set: { valuesHash } })
    .returning({ id: parameterSnapshots.id });
  if (snapshot === undefined) {
    throw new Error('The upsert of a snapshot of the calculation parameters returned no row.');
  }
  return snapshot.id;
}
