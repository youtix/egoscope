import 'server-only';

import { asc } from 'drizzle-orm';
import { z } from 'zod';

import { canonicalValue } from '@/lib/ai-exchange';
import { eventTypes } from '@/lib/db';
import { toEpochMs } from '@/lib/time';
import { formatCount, sentence } from '@/lib/wording';

import type { CoverageThreshold, SwitchedOffCriterion } from './proposals';
import type { EventTypeRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/** A connection or the caller's transaction, to read through. */
export type Reader = Database | Transaction;

/** The state of a type: `'proposed' | 'validated' | 'rejected' | 'withdrawn'` (TAX-10). */
export type EventTypeStatus = EventTypeRow['status'];

/** Where a type comes from: `'scoping' | 'exploration' | 'detection'` (TAX-15). */
export type EventTypeOrigin = EventTypeRow['origin'];

/** The mark of the two calendar-derived types: `'birthday' | 'former_team'` (ADR 0015). */
export type CalendarDerivation = NonNullable<EventTypeRow['calendarDerivation']>;

/**
 * The closed-list reason of a rejection: `'not_clean' | 'not_datable' |
 * 'duplicate_of_existing_type' | 'out_of_scope' | 'other'` (TAX-13, H-TAX-04).
 */
export type TypeRejectionReason = NonNullable<EventTypeRow['rejectionReason']>;

/** The kind of a withdrawal's reason: `'entered' | 'merged_into' | 'split_into'` (TAX-27, TAX-29, TAX-31). */
export type TypeWithdrawalReasonKind = NonNullable<EventTypeRow['withdrawalReasonKind']>;

/** A type by its identifier and its current name: `{ id, name }`. */
export type TypeRef = Readonly<{ id: string; name: string }>;

/** A type reduced to its name and definition, with its identifier: `{ id, name, definition }`. */
export type NamedType = TypeRef & Readonly<{ definition: string | null }>;

// The content of a sheet that a version keeps (domain model, event types 1.3), each field
// as on event_types; a history entry's adds the switched-off criterion (type-detail.ts).
export const SHEET_CONTENT = z.object({
  name: z.string(),
  definition: z.string().nullable(),
  inclusionCriteria: z.string().nullable(),
  exclusionCriteria: z.string().nullable(),
  datingRule: z.string().nullable(),
  knownInAdvance: z.boolean(),
  genericExample: z.string().nullable(),
  documentationDifficulty: z.enum(eventTypes.documentationDifficulty.enumValues).nullable(),
  cautionNotes: z.string().nullable(),
  isIntimateSubject: z.boolean(),
  coverageThresholdOutlets: z.number().int().nullable(),
  coverageThresholdDays: z.number().int().nullable(),
});

/**
 * The content of a sheet that a version keeps (domain model, event types 1.3): `name`,
 * `definition`, `inclusionCriteria`, `exclusionCriteria`, `datingRule`, `knownInAdvance`,
 * `genericExample`, `documentationDifficulty`, `cautionNotes`, `isIntimateSubject`,
 * `coverageThresholdOutlets` and `coverageThresholdDays`, each typed as on `event_types`.
 */
export type SheetContent = Readonly<z.infer<typeof SHEET_CONTENT>>;

// The sheet of a validated type, which its row check keeps complete (TAX-01, TAX-12).
const COMPLETE_SHEET = z.object({
  currentVersionNumber: z.number().int(),
  definition: z.string(),
  inclusionCriteria: z.string(),
  exclusionCriteria: z.string(),
  datingRule: z.string(),
  genericExample: z.string(),
});
const VERSION_NUMBER = COMPLETE_SHEET.shape.currentVersionNumber;

/**
 * The instant of a `timestamptz` read back, in epoch milliseconds, as the dated
 * transitions, versions and history entries give it (TAX-10, TAX-21, TAX-26).
 */
export const instant = (date: Date): EpochMs => toEpochMs(date.getTime());

/**
 * Every type in the order of the taxonomy, by creation then by identifier, whatever its
 * state (TAX-10, TAX-11); the table holds a few dozen rows, so every list reads it whole
 * once and filters it.
 */
export async function allTypes(db: Reader): Promise<readonly EventTypeRow[]> {
  return db.select().from(eventTypes).orderBy(asc(eventTypes.createdAt), asc(eventTypes.id));
}

/** A type's reference, `{ id, name }`, as lists and links name it (TAX-10, TAX-28, TAX-30). */
export const typeRef = (type: EventTypeRow): TypeRef => ({ id: type.id, name: type.name });
const namedType = (type: EventTypeRow): NamedType => ({
  ...typeRef(type),
  definition: type.definition,
});
const isCalendarDerived = (type: EventTypeRow): boolean => type.calendarDerivation !== null;
const isResearchType = (type: EventTypeRow): boolean => !isCalendarDerived(type);

/**
 * The snapshot of a sheet that a version keeps and that a history entry starts from,
 * built from a type's row or a draft of it (TAX-20, TAX-21, TAX-33, domain model event
 * types 1.3): every field of `SheetContent` and nothing else, the switched-off criterion
 * being no part of a version (ADR 0016). Every writer of versions and history uses it.
 */
export function sheetContent(row: SheetContent): SheetContent {
  return SHEET_CONTENT.parse(row);
}

/** What validated sheets are served to (TAX-11, CL-TAX-10). */
export type SheetPurpose =
  'research_prompt' | 'import' | 'classification' | 'calculation' | 'exploration';

/**
 * A validated type's sheet in its current content and version number, in full (TAX-33):
 * `id`, `name`, `versionNumber`, `definition`, `inclusionCriteria`, `exclusionCriteria`,
 * `datingRule` (ending with the coverage-threshold sentence when the sheet has one,
 * CL-TAX-14), `knownInAdvance`, `genericExample`, `calendarDerivation` (null for a
 * research type), `coverageThreshold` (null when none) and `switchedOffCriterion`, which
 * the calculation applies and no version holds (ADR 0016).
 */
export type ValidatedSheet = TypeRef &
  Readonly<{
    versionNumber: number;
    definition: string;
    inclusionCriteria: string;
    exclusionCriteria: string;
    datingRule: string;
    knownInAdvance: boolean;
    genericExample: string;
    calendarDerivation: CalendarDerivation | null;
    coverageThreshold: CoverageThreshold | null;
    switchedOffCriterion: SwitchedOffCriterion | null;
  }>;

// The purposes that receive the research types only, the calendar-derived ones left out.
const RESEARCH_PURPOSES: ReadonlySet<SheetPurpose> = new Set([
  'research_prompt',
  'import',
  'classification',
]);

function coverageThreshold(type: EventTypeRow): CoverageThreshold | null {
  const { coverageThresholdOutlets: outlets, coverageThresholdDays: days } = type;
  return outlets === null || days === null ? null : { outlets, days };
}

/** The dating rule as a sheet is sent: the coverage-threshold sentence appended (CL-TAX-14). */
function sentDatingRule(datingRule: string, threshold: CoverageThreshold | null): string {
  if (threshold === null) {
    return datingRule;
  }
  const { outlets, days } = threshold;
  const appended = sentence('taxonomy.coverageThreshold', {
    N: formatCount(outlets),
    D: formatCount(days),
  });
  return `${datingRule} ${appended}`;
}

function validatedSheet(type: EventTypeRow): ValidatedSheet {
  const { currentVersionNumber, datingRule, ...texts } = COMPLETE_SHEET.parse(type);
  const threshold = coverageThreshold(type);
  return {
    ...typeRef(type),
    ...texts,
    versionNumber: currentVersionNumber,
    datingRule: sentDatingRule(datingRule, threshold),
    knownInAdvance: type.knownInAdvance,
    calendarDerivation: type.calendarDerivation,
    coverageThreshold: threshold,
    switchedOffCriterion: type.switchedOffCriterion,
  };
}

/**
 * The validated types, in the order of the taxonomy, as the exploration prompt receives
 * them: every one, the calendar-derived ones included, by name and definition (TAX-11,
 * TAX-16, CL-TAX-10).
 */
export async function validatedSheets(
  db: Reader,
  purpose: 'exploration',
): Promise<readonly NamedType[]>;
/**
 * The validated types, in the order of the taxonomy, as `purpose` receives them, each
 * sheet in full (TAX-11, TAX-33, CL-TAX-14): the research prompt, the import and the
 * classification get the research types only, the calculation every validated type, the
 * calendar-derived ones included. No type in another state is ever served.
 */
export async function validatedSheets(
  db: Reader,
  purpose: Exclude<SheetPurpose, 'exploration'>,
): Promise<readonly ValidatedSheet[]>;
export async function validatedSheets(
  db: Reader,
  purpose: SheetPurpose,
): Promise<readonly (NamedType | ValidatedSheet)[]> {
  const types = await allTypes(db);
  const validated = types.filter((type) => type.status === 'validated');
  if (purpose === 'exploration') {
    return validated.map((type) => namedType(type));
  }
  const served = RESEARCH_PURPOSES.has(purpose)
    ? validated.filter((type) => isResearchType(type))
    : validated;
  return served.map((type) => validatedSheet(type));
}

/**
 * The name and definition of every calendar-derived type, whatever its state, which the
 * classification receives as the types handled by the calendar (CL-TAX-21, CL-DET-22).
 */
export async function handledByCalendarList(db: Reader): Promise<readonly NamedType[]> {
  const types = await allTypes(db);
  return types.filter((type) => isCalendarDerived(type)).map((type) => namedType(type));
}

/** An entry of the exploration's do-not-repropose list: `NamedType` and `rejectionReason`. */
export type ExplorationEntry = NamedType &
  Readonly<{ rejectionReason: TypeRejectionReason | null }>;

/**
 * The do-not-repropose list of the exploration prompt (TAX-11, TAX-16, CL-TAX-10): every
 * proposed, rejected and withdrawn type, the calendar-derived ones included, by name and
 * definition, with a rejected type's closed-list reason, never the owner's comment.
 */
export async function doNotReproposeList(
  db: Reader,
  purpose: 'exploration',
): Promise<readonly ExplorationEntry[]>;
/**
 * The do-not-repropose list of the classification (TAX-11, TAX-18, CL-TAX-21): every
 * proposed, rejected and withdrawn research type by name and definition, the
 * calendar-derived ones coming in `handledByCalendarList` instead.
 */
export async function doNotReproposeList(
  db: Reader,
  purpose: 'classification',
): Promise<readonly NamedType[]>;
export async function doNotReproposeList(
  db: Reader,
  purpose: 'exploration' | 'classification',
): Promise<readonly NamedType[]> {
  const types = await allTypes(db);
  const entries = types.filter((type) => type.status !== 'validated');
  return purpose === 'classification'
    ? entries.filter((type) => isResearchType(type)).map((type) => namedType(type))
    : entries.map((type) => ({ ...namedType(type), rejectionReason: type.rejectionReason }));
}

/**
 * What a type identifier of a research result names, `typeId` being the taxonomy's
 * spelling (TAX-11, TAX-28, TAX-30, TAX-31, CL-IMP-29): `validated`, with its current
 * `versionNumber`; `merged` into `survivor`, the validated type at the end of the chain of
 * merges; `split` when a split lies on the way, `into` listing, each once and never empty,
 * the validated types that can still receive the event, each reached through its later
 * merges and splits, for the owner to choose; `not_validated`, a proposed, rejected or
 * withdrawn type outside merge and split, or one whose links reach no validated type;
 * `calendar_derived`, whatever its state; or `unknown`, an import error, since no function
 * creates a type on the fly.
 */
export type TypeResolution =
  | Readonly<{ kind: 'validated'; typeId: string; versionNumber: number }>
  | Readonly<{ kind: 'merged'; typeId: string; survivor: TypeRef }>
  | Readonly<{ kind: 'split'; typeId: string; into: readonly TypeRef[] }>
  | Readonly<{ kind: 'not_validated'; typeId: string }>
  | Readonly<{ kind: 'calendar_derived'; typeId: string }>
  | Readonly<{ kind: 'unknown' }>;

/** The validated types an event of a type can still go to, and whether a split led there. */
type Receivers = Readonly<{ split: boolean; types: readonly EventTypeRow[] }>;

/** The bug of links that lead back to `typeId`, which no writer of merges and splits can make. */
function cycleThrough(typeId: string): Error {
  return new Error(`The merge and split links of the event types lead back to ${typeId}.`);
}

/**
 * The type at the end of the chain of merges that `type` starts: itself when not merged.
 * A chain that leads back to one of its types is a bug, thrown rather than followed forever.
 */
function lastSurvivor(type: EventTypeRow, types: readonly EventTypeRow[]): EventTypeRow {
  const byId = new Map<string | null, EventTypeRow>(
    types.map((candidate) => [candidate.id, candidate]),
  );
  const chain = new Set([type.id]);
  let survivor = type;
  for (
    let next = byId.get(type.mergedIntoTypeId);
    next !== undefined;
    next = byId.get(next.mergedIntoTypeId)
  ) {
    if (chain.has(next.id)) {
      throw cycleThrough(next.id);
    }
    chain.add(next.id);
    survivor = next;
  }
  return survivor;
}

/**
 * The validated types that can still receive an event of `type`, through every link that
 * later merges and splits added: the type itself when validated; its survivor's when it was
 * merged; the union of its split types' when it was split, each type once; none when it is
 * proposed, rejected or withdrawn outside merge and split (TAX-28, TAX-30, TAX-31). The
 * calendar-derived types take part in no merge or split (CL-TAX-20). `path` holds the split
 * types already on the way: links that lead back to one of them are a bug, thrown.
 */
function receiversOf(
  type: EventTypeRow,
  types: readonly EventTypeRow[],
  path: ReadonlySet<string> = new Set(),
): Receivers {
  const survivor = lastSurvivor(type, types);
  if (path.has(survivor.id)) {
    throw cycleThrough(survivor.id);
  }
  if (survivor.status === 'validated') {
    return { split: false, types: [survivor] };
  }
  if (survivor.withdrawalReasonKind === 'split_into') {
    const within = new Set([...path, survivor.id]);
    const reached = types
      .filter((candidate) => candidate.splitFromTypeId === survivor.id)
      .flatMap((candidate) => receiversOf(candidate, types, within).types);
    return { split: true, types: [...new Set(reached)] };
  }
  return { split: false, types: [] };
}

function resolution(type: EventTypeRow, types: readonly EventTypeRow[]): TypeResolution {
  const typeId = type.id;
  if (isCalendarDerived(type)) {
    return { kind: 'calendar_derived', typeId };
  }
  if (type.status === 'validated') {
    const versionNumber = VERSION_NUMBER.parse(type.currentVersionNumber);
    return { kind: 'validated', typeId, versionNumber };
  }
  const receivers = receiversOf(type, types);
  const into = receivers.types.map((receiver) => typeRef(receiver));
  const [survivor] = into;
  if (survivor === undefined) {
    return { kind: 'not_validated', typeId };
  }
  return receivers.split ? { kind: 'split', typeId, into } : { kind: 'merged', typeId, survivor };
}

function resolveAmong(raw: string, types: readonly EventTypeRow[]): TypeResolution {
  const typeId = canonicalValue(
    raw,
    types.map((type) => type.id),
  );
  const type = types.find((candidate) => candidate.id === typeId);
  return type === undefined ? { kind: 'unknown' } : resolution(type, types);
}

/**
 * Resolves a type identifier read in a research result (TAX-11, TAX-28, TAX-30, TAX-31,
 * CL-IMP-29), compared as CL-IMP-22 says: trimmed, without case or diacritics, inner
 * spaces and punctuation kept, so that `media_storm` names no `media-storm`.
 */
export async function resolveTypeId(db: Reader, raw: string): Promise<TypeResolution> {
  return resolveAmong(raw, await allTypes(db));
}

/**
 * Resolves the type identifiers of a whole research result with one read of the types,
 * each answer as `resolveTypeId` gives it, in the order of `raws` (TAX-11, TAX-28, TAX-30,
 * TAX-31, CL-IMP-22, CL-IMP-29).
 */
export async function resolveTypeIds(
  db: Reader,
  raws: readonly string[],
): Promise<readonly TypeResolution[]> {
  const types = await allTypes(db);
  return raws.map((raw) => resolveAmong(raw, types));
}

/** A type as the list of types shows it: `{ id, name, origin, calendarDerivation, createdAt }`. */
export type ListedType = TypeRef &
  Readonly<{
    origin: EventTypeOrigin;
    calendarDerivation: CalendarDerivation | null;
    createdAt: EpochMs;
  }>;

/** The types of one state, in the order of the taxonomy: `{ status, count, types }`. */
export type StatusGroup = Readonly<{
  status: EventTypeStatus;
  count: number;
  types: readonly ListedType[];
}>;

/**
 * The types by state, one group per state in the order of TAX-10 (proposed, validated,
 * rejected, withdrawn), empty ones included, each with its count and every type's origin
 * (TAX-10, TAX-15).
 */
export async function listByStatus(db: Reader): Promise<readonly StatusGroup[]> {
  const types = await allTypes(db);
  return eventTypes.status.enumValues.map((status) => {
    const listed = types
      .filter((type) => type.status === status)
      .map((type) => ({
        ...typeRef(type),
        origin: type.origin,
        calendarDerivation: type.calendarDerivation,
        createdAt: instant(type.createdAt),
      }));
    return { status, count: listed.length, types: listed };
  });
}
