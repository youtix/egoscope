import 'server-only';

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { followedPlayers, playerNameVariants, updateVersioned } from '@/lib/db';
import { record } from '@/lib/journal';
import { changedElsewhere, err, ok } from '@/lib/result';

import { variantProblems } from './add';
import { get, normalizeName, sharedVariants } from './queries';

import type { NewNameVariant, VariantProblem } from './add';
import type { NameVariant, PlayerDetail, SharedVariant } from './queries';
import type { PlayerNotFound } from './teams';
import type { NewFollowedPlayerRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** A day and month of birth, never a year (JOU-11, CL-JOU-16, CL-DSN-21). */
export type Birthday = Readonly<{ month: number; day: number }>;

/** The identity as the owner saves it on the edit screen (JOU-08, JOU-11, JOU-12). */
export type IdentityChange = Readonly<{
  displayName: string;
  /** Every variant he keeps, in entry order: one left out is removed, one not yet his is added. */
  variants: readonly NewNameVariant[];
  /** None to remove it. */
  birthday: Birthday | null;
  /** The `row_version` that the screen showed (CL-IHM-18). */
  expectedVersion: number;
}>;

/** The fields to fix, each with what is wrong with it. */
export type IdentityFieldErrors = Readonly<{
  displayName?: 'required';
  variants?: readonly VariantProblem[];
  /** A month that does not exist, or a day that the month never has. */
  birthday?: 'impossible_date';
}>;

/** Why an identity save is refused. */
export type IdentityRefusal =
  | Readonly<{ kind: 'invalid_fields'; fields: IdentityFieldErrors }>
  | ChangedElsewhere<PlayerDetail>
  | NoLongerExists;

/** What a save changed, which the edit action composes with the other modules. */
export type IdentityUpdated = Readonly<{
  /** Whether the day and month of birth changed, which requests a full derivation (CL-JOU-16). */
  birthdayChanged: boolean;
  /** The names that were not his before, the only ones that the Lot 2 re-prefilter searches (JOU-09). */
  addedVariants: readonly string[];
  /** The other players who share one of his names, which the screen flags (JOU-09, CL-JOU-04). */
  sharedVariants: readonly SharedVariant[];
}>;

/**
 * The day and month of birth that the source gives, or none (`null` for both), and whether
 * it may replace one that the source gave before, after a change of mapping (CL-JOU-11).
 */
export type SourceBirthday = (Birthday | Readonly<{ month: null; day: null }>) &
  Readonly<{ replaceSourceGiven?: boolean }>;

/** A birthday that no calendar has: the source gave a month or a day that does not exist. */
export type ImpossibleBirthday = 'impossible_birthday';

/** How his variant rows move to the variants he keeps. */
type VariantPlan = Readonly<{
  kept: readonly NewNameVariant[];
  removed: readonly NameVariant[];
  edited: readonly Readonly<{ id: number; variant: NewNameVariant }>[];
  added: readonly NewNameVariant[];
}>;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };
const FIRST_MONTH = 1;
const FIRST_DAY = 1;
const LONG_MONTH = 31;
const SHORT_MONTH = 30;
const LEAP_FEBRUARY = 29;
// The longest day of each month, 29 February included (CL-JOU-17).
const LONGEST_DAY_OF_MONTH = [
  LONG_MONTH,
  LEAP_FEBRUARY,
  LONG_MONTH,
  SHORT_MONTH,
  LONG_MONTH,
  SHORT_MONTH,
  LONG_MONTH,
  LONG_MONTH,
  SHORT_MONTH,
  LONG_MONTH,
  SHORT_MONTH,
  LONG_MONTH,
] as const;

/** Whether `birthday` is a day that its month has in some year, 29 February included (CL-JOU-17). */
function isPossibleBirthday({ month, day }: Birthday): boolean {
  const longest = Number.isSafeInteger(month)
    ? LONGEST_DAY_OF_MONTH[month - FIRST_MONTH]
    : undefined;
  return longest !== undefined && Number.isSafeInteger(day) && day >= FIRST_DAY && day <= longest;
}

/** What is wrong with `change`, field by field, if anything. */
function fieldErrors(change: IdentityChange): IdentityFieldErrors | undefined {
  const variants = variantProblems(change);
  const fields: IdentityFieldErrors = {
    ...(normalizeName(change.displayName) === '' && { displayName: 'required' as const }),
    ...(variants.length > 0 && { variants }),
    ...(change.birthday !== null &&
      !isPossibleBirthday(change.birthday) && { birthday: 'impossible_date' as const }),
  };
  return Object.keys(fields).length === 0 ? undefined : fields;
}

/** The refusal of a save whose player is gone, or whose version is not the one the screen showed (CL-IHM-18, CL-IHM-19). */
function staleRefusal(current: PlayerDetail | null): IdentityRefusal {
  return current === null ? NO_LONGER_EXISTS : changedElsewhere(current);
}

/** Whether two birthdays are the same day and month, none being the same as none. */
function isSameBirthday(left: Birthday | null, right: Birthday | null): boolean {
  return left?.month === right?.month && left?.day === right?.day;
}

/** The birthday columns of a birthday that the owner entered, corrected or removed (CL-JOU-16). */
function ownerBirthdayColumns(
  birthday: Birthday | null,
): Pick<NewFollowedPlayerRow, 'birthdayMonth' | 'birthdayDay' | 'birthdayOrigin'> {
  return birthday === null
    ? { birthdayMonth: null, birthdayDay: null, birthdayOrigin: null }
    : { birthdayMonth: birthday.month, birthdayDay: birthday.day, birthdayOrigin: 'owner' };
}

/** Writes his display name and, when it changed, his birthday, if the version is still the one shown. */
async function writePlayerRow(tx: Transaction, before: PlayerDetail, change: IdentityChange) {
  const displayName = change.displayName.trim();
  return updateVersioned(tx, followedPlayers, {
    where: eq(followedPlayers.id, before.id),
    expectedVersion: change.expectedVersion,
    set: {
      displayName,
      displayNameNormalized: normalizeName(displayName),
      ...(!isSameBirthday(before.birthday, change.birthday) &&
        ownerBirthdayColumns(change.birthday)),
    },
  });
}

/** The variants he keeps, and his former display name as a spelling variant when it changed (JOU-12). */
function keptVariants(before: PlayerDetail, change: IdentityChange): readonly NewNameVariant[] {
  const variants = change.variants.map((variant) => ({ ...variant, text: variant.text.trim() }));
  const formerKey = normalizeName(before.displayName);
  const names = [change.displayName, ...variants.map((variant) => variant.text)];
  return names.some((name) => normalizeName(name) === formerKey)
    ? variants
    : [...variants, { kind: 'spelling', text: before.displayName, isAmbiguous: false }];
}

/** Whether `variant` differs from the row `existing` that it keeps. */
function isEdited(existing: NameVariant, variant: NewNameVariant): boolean {
  return (
    existing.kind !== variant.kind ||
    existing.text !== variant.text ||
    existing.isAmbiguous !== variant.isAmbiguous
  );
}

/**
 * How his variant rows reach those he keeps, compared after normalization (CL-JOU-13): a
 * row left out is removed, a row kept is edited in place, a variant new to him is added.
 */
function variantPlan(before: PlayerDetail, change: IdentityChange): VariantPlan {
  const kept = keptVariants(before, change);
  const existing = new Map(before.variants.map((row) => [normalizeName(row.text), row]));
  const wanted = new Set(kept.map((variant) => normalizeName(variant.text)));
  return {
    kept,
    removed: before.variants.filter((row) => !wanted.has(normalizeName(row.text))),
    edited: kept.flatMap((variant) => {
      const row = existing.get(normalizeName(variant.text));
      return row !== undefined && isEdited(row, variant) ? { id: row.id, variant } : [];
    }),
    added: kept.filter((variant) => !existing.has(normalizeName(variant.text))),
  };
}

/** Applies `plan` to the variant rows of `playerId`: removals first, so that an added key is free. */
async function applyVariantPlan(tx: Transaction, playerId: string, plan: VariantPlan) {
  if (plan.removed.length > 0) {
    const ids = plan.removed.map((row) => row.id);
    await tx.delete(playerNameVariants).where(inArray(playerNameVariants.id, ids));
  }
  for (const { id, variant } of plan.edited) {
    const { kind, text, isAmbiguous } = variant;
    await tx
      .update(playerNameVariants)
      .set({ kind, text, isAmbiguous })
      .where(eq(playerNameVariants.id, id));
  }
  if (plan.added.length > 0) {
    await tx.insert(playerNameVariants).values(
      plan.added.map((variant) => ({
        playerId,
        ...variant,
        normalizedText: normalizeName(variant.text),
      })),
    );
  }
}

/** The journal entry of a birthday entered, changed or removed, without its value (CL-DSN-21). */
function birthdayMessage(before: Birthday | null, after: Birthday | null) {
  if (before === null) {
    return 'player_birthday_entered' as const;
  }
  return after === null
    ? ('player_birthday_removed' as const)
    : ('player_birthday_changed' as const);
}

/** Journals what the save changed: his names, and his birthday without its value (CL-DSN-21). */
async function journalChanges(
  tx: Transaction,
  before: PlayerDetail,
  { change, plan }: Readonly<{ change: IdentityChange; plan: VariantPlan }>,
) {
  const playerId = before.id;
  const variantRows = plan.removed.length + plan.edited.length + plan.added.length;
  if (variantRows > 0 || change.displayName.trim() !== before.displayName) {
    await record(tx, { messageKey: 'player_identity_changed', playerId });
  }
  if (isSameBirthday(before.birthday, change.birthday)) {
    return;
  }
  const messageKey = birthdayMessage(before.birthday, change.birthday);
  await record(tx, { messageKey, playerId });
}

/** Those of `names` that were none of his names in `before`, compared after normalization (JOU-09). */
function newNames(before: PlayerDetail, names: readonly string[]): readonly string[] {
  const former = new Set(
    [before.displayName, ...before.variants.map((row) => row.text)].map((name) =>
      normalizeName(name),
    ),
  );
  return names.filter((name) => !former.has(normalizeName(name)));
}

/**
 * Saves the identity of the followed player `playerId` in the caller's transaction `tx`
 * (JOU-08, JOU-09, JOU-11, JOU-12, CL-JOU-13, CL-JOU-16, CL-JOU-17, CL-IHM-18): his display
 * name, the former one kept as a spelling variant; his variants and their ambiguous marks,
 * added, edited or removed, refused field by field when empty or the same as another of
 * his names after normalization, accepted when another followed player shares them, who is
 * named; his day and month of birth, never a year, entered, corrected or removed by the
 * owner, 29 February accepted and an impossible day refused. Refused when the screen showed
 * an older version, or the player is gone. Journals the identity change, and the birthday
 * entered, changed or removed without its value (CL-DSN-21). A team change is not his:
 * the edit action calls `enterTeamChange` after it.
 */
export async function updateIdentity(
  tx: Transaction,
  playerId: string,
  change: IdentityChange,
): Promise<Result<IdentityUpdated, IdentityRefusal>> {
  const fields = fieldErrors(change);
  if (fields !== undefined) {
    return err({ kind: 'invalid_fields', fields });
  }
  const before = await get(tx, playerId);
  if (before?.rowVersion !== change.expectedVersion) {
    return err(staleRefusal(before));
  }
  const saved = await writePlayerRow(tx, before, change);
  if (!saved.ok) {
    // Saved elsewhere between the read and the write: the player as he now stands.
    return err(staleRefusal(await get(tx, playerId)));
  }
  const plan = variantPlan(before, change);
  await applyVariantPlan(tx, playerId, plan);
  await journalChanges(tx, before, { change, plan });
  const names = [saved.value.displayName, ...plan.kept.map((variant) => variant.text)];
  return ok({
    birthdayChanged: !isSameBirthday(before.birthday, change.birthday),
    addedVariants: newNames(before, names),
    sharedVariants: await sharedVariants(tx, names, playerId),
  });
}

/** What a write of the source's birthday that wrote nothing answers: gone, or unchanged. */
async function unchangedBirthday(
  tx: Transaction,
  playerId: string,
): Promise<Result<Readonly<{ changed: boolean }>, PlayerNotFound>> {
  const [player] = await tx
    .select({ id: followedPlayers.id })
    .from(followedPlayers)
    .where(eq(followedPlayers.id, playerId));
  return player === undefined ? err('player_not_found') : ok({ changed: false });
}

/** Clears a birthday that the source gave, after a change of mapping to an identity that gives none (CL-JOU-11). */
async function clearSourceGiven(
  tx: Transaction,
  playerId: string,
): Promise<Result<Readonly<{ changed: boolean }>, PlayerNotFound>> {
  // One statement decides and writes, so that an owner's entry made meanwhile is kept.
  const cleared = await tx
    .update(followedPlayers)
    .set({
      birthdayMonth: null,
      birthdayDay: null,
      birthdayOrigin: null,
      rowVersion: sql`${followedPlayers.rowVersion} + 1`,
    })
    .where(
      and(eq(followedPlayers.id, playerId), eq(followedPlayers.birthdayOrigin, 'stats_source')),
    )
    .returning({ id: followedPlayers.id });
  if (cleared.length === 0) {
    return unchangedBirthday(tx, playerId);
  }
  await record(tx, { messageKey: 'birthday_cleared_after_mapping_change', playerId });
  return ok({ changed: true });
}

/**
 * Fills the day and month of birth of `playerId` that the stats source gives, its year
 * already dropped by the adapter, in the caller's transaction `tx` (JOU-11, CL-JOU-16):
 * only when the field is empty, origin `stats_source`; with `replaceSourceGiven`, after a
 * change of mapping, also over a value that the source gave, never over one the owner
 * entered, and when the new identity gives none, a value that the source gave is cleared
 * with its origin (CL-JOU-11). Journals the entry or the clearing without its value
 * (CL-DSN-21) and gives whether the birthday changed, which requests a full derivation.
 */
export async function setBirthdayFromSource(
  tx: Transaction,
  playerId: string,
  source: SourceBirthday,
): Promise<Result<Readonly<{ changed: boolean }>, PlayerNotFound | ImpossibleBirthday>> {
  const canReplace = source.replaceSourceGiven === true;
  if (source.month === null) {
    return canReplace ? clearSourceGiven(tx, playerId) : unchangedBirthday(tx, playerId);
  }
  const { month, day } = source;
  if (!isPossibleBirthday({ month, day })) {
    return err('impossible_birthday');
  }
  // One statement decides and writes, so that an owner's entry made meanwhile is never overwritten.
  const empty = isNull(followedPlayers.birthdayOrigin);
  const sourceGiven = eq(followedPlayers.birthdayOrigin, 'stats_source');
  const updated = await tx
    .update(followedPlayers)
    .set({
      birthdayMonth: month,
      birthdayDay: day,
      birthdayOrigin: 'stats_source',
      rowVersion: sql`${followedPlayers.rowVersion} + 1`,
    })
    .where(
      and(
        eq(followedPlayers.id, playerId),
        canReplace ? or(empty, sourceGiven) : empty,
        sql`(${followedPlayers.birthdayMonth}, ${followedPlayers.birthdayDay}) is distinct from (${month}::smallint, ${day}::smallint)`,
      ),
    )
    .returning({ id: followedPlayers.id });
  if (updated.length === 0) {
    return unchangedBirthday(tx, playerId);
  }
  await record(tx, { messageKey: 'birthday_from_source', playerId });
  return ok({ changed: true });
}
