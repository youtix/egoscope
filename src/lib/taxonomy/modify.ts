import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { requestDerivation } from '@/lib/calendar-events';
import { events, eventTypes, typeSheetChanges, typeSheetVersions, updateVersioned } from '@/lib/db';
import { markTypeLink } from '@/lib/events';
import { record } from '@/lib/journal';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { fieldErrors, sheetColumns } from './proposals';
import { sheetContent } from './queries';

import type { ProposalFieldErrors, ProposalSheet } from './proposals';
import type { SheetContent } from './queries';
import type { SheetChangeContent } from './type-detail';
import type { EventTypeRow, TypeSheetChangeRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** What a substantive change does to the facts of a type: `'broadens' | 'narrows' | 'both'` (TAX-22). */
export type SubstantiveChangeScope = NonNullable<TypeSheetChangeRow['substantiveScope']>;

/** The two qualifications of a modification: `'formal' | 'substantive'` (TAX-22). */
export type ModificationKind = Exclude<TypeSheetChangeRow['changeKind'], 'criterion_switch'>;

/** The owner's qualification of a modification: formal, or substantive with its scope (TAX-22). */
export type Qualification =
  Readonly<{ kind: 'formal' }> | Readonly<{ kind: 'substantive'; scope: SubstantiveChangeScope }>;

/**
 * A validated sheet as its edit screen sends it back, whole: what it leaves out is emptied.
 * It holds neither the switched-off criterion, which `setSwitchedOffCriterion` changes
 * (CL-TAX-17), nor the "derived from the calendar" mark, fixed at seeding (CL-TAX-20).
 */
export type ModifiedSheet = Omit<ProposalSheet, 'switchedOffCriterion'>;

/** A modification of a validated sheet, with the `row_version` that the screen showed (CL-IHM-18). */
export type SheetModification = Readonly<{
  sheet: ModifiedSheet;
  qualification: Qualification;
  /** The owner's reason, which the history keeps (TAX-21). */
  reason: string;
  expectedVersion: number;
}>;

/** The fields that the row check of a validated type keeps filled (TAX-01, TAX-12). */
type CompleteField =
  | 'definition'
  | 'inclusionCriteria'
  | 'exclusionCriteria'
  | 'datingRule'
  | 'genericExample'
  | 'documentationDifficulty';

/** The fields of a modification to fix: those of a proposal, the complete sheet and the reason. */
export type ModificationFieldErrors = ProposalFieldErrors &
  Readonly<Partial<Record<CompleteField | 'reason', 'required'>>>;

/** Why a modification is refused. */
export type ModificationRefusal =
  | Readonly<{ kind: 'invalid_fields'; fields: ModificationFieldErrors }>
  | ChangedElsewhere<EventTypeRow>
  | NoLongerExists
  // A proposal is edited before its validation (TAX-20); a rejected or withdrawn type is not modified.
  | Readonly<{ kind: 'not_validated'; status: EventTypeRow['status'] }>;

/**
 * A saved modification: the type as it now stands; the version that a substantive change
 * created, by its `id`, which `recordProposedSupplements` takes, and its `versionNumber`;
 * and how many events it marked to requalify (TAX-22, TAX-25, TAX-26).
 */
export type Modified = Readonly<{
  type: EventTypeRow;
  version: Readonly<{ id: number; versionNumber: number }> | null;
  markedToRequalify: number;
}>;

/** What the default qualification compares: the current content and the sheet the owner edited. */
export type SheetChange = Readonly<{ before: SheetContent; after: ModifiedSheet }>;

const NO_LONGER_EXISTS: NoLongerExists = { kind: 'no_longer_exists' };
const COMPLETE_FIELDS: readonly CompleteField[] = [
  'definition',
  'inclusionCriteria',
  'exclusionCriteria',
  'datingRule',
  'genericExample',
  'documentationDifficulty',
];
// The fields whose change alters which facts belong to the type (H-TAX-08): the definition,
// the criteria and the dating rule, the coverage threshold being part of the dating rule as
// it is sent (CL-TAX-14).
const SUBSTANTIVE_FIELDS = [
  'definition',
  'inclusionCriteria',
  'exclusionCriteria',
  'datingRule',
  'coverageThresholdOutlets',
  'coverageThresholdDays',
] as const satisfies readonly (keyof SheetContent)[];
// The scopes that broaden the type (TAX-24) and those that narrow it (TAX-25, CL-TAX-07).
const BROADENING: ReadonlySet<SubstantiveChangeScope> = new Set(['broadens', 'both']);
const NARROWING: ReadonlySet<SubstantiveChangeScope> = new Set(['narrows', 'both']);
// The version number of a validated type, which its row check keeps set (TAX-20).
const VERSION_NUMBER = z.number().int().min(1);

/**
 * The qualification that the edit screen proposes for `change` (TAX-22, H-TAX-08):
 * substantive when the definition, an inclusion or exclusion criterion, the dating rule or
 * the coverage threshold that the sent dating rule carries changes, each text compared as
 * it would be saved, trimmed and empty when blank; formal otherwise. The owner decides.
 */
export function defaultQualification({ before, after }: SheetChange): ModificationKind {
  const columns = sheetColumns(after, false);
  const isSubstantive = SUBSTANTIVE_FIELDS.some((field) => columns[field] !== before[field]);
  return isSubstantive ? 'substantive' : 'formal';
}

/** The complete-sheet fields that `sheet` leaves empty. */
function missingFields(sheet: ModifiedSheet): Partial<Record<CompleteField, 'required'>> {
  const columns = sheetColumns(sheet, false);
  const missing: Partial<Record<CompleteField, 'required'>> = {};
  for (const field of COMPLETE_FIELDS) {
    if (columns[field] === null) {
      missing[field] = 'required';
    }
  }
  return missing;
}

/** What is wrong with `modification` of `type`, field by field, if anything. */
async function modificationErrors(
  tx: Transaction,
  type: EventTypeRow,
  modification: SheetModification,
): Promise<ModificationFieldErrors | undefined> {
  const fields: ModificationFieldErrors = {
    ...(await fieldErrors(tx, modification.sheet, type.switchedOffCriterion)),
    ...missingFields(modification.sheet),
    ...(modification.reason.trim() === '' && { reason: 'required' as const }),
  };
  return Object.keys(fields).length === 0 ? undefined : fields;
}

/** The scope of `qualification`, or none for a formal change. */
const scopeOf = (qualification: Qualification): SubstantiveChangeScope | null =>
  qualification.kind === 'substantive' ? qualification.scope : null;

/** A history entry's content: the sheet's, with the switched-off criterion (TAX-21, CL-TAX-17). */
const changeContent = (type: EventTypeRow): SheetChangeContent => ({
  ...sheetContent(type),
  switchedOffCriterion: type.switchedOffCriterion,
});

/**
 * Saves the edited sheet of `before` if its version is still the one shown, the
 * calendar mark and the switched-off criterion as they were, the version number moved on
 * by a substantive change (CL-TAX-06, CL-TAX-20).
 */
async function saveSheet(tx: Transaction, before: EventTypeRow, modification: SheetModification) {
  const current = VERSION_NUMBER.parse(before.currentVersionNumber);
  const isSubstantive = modification.qualification.kind === 'substantive';
  return updateVersioned(tx, eventTypes, {
    where: eq(eventTypes.id, before.id),
    expectedVersion: modification.expectedVersion,
    set: {
      ...sheetColumns(modification.sheet, before.calendarDerivation !== null),
      switchedOffCriterion: before.switchedOffCriterion,
      currentVersionNumber: isSubstantive ? current + 1 : current,
    },
  });
}

/**
 * Creates the version that a substantive change of `type` gives (TAX-22, TAX-24): broadening
 * for a research type that it broadens, alone or with a narrowing, so that the supplements
 * and the "incomplete profile" mark see it (CL-BKT-05, SEN-46); a calendar-derived type is
 * in no backtest (CL-TAX-20).
 */
async function createVersion(
  tx: Transaction,
  type: EventTypeRow,
  change: Readonly<{ scope: SubstantiveChangeScope; reason: string; at: Date }>,
): Promise<Readonly<{ id: number; versionNumber: number }>> {
  const [version] = await tx
    .insert(typeSheetVersions)
    .values({
      eventTypeId: type.id,
      versionNumber: VERSION_NUMBER.parse(type.currentVersionNumber),
      createdAt: change.at,
      kind: 'substantive_change',
      substantiveScope: change.scope,
      isBroadening: type.calendarDerivation === null && BROADENING.has(change.scope),
      reason: change.reason,
      content: sheetContent(type),
    })
    .returning({ id: typeSheetVersions.id, versionNumber: typeSheetVersions.versionNumber });
  if (version === undefined) {
    throw new Error(`The insert of a version of ${type.id} returned no row.`);
  }
  return version;
}

/**
 * The effect of a substantive change of `type` on its events (TAX-25, CL-TAX-07, CL-TAX-20):
 * a calendar-derived type requests a full derivation, which gives every event the new
 * version, and marks nothing; a research type that the change narrows marks to requalify
 * every event of the type not marked yet, all of them qualified under an earlier version,
 * and they keep counting. Gives the number marked.
 */
async function applyToEvents(
  tx: Transaction,
  type: EventTypeRow,
  scope: SubstantiveChangeScope,
): Promise<number> {
  if (type.calendarDerivation !== null) {
    const requested = await requestDerivation(tx, {
      kind: 'full',
      cause: 'type_changed',
      eventType: type.id,
    });
    if (!requested.ok) {
      throw new Error(`The calendar-derived type ${type.id} was refused a derivation.`);
    }
    return 0;
  }
  if (!NARROWING.has(scope)) {
    return 0;
  }
  const marked = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.eventTypeId, type.id), isNull(events.typeLinkMark)));
  return markTypeLink(
    tx,
    marked.map((event) => event.id),
    'to_requalify',
  );
}

/** The version and the marks of a substantive change of `type`; none for a formal one. */
async function substantiveEffects(
  tx: Transaction,
  type: EventTypeRow,
  change: Readonly<{ scope: SubstantiveChangeScope | null; reason: string; at: Date }>,
): Promise<Omit<Modified, 'type'>> {
  const { scope } = change;
  if (scope === null) {
    return { version: null, markedToRequalify: 0 };
  }
  const version = await createVersion(tx, type, { ...change, scope });
  return { version, markedToRequalify: await applyToEvents(tx, type, scope) };
}

/** The type before and after a saved modification. */
type States = Readonly<{ before: EventTypeRow; after: EventTypeRow }>;

/**
 * The effects of a saved modification: the version and the marks of a substantive one,
 * the history entry with the content before and after, and the journal entry (TAX-21,
 * CL-TAX-06).
 */
async function applyModification(
  tx: Transaction,
  { before, after }: States,
  modification: SheetModification,
): Promise<Modified> {
  const { kind } = modification.qualification;
  const change = {
    scope: scopeOf(modification.qualification),
    reason: modification.reason.trim(),
    at: new Date(now()),
  };
  const effects = await substantiveEffects(tx, after, change);
  await tx.insert(typeSheetChanges).values({
    eventTypeId: after.id,
    changedAt: change.at,
    changeKind: kind,
    substantiveScope: change.scope,
    reason: change.reason,
    contentBefore: changeContent(before),
    contentAfter: changeContent(after),
    resultingVersionNumber: effects.version?.versionNumber ?? null,
  });
  const messageKey = kind === 'formal' ? 'type_modified_formally' : 'type_modified';
  await record(tx, { messageKey, eventTypeId: after.id });
  return { type: after, ...effects };
}

/**
 * Modifies the validated sheet of `typeId` in the caller's transaction `tx`, only if its
 * version is still `modification.expectedVersion` (TAX-21, TAX-22, TAX-24, TAX-25,
 * CL-TAX-06, CL-TAX-07, CL-TAX-20, CL-TAX-22, CL-IHM-18). The owner's qualification is
 * trusted. A formal change rewrites the current content under the current version number;
 * a substantive one also creates the next version, of kind `substantive_change` with its
 * scope, broadening when it broadens a research type (alone or with a narrowing). A
 * narrowing of a research type, alone or with a broadening, marks to requalify every event
 * of the type qualified under an earlier version, which keeps counting; a substantive change
 * of a calendar-derived type marks nothing and requests a full derivation, cause
 * `type_changed`, which gives every event the new version. Every save writes one history
 * entry with its instant, the content before and after, the qualification and the reason,
 * and a journal entry. The identifier, the calendar mark and the switched-off criterion
 * never change here; a calendar-derived type stays known in advance. Refused field by field
 * as a proposal is, and for an empty field of the complete sheet or a blank reason; refused
 * when the type is not validated or is gone, and when its version moved on, with the type
 * as it now stands.
 */
export async function modify(
  tx: Transaction,
  typeId: string,
  modification: SheetModification,
): Promise<Result<Modified, ModificationRefusal>> {
  const [before] = await tx.select().from(eventTypes).where(eq(eventTypes.id, typeId));
  if (before === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  if (before.status !== 'validated') {
    return err({ kind: 'not_validated', status: before.status });
  }
  const fields = await modificationErrors(tx, before, modification);
  if (fields !== undefined) {
    return err({ kind: 'invalid_fields', fields });
  }
  const saved = await saveSheet(tx, before, modification);
  return saved.ok
    ? ok(await applyModification(tx, { before, after: saved.value }, modification))
    : err(saved.error);
}
