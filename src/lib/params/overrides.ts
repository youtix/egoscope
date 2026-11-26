import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { parameterChanges, parameterOverrides, updateVersioned } from '@/lib/db';
import { record } from '@/lib/journal';
import { changedElsewhere, err, ok } from '@/lib/result';
import { now } from '@/lib/time';
import { invalidate } from '@/lib/wake-plan';

import { getParams, valueOf } from './accessors';
import { ENTRIES, isOverridable } from './catalog';
import { SWITCHED_OFF_CRITERION_KEY } from './registry/taxonomy';
import { brokenRelation, refusalOf, writeValue } from './relations';

import type { ParamValue } from './catalog';
import type { OverridableKey } from './entry';
import type { Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';
import type { SQL } from 'drizzle-orm';

/** The value of a parameter as it now stands, with the version a screen sends back (CL-IHM-18). */
export type CurrentSetting<K extends OverridableKey> = Readonly<{
  value: ParamValue<K>;
  version: number;
}>;

/** A save that went through: whether it changed the value, and the version now. */
export type Saved = Readonly<{ changed: boolean; version: number }>;

/**
 * Why a save or a reset was refused: a value outside the bounds of CL-TRV-16, with its
 * plain explanation (TRV-35); the per-type criterion switch, which holds no value here
 * (CL-TRV-17); a value changed elsewhere since the screen showed it, with the value as it
 * now stands (CL-IHM-18).
 */
export type SaveRefusal<K extends OverridableKey> =
  | Readonly<{ kind: 'out_of_bounds'; explanation: string }>
  | Readonly<{ kind: 'read_only'; explanation: string }>
  | ChangedElsewhere<CurrentSetting<K>>;

const READ_ONLY = {
  kind: 'read_only',
  explanation: 'This setting is set on each type sheet, with the confirmation of its consequence.',
} as const;

/** A JSON value for a jsonb column of the history (TRV-35), `null` included, which the driver would send as SQL NULL. */
const jsonValue = (value: unknown): unknown => (value === null ? sql`'null'::jsonb` : value);

/** The state of `key` in `tx`: its value in force, its version, and whether an override holds it. */
async function stateOf<K extends OverridableKey>(
  tx: Transaction,
  key: K,
): Promise<CurrentSetting<K> & Readonly<{ overridden: boolean }>> {
  const [override] = await tx
    .select({ value: parameterOverrides.value, version: parameterOverrides.rowVersion })
    .from(parameterOverrides)
    .where(eq(parameterOverrides.parameterKey, key));
  if (override !== undefined) {
    return { value: valueOf(key, override.value), version: override.version, overridden: true };
  }
  // Without an override, the version counts the key's changes, which every save and
  // every reset adds to: a version once shown never comes back after a reset.
  const changes = await tx.$count(parameterChanges, eq(parameterChanges.parameterKey, key));
  return { value: ENTRIES[key].defaultValue, version: changes, overridden: false };
}

/** The refusal of a save whose version is no longer that of `current`, the setting as it stands. */
const stale = <K extends OverridableKey>(
  current: CurrentSetting<K>,
): Result<never, SaveRefusal<K>> =>
  err(changedElsewhere({ value: current.value, version: current.version }));

/** The journal message of a save or a reset of a parameter, which states its recalculation when it has one (TRV-42). */
function messageKeyOf(entry: Readonly<{ affectsCalculations: boolean }>, isReset: boolean) {
  if (isReset) {
    return entry.affectsCalculations ? 'calculation_parameter_reset' : 'parameter_reset';
  }
  return entry.affectsCalculations ? 'calculation_parameter_changed' : 'parameter_changed';
}

/**
 * Journals the change of `key` from `oldValue` to `newValue` and keeps it in its
 * history, in the save's transaction (TRV-35, TRV-41, CL-IHM-12); the journal names the
 * parameter by its label and writes both values with their unit.
 */
async function trace<K extends OverridableKey>(
  tx: Transaction,
  key: K,
  change: Readonly<{ oldValue: ParamValue<K>; newValue: ParamValue<K>; reset: boolean }>,
): Promise<void> {
  const entry = ENTRIES[key];
  const params = {
    parameter: entry.label,
    oldValue: writeValue(key, change.oldValue),
    newValue: writeValue(key, change.newValue),
  };
  const journalEntryId = await record(tx, {
    messageKey: messageKeyOf(entry, change.reset),
    params,
  });
  await tx.insert(parameterChanges).values({
    parameterKey: key,
    changedAt: new Date(now()),
    oldValue: jsonValue(change.oldValue),
    newValue: jsonValue(change.newValue),
    affectsCalculations: entry.affectsCalculations,
    journalEntryId,
  });
  if (entry.movesSchedule) {
    // A failed invalidation leaves a plan that the hourly check replaces (module map §1.9).
    await invalidate();
  }
}

/** Writes `value` as the override of `key`: whether its version was still `expectedVersion`. */
async function hasWrittenOverride(
  tx: Transaction,
  change: Readonly<{
    key: OverridableKey;
    value: unknown;
    expectedVersion: number;
    overridden: boolean;
  }>,
): Promise<boolean> {
  const where: SQL = eq(parameterOverrides.parameterKey, change.key);
  const changedAt = new Date(now());
  if (change.overridden) {
    const updated = await updateVersioned(tx, parameterOverrides, {
      where,
      expectedVersion: change.expectedVersion,
      set: { value: change.value, changedAt },
    });
    return updated.ok;
  }
  const inserted = await tx
    .insert(parameterOverrides)
    .values({
      parameterKey: change.key,
      value: change.value,
      changedAt,
      rowVersion: change.expectedVersion + 1,
    })
    .onConflictDoNothing()
    .returning({ key: parameterOverrides.parameterKey });
  return inserted.length > 0;
}

/**
 * `value` of `key` as it is stored, or the refusal of a value outside its bounds or
 * outside a bound with another parameter, with its plain explanation (TRV-35, CL-TRV-16).
 */
async function checkedValue<K extends OverridableKey>(
  tx: Transaction,
  key: K,
  value: unknown,
): Promise<Result<ParamValue<K>, SaveRefusal<K>>> {
  const parsed = ENTRIES[key].kind.parse(value);
  if (parsed === undefined) {
    return err({ kind: 'out_of_bounds', explanation: refusalOf(key) });
  }
  const broken = brokenRelation(key, parsed, await getParams(tx));
  return broken === undefined
    ? ok(parsed)
    : err({ kind: 'out_of_bounds', explanation: refusalOf(key, broken) });
}

// The name of the transaction lock that every save and reset of a parameter takes. It must be
// taken before every read that a decision of the save or the reset rests on (the state of the
// key, the bound check, the stale-version check): a read made before it can see a value that a
// save running at the same time is about to change. Moving it later reopens the race of
// CL-TRV-16, and the tests of the order of the statements fail then.
const SAVES_LOCK = 'egoscope.parameter-saves';

/**
 * The state of `key` in `tx`, read once no other save or reset of a parameter runs: two
 * related values saved at once, from two devices, then cannot each pass their bound
 * against the other's old value (CL-TRV-16). The lock ends with the transaction, as the
 * pooled connection requires.
 */
async function lockedStateOf<K extends OverridableKey>(tx: Transaction, key: K) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${SAVES_LOCK}))`);
  return stateOf(tx, key);
}

/** Deletes the override of `key`: whether its version was still `expectedVersion`. */
async function hasDeletedOverride(
  tx: Transaction,
  key: OverridableKey,
  expectedVersion: number,
): Promise<boolean> {
  const deleted = await tx
    .delete(parameterOverrides)
    .where(
      and(
        eq(parameterOverrides.parameterKey, key),
        eq(parameterOverrides.rowVersion, expectedVersion),
      ),
    )
    .returning({ key: parameterOverrides.parameterKey });
  return deleted.length > 0;
}

/** A save of a parameter: its key, its new value, and the version the screen showed (CL-IHM-18). */
export type ParamChange<K extends OverridableKey> = Readonly<{
  key: K;
  value: ParamValue<K>;
  expectedVersion: number;
}>;

/**
 * Saves `change.value` as the owner's value of `change.key`, in the caller's transaction
 * `tx`, when the version is still `change.expectedVersion`, the one the screen showed
 * (TRV-35, CL-IHM-18): a value outside its bounds is refused with a plain explanation
 * that states them (CL-TRV-16); the change is journaled with its old and new value and
 * kept in the history with its instant; a parameter that moves a due instant, the time
 * zone among them, invalidates the wake plan (module map §1.9). A value equal to the one
 * in force changes nothing. The new value applies from the next use (TRV-36).
 */
export async function setParam<K extends OverridableKey>(
  tx: Transaction,
  change: ParamChange<K>,
): Promise<Result<Saved, SaveRefusal<K>>> {
  const { key, expectedVersion } = change;
  if (!isOverridable(key)) {
    return err(READ_ONLY);
  }
  const current = await lockedStateOf(tx, key);
  const checked = await checkedValue(tx, key, change.value);
  if (!checked.ok) {
    return err(checked.error);
  }
  if (current.version !== expectedVersion) {
    return stale(current);
  }
  if (JSON.stringify(checked.value) === JSON.stringify(current.value)) {
    return ok({ changed: false, version: current.version });
  }
  if (
    !(await hasWrittenOverride(tx, {
      key,
      value: checked.value,
      expectedVersion,
      overridden: current.overridden,
    }))
  ) {
    return stale(await stateOf(tx, key));
  }
  await trace(tx, key, { oldValue: current.value, newValue: checked.value, reset: false });
  return ok({ changed: true, version: expectedVersion + 1 });
}

/**
 * Restores the default of `change.key`, in the caller's transaction `tx`, by deleting
 * the owner's override, when the version is still `change.expectedVersion` (TRV-35,
 * CL-IHM-18): journaled and kept in the history like a save, and invalidating the wake
 * plan for a parameter that moves a due instant. A parameter at its default changes
 * nothing; a default that would break a bound with the value in force of another
 * parameter is refused, as a save of it would be (CL-TRV-16).
 */
export async function resetParam<K extends OverridableKey>(
  tx: Transaction,
  change: Omit<ParamChange<K>, 'value'>,
): Promise<Result<Saved, SaveRefusal<K>>> {
  const { key, expectedVersion } = change;
  if (!isOverridable(key)) {
    return err(READ_ONLY);
  }
  const current = await lockedStateOf(tx, key);
  if (current.version !== expectedVersion) {
    return stale(current);
  }
  if (!current.overridden) {
    return ok({ changed: false, version: current.version });
  }
  const broken = brokenRelation(key, ENTRIES[key].defaultValue, await getParams(tx));
  if (broken !== undefined) {
    return err({ kind: 'out_of_bounds', explanation: refusalOf(key, broken) });
  }
  if (!(await hasDeletedOverride(tx, key, expectedVersion))) {
    return stale(await stateOf(tx, key));
  }
  await trace(tx, key, {
    oldValue: current.value,
    newValue: ENTRIES[key].defaultValue,
    reset: true,
  });
  return ok({ changed: true, version: expectedVersion + 1 });
}

/** A change of a type's doubtful-criterion switch, as the type sheet records it (CL-TAX-17). */
export type CriterionSwitchChange = Readonly<{
  /** The criterion switched off before and after the change, or null for none. */
  oldValue: string | null;
  newValue: string | null;
  /** The journal entry of the change, which the date of the last change links to. */
  journalEntryId: number;
}>;

/**
 * Records, in the caller's transaction `tx`, that a type's doubtful-criterion switch
 * changed, so that the date of the last change that affects calculations moves (TRV-35,
 * CL-TRV-17, ADR 0016); the switch itself lives on the type sheet.
 */
export async function noteCalculationChange(
  tx: Transaction,
  change: CriterionSwitchChange,
): Promise<void> {
  await tx.insert(parameterChanges).values({
    parameterKey: SWITCHED_OFF_CRITERION_KEY,
    changedAt: new Date(now()),
    oldValue: jsonValue(change.oldValue),
    newValue: jsonValue(change.newValue),
    affectsCalculations: true,
    journalEntryId: change.journalEntryId,
  });
}
