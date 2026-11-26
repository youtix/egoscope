import 'server-only';

import { eq, like, or, sql } from 'drizzle-orm';

import { eventTypes, updateVersioned } from '@/lib/db';
import { record } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import type { EventTypeRow, NewEventTypeRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';

/** How hard a type is to document (TAX-01, TAX-08). */
export type DocumentationDifficulty = NonNullable<EventTypeRow['documentationDifficulty']>;

/** The one doubtful-case criterion that a type may switch off (ADR 0016, CL-TAX-17). */
export type SwitchedOffCriterion = NonNullable<EventTypeRow['switchedOffCriterion']>;

/** The coverage threshold of a media storm: distinct outlets within a window of days (CL-TAX-14). */
export type CoverageThreshold = Readonly<{ outlets: number; days: number }>;

/**
 * The sheet of a proposal as the owner or an exploration gives it, written in English
 * (CL-TAX-03). Only the name is required, a proposal being incomplete until its
 * validation (TAX-01, TAX-12): a text left out or blank is empty. The "derived from the
 * calendar" mark is never offered (CL-TAX-20).
 */
export type ProposalSheet = Readonly<{
  name: string;
  definition?: string;
  inclusionCriteria?: string;
  exclusionCriteria?: string;
  datingRule?: string;
  knownInAdvance?: boolean;
  genericExample?: string;
  cautionNotes?: string;
  documentationDifficulty?: DocumentationDifficulty;
  isIntimateSubject?: boolean;
  coverageThreshold?: CoverageThreshold;
  /** Empty by default; its history starts once the sheet is validated (CL-TAX-06, CL-TAX-17). */
  switchedOffCriterion?: SwitchedOffCriterion;
}>;

/** The origins of a proposal made after the first start: the seeded ones are scoping (TAX-15). */
export type ProposalOrigin = 'exploration' | 'detection';

/** The fields to fix, each with what is wrong with it. */
export type ProposalFieldErrors = Readonly<{
  /** Blank, or, for a new proposal, without a letter or a digit to build its identifier from. */
  name?: 'required' | 'no_letters_or_digits';
  /** Not whole numbers of 2 to 10 outlets within 1 to 7 days. */
  coverageThreshold?: 'out_of_range';
  /** Co-occurring cases, while their parameter is off. */
  switchedOffCriterion?: 'not_offered';
}>;

/** A proposal that cannot be saved as it stands. */
export type InvalidProposalFields = Readonly<{
  kind: 'invalid_fields';
  fields: ProposalFieldErrors;
}>;

/** Why an edit is refused. */
export type ProposalEditRefusal =
  | InvalidProposalFields
  | ChangedElsewhere<EventTypeRow>
  | NoLongerExists
  // A validated, rejected or withdrawn type is changed by other operations (TAX-20).
  | Readonly<{ kind: 'not_proposed'; status: EventTypeRow['status'] }>;

/** The edit of a proposal as its screen sends it back (CL-IHM-18). */
export type ProposalEdit = Readonly<{
  /** The whole sheet: what the edit leaves out is emptied. */
  sheet: ProposalSheet;
  /** The `row_version` that the screen showed. */
  expectedVersion: number;
}>;

// The key of the transaction lock that one creation at a time takes, so that two proposals
// made at once never draw the same identifier.
const IDENTIFIER_LOCK_KEY = 77_002;
// The longest slug before a suffix, cut at a hyphen (CL-TAX-02).
const MAX_SLUG_LENGTH = 40;
// The first suffix that a taken identifier gets (CL-TAX-02).
const FIRST_SUFFIX = 2;
// The fixed route segments under /types, taken whatever the types (CL-TAX-02, module map section 3.1).
const RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set(['merge', 'explore']);
// The bounds of the coverage threshold (CL-TAX-14).
const MIN_COVERAGE_OUTLETS = 2;
const MAX_COVERAGE_OUTLETS = 10;
const MIN_COVERAGE_DAYS = 1;
const MAX_COVERAGE_DAYS = 7;
// The next-line character, which `trim()` leaves but the database check of a name counts as white space.
const NEXT_LINE = '\u{85}';
const MARKS = /\p{M}/gu;
const RUNS_OF_OTHER_CHARACTERS = /[^a-z0-9]+/;

/** Whether `text` holds nothing but white space of any kind, as the database check of a name reads it. */
function isBlank(text: string): boolean {
  return text.replaceAll(NEXT_LINE, '').trim() === '';
}

/** `text` trimmed, or none when it is blank: an empty field is empty, never an empty string. */
function textOrNull(text: string | undefined): string | null {
  return text === undefined || isBlank(text) ? null : text.trim();
}

/**
 * The slug of `name` before any suffix (CL-TAX-02): Unicode NFKD, diacritics removed,
 * lowercase, every run of other characters one hyphen, none at the ends, cut at a
 * hyphen to 40 characters at most; a single word longer than that is cut at 40.
 */
function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replaceAll(MARKS, '')
    .toLowerCase()
    .split(RUNS_OF_OTHER_CHARACTERS)
    .filter((word) => word !== '')
    .join('-');
  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug;
  }
  const hyphen = slug.lastIndexOf('-', MAX_SLUG_LENGTH);
  return slug.slice(0, hyphen === -1 ? MAX_SLUG_LENGTH : hyphen);
}

/**
 * The identifier of a proposal whose name has the slug `base`: that slug, then the smallest suffix `-2`,
 * `-3`… that no type of any status and no fixed route segment holds (CL-TAX-02, TAX-02).
 */
async function freeIdentifier(tx: Transaction, base: string): Promise<string> {
  const rows = await tx
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(or(eq(eventTypes.id, base), like(eventTypes.id, `${base}-%`)));
  const taken = new Set([...RESERVED_IDENTIFIERS, ...rows.map((row) => row.id)]);
  if (!taken.has(base)) {
    return base;
  }
  let suffix = FIRST_SUFFIX;
  while (taken.has(`${base}-${String(suffix)}`)) {
    suffix += 1;
  }
  return `${base}-${String(suffix)}`;
}

/** Whether `threshold`, when given, is whole numbers within the bounds of CL-TAX-14. */
function isValidThreshold(threshold: CoverageThreshold | undefined): boolean {
  if (threshold === undefined) {
    return true;
  }
  const { outlets, days } = threshold;
  return (
    Number.isSafeInteger(outlets) &&
    outlets >= MIN_COVERAGE_OUTLETS &&
    outlets <= MAX_COVERAGE_OUTLETS &&
    Number.isSafeInteger(days) &&
    days >= MIN_COVERAGE_DAYS &&
    days <= MAX_COVERAGE_DAYS
  );
}

/**
 * Whether the sheet asks for co-occurring cases to be switched off while their
 * parameter is off, which only a criterion that the sheet already holds may do (CL-TAX-17).
 */
async function isNotOffered(
  tx: Transaction,
  asked: SwitchedOffCriterion | undefined,
  held: SwitchedOffCriterion | null,
): Promise<boolean> {
  return (
    asked === 'co_occurring' &&
    held !== asked &&
    !(await getParam(tx, 'sensitivity.coOccurringCasesDoubtful'))
  );
}

/** What is wrong with `sheet`, field by field, if anything: a modification checks it too (TAX-21). */
export async function fieldErrors(
  tx: Transaction,
  sheet: ProposalSheet,
  held: SwitchedOffCriterion | null,
): Promise<ProposalFieldErrors | undefined> {
  const fields: ProposalFieldErrors = {
    ...(isBlank(sheet.name) && { name: 'required' as const }),
    ...(!isValidThreshold(sheet.coverageThreshold) && {
      coverageThreshold: 'out_of_range' as const,
    }),
    ...((await isNotOffered(tx, sheet.switchedOffCriterion, held)) && {
      switchedOffCriterion: 'not_offered' as const,
    }),
  };
  return Object.keys(fields).length === 0 ? undefined : fields;
}

/** The columns of `event_types` that a sheet fills. */
type SheetColumns = Required<
  Pick<
    NewEventTypeRow,
    | 'name'
    | 'definition'
    | 'inclusionCriteria'
    | 'exclusionCriteria'
    | 'datingRule'
    | 'knownInAdvance'
    | 'genericExample'
    | 'cautionNotes'
    | 'documentationDifficulty'
    | 'isIntimateSubject'
    | 'coverageThresholdOutlets'
    | 'coverageThresholdDays'
    | 'switchedOffCriterion'
  >
>;

/**
 * The sheet columns of `sheet`, as a proposal or a modification writes them (TAX-01, TAX-21);
 * a calendar-derived type keeps its "known in advance" mark (CL-TAX-20).
 */
export function sheetColumns(sheet: ProposalSheet, isCalendarDerived: boolean): SheetColumns {
  return {
    name: sheet.name.trim(),
    definition: textOrNull(sheet.definition),
    inclusionCriteria: textOrNull(sheet.inclusionCriteria),
    exclusionCriteria: textOrNull(sheet.exclusionCriteria),
    datingRule: textOrNull(sheet.datingRule),
    knownInAdvance: isCalendarDerived || (sheet.knownInAdvance ?? false),
    genericExample: textOrNull(sheet.genericExample),
    cautionNotes: textOrNull(sheet.cautionNotes),
    documentationDifficulty: sheet.documentationDifficulty ?? null,
    isIntimateSubject: sheet.isIntimateSubject ?? false,
    coverageThresholdOutlets: sheet.coverageThreshold?.outlets ?? null,
    coverageThresholdDays: sheet.coverageThreshold?.days ?? null,
    switchedOffCriterion: sheet.switchedOffCriterion ?? null,
  };
}

/**
 * Creates the proposal `sheet`, of origin `origin`, in the caller's transaction `tx`
 * (TAX-01, TAX-02, TAX-15, CL-TAX-02, CL-TAX-14, CL-TAX-20, ADR 0016): proposed, dated
 * now, incomplete if need be, only the name being required (the completeness that its
 * validation needs is checked there, TAX-12). Its identifier comes from its English
 * name, NFKD with the diacritics removed, lowercase, the runs of other characters one
 * hyphen, cut at a hyphen to 40 characters, then the smallest suffix `-2`, `-3`… that
 * no type of any status holds, the fixed `merge` and `explore` of the type routes
 * counting as held: a rejected type's identifier is never given again (CA-TAX-05). The
 * identifier never changes afterwards. Journals the save. Refused, field by field, for
 * a blank name or one with no letter or digit to build an identifier from, a coverage
 * threshold outside 2 to 10 outlets within 1 to 7 days, and co-occurring cases switched
 * off while their parameter is off.
 */
export async function createProposal(
  tx: Transaction,
  origin: ProposalOrigin,
  sheet: ProposalSheet,
): Promise<Result<EventTypeRow, InvalidProposalFields>> {
  const base = slugOf(sheet.name);
  const checked = await fieldErrors(tx, sheet, null);
  const fields: ProposalFieldErrors = {
    ...checked,
    ...(checked?.name === undefined && base === '' && { name: 'no_letters_or_digits' as const }),
  };
  if (Object.keys(fields).length > 0) {
    return err({ kind: 'invalid_fields', fields });
  }
  await tx.execute(sql`select pg_advisory_xact_lock(${IDENTIFIER_LOCK_KEY})`);
  const [created] = await tx
    .insert(eventTypes)
    .values({
      ...sheetColumns(sheet, false),
      id: await freeIdentifier(tx, base),
      status: 'proposed',
      origin,
      createdAt: new Date(now()),
    })
    .returning();
  if (created === undefined) {
    throw new Error('The insert of a proposal returned no row.');
  }
  await record(tx, { messageKey: 'type_proposal_saved', eventTypeId: created.id });
  return ok(created);
}

/**
 * Replaces the sheet of the proposed type `typeId` by `edit.sheet`, in the caller's
 * transaction `tx`, only if its version is still `edit.expectedVersion` (TAX-01,
 * TAX-20, CL-IHM-18, CL-TAX-20): no version of the sheet is created before its
 * validation, and the identifier, the origin, the creation date and the calendar mark
 * never change; a calendar-derived type stays known in advance. Journals the save.
 * Refused field by field as `createProposal` is, except that a name without a letter or
 * a digit is fine, the identifier being given; refused when the type is not proposed or
 * is gone, and when its version moved on, with the type as it now stands.
 */
export async function editProposal(
  tx: Transaction,
  typeId: string,
  edit: ProposalEdit,
): Promise<Result<EventTypeRow, ProposalEditRefusal>> {
  const [before] = await tx.select().from(eventTypes).where(eq(eventTypes.id, typeId));
  if (before === undefined) {
    return err({ kind: 'no_longer_exists' });
  }
  if (before.status !== 'proposed') {
    return err({ kind: 'not_proposed', status: before.status });
  }
  const fields = await fieldErrors(tx, edit.sheet, before.switchedOffCriterion);
  if (fields !== undefined) {
    return err({ kind: 'invalid_fields', fields });
  }
  const saved = await updateVersioned(tx, eventTypes, {
    where: eq(eventTypes.id, typeId),
    expectedVersion: edit.expectedVersion,
    set: sheetColumns(edit.sheet, before.calendarDerivation !== null),
  });
  if (!saved.ok) {
    return err(saved.error);
  }
  await record(tx, { messageKey: 'type_proposal_saved', eventTypeId: typeId });
  return ok(saved.value);
}
