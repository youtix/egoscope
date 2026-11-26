// The end of the exploration round trip (TAX-17), beside exploration.ts for the size
// limits: the ticked types become proposals and, in targeted mode, the picked elements
// are copied into the proposal that the exploration deepens. The illustration sources
// that pass the source checks of IMP-14 are stored with their proposal only (TAX-03,
// CL-TAX-16), and the pasted text goes with its draft (DSN-32, CL-DSN-17).
import 'server-only';

import { eq, max } from 'drizzle-orm';

import { eventTypes, typeIllustrationSources } from '@/lib/db';
import { discardDraft } from '@/lib/drafts';
import { err, ok } from '@/lib/result';

import { readCheckedResponse } from './exploration';
import { createProposal, editProposal } from './proposals';

import type { CheckedType } from './exploration';
import type { ProposalEditRefusal, ProposalFieldErrors, ProposalSheet } from './proposals';
import type { EventTypeRow } from './types';
import type {
  CheckedSource,
  ExchangeDate,
  ExplorationResponseError,
  ProposedType,
} from '@/lib/ai-exchange';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

// An element of the sheet that a proposed type and a proposal both have.
type SheetElement = keyof ProposalSheet & keyof ProposedType;

/**
 * An element of a proposed type that a targeted exploration copies into its proposal, by
 * its field in `ProposedType`: a text or a mark of the sheet, or the illustration
 * sources; the possible overlaps are never stored (CL-TAX-04).
 */
export type CopiedElement = SheetElement | 'illustrationSources';

/** An element that the owner picks, and the 1-based position of the proposed type it comes from. */
export type ElementPick = Readonly<{ element: CopiedElement; position: number }>;

/**
 * The proposal whose targeted screen the response was pasted on: its identifier, the
 * `row_version` that the screen showed and the elements that the owner copies into it.
 */
export type ExplorationTargetPicks = Readonly<{
  typeId: string;
  expectedVersion: number;
  picks: readonly ElementPick[];
}>;

/**
 * What the owner confirms (TAX-17): the pasted text, the 1-based positions of the
 * proposed types that he ticks, and the targeted proposal, null on the general screen,
 * where an idea is explored too (CL-DSN-17).
 */
export type ExplorationChoice = Readonly<{
  pastedText: string;
  ticked: readonly number[];
  target: ExplorationTargetPicks | null;
}>;

/** What a confirmation saved: the proposals created, and the targeted proposal once edited, if it was. */
export type ExplorationCreation = Readonly<{
  created: readonly EventTypeRow[];
  target: EventTypeRow | null;
}>;

/**
 * Why a confirmation is refused: the response, refused whole; a ticked position that
 * holds no proposed type with a name, or a pick of an element that its proposed type
 * lacks (`not_in_response`); a ticked type that `createProposal` refuses; or the edit of
 * the targeted proposal, refused as `editProposal` refuses it (CL-IHM-18).
 */
export type ExplorationCreationRefusal =
  | ExplorationResponseError
  | Readonly<{ kind: 'not_in_response'; position: number }>
  | Readonly<{ kind: 'proposal_refused'; position: number; fields: ProposalFieldErrors }>
  | ProposalEditRefusal;

type NotInResponse = Readonly<{ kind: 'not_in_response'; position: number }>;
type ResolvedPick = Readonly<{ element: CopiedElement; from: CheckedType }>;

/** The sheet of a ticked type, named `name`: a missing text is empty (TAX-17), a missing mark unset. */
function sheetOf(type: ProposedType, name: string): ProposalSheet {
  return {
    name,
    definition: type.definition ?? '',
    inclusionCriteria: type.inclusionCriteria ?? '',
    exclusionCriteria: type.exclusionCriteria ?? '',
    datingRule: type.datingRule ?? '',
    genericExample: type.genericExample ?? '',
    knownInAdvance: type.knownInAdvance ?? false,
    ...(type.documentationDifficulty !== undefined && {
      documentationDifficulty: type.documentationDifficulty,
    }),
  };
}

/** The texts of the proposal `row` as they stand, a missing one empty. */
function currentTexts(row: EventTypeRow) {
  return {
    name: row.name,
    definition: row.definition ?? '',
    inclusionCriteria: row.inclusionCriteria ?? '',
    exclusionCriteria: row.exclusionCriteria ?? '',
    datingRule: row.datingRule ?? '',
    genericExample: row.genericExample ?? '',
    cautionNotes: row.cautionNotes ?? '',
  };
}

/** The sheet of the proposal `row` as it stands, every field kept, since an edit empties what it leaves out. */
function currentSheet(row: EventTypeRow): ProposalSheet {
  const { coverageThresholdOutlets: outlets, coverageThresholdDays: days } = row;
  return {
    ...currentTexts(row),
    knownInAdvance: row.knownInAdvance,
    isIntimateSubject: row.isIntimateSubject,
    ...(row.documentationDifficulty !== null && {
      documentationDifficulty: row.documentationDifficulty,
    }),
    ...(outlets !== null && days !== null && { coverageThreshold: { outlets, days } }),
    ...(row.switchedOffCriterion !== null && { switchedOffCriterion: row.switchedOffCriterion }),
  };
}

/** The columns of the time of a publication date: its instant and offset when it has a time (CL-IMP-09). */
function timeColumns(date: ExchangeDate) {
  return date.kind === 'instant'
    ? { publicationAt: new Date(date.at), publicationOffsetMinutes: date.offsetMinutes }
    : { publicationAt: null, publicationOffsetMinutes: null };
}

/**
 * Stores `sources` with the proposal `typeId` alone, numbered after those it has: the
 * link, outlet and title as published, the publication date as written (TAX-03, DSN-08,
 * CL-TAX-16).
 */
async function storeSources(
  tx: Transaction,
  typeId: string,
  sources: readonly CheckedSource[],
): Promise<void> {
  if (sources.length === 0) {
    return;
  }
  const [last] = await tx
    .select({ position: max(typeIllustrationSources.position) })
    .from(typeIllustrationSources)
    .where(eq(typeIllustrationSources.eventTypeId, typeId));
  const lastPosition = last?.position ?? 0;
  const rows = sources.map((source, index) => ({
    eventTypeId: typeId,
    position: lastPosition + index + 1,
    url: source.url,
    outlet: source.outlet ?? null,
    title: source.title ?? null,
    publicationDateOn: source.publicationDate.on,
    ...timeColumns(source.publicationDate),
  }));
  await tx.insert(typeIllustrationSources).values(rows);
}

/** Creates the ticked type at `position` as a proposal of origin exploration, with its kept sources. */
async function createTicked(
  tx: Transaction,
  types: readonly CheckedType[],
  position: number,
): Promise<Result<EventTypeRow, ExplorationCreationRefusal>> {
  const ticked = types[position - 1];
  if (ticked === undefined) {
    return err({ kind: 'not_in_response', position });
  }
  const { type, sources } = ticked;
  if (!type.canBecomeProposal) {
    return err({ kind: 'not_in_response', position });
  }
  const created = await createProposal(tx, 'exploration', sheetOf(type, type.name));
  if (!created.ok) {
    return err({ kind: 'proposal_refused', position, fields: created.error.fields });
  }
  await storeSources(tx, created.value.id, sources.kept);
  return created;
}

/** Creates each ticked type once, in the order of the ticks, or stops at the first one refused. */
async function createEveryTicked(
  tx: Transaction,
  types: readonly CheckedType[],
  ticked: readonly number[],
): Promise<Result<readonly EventTypeRow[], ExplorationCreationRefusal>> {
  const created: EventTypeRow[] = [];
  const positions = new Set(ticked);
  for (const position of positions) {
    const proposal = await createTicked(tx, types, position);
    if (!proposal.ok) {
      return proposal;
    }
    created.push(proposal.value);
  }
  return ok(created);
}

/** Each pick with the proposed type it comes from, or the first one that the response cannot give. */
function resolvePicks(
  types: readonly CheckedType[],
  picks: readonly ElementPick[],
): Result<readonly ResolvedPick[], NotInResponse> {
  const resolved: ResolvedPick[] = [];
  for (const { element, position } of picks) {
    const from = types[position - 1];
    if (from?.type[element] === undefined) {
      return err({ kind: 'not_in_response', position });
    }
    resolved.push({ element, from });
  }
  return ok(resolved);
}

/** `sheet` with each picked element of the sheet copied in, a later pick of an element winning. */
function withPicks(sheet: ProposalSheet, picks: readonly ResolvedPick[]): ProposalSheet {
  let copied = sheet;
  for (const { element, from } of picks) {
    if (element !== 'illustrationSources') {
      copied = { ...copied, [element]: from.type[element] };
    }
  }
  return copied;
}

/**
 * Copies the picked elements into the targeted proposal through `editProposal`, its kept
 * sources after its own (TAX-17, CL-TAX-16); touches nothing when nothing is picked.
 */
async function copyPicks(
  tx: Transaction,
  types: readonly CheckedType[],
  target: ExplorationTargetPicks,
): Promise<Result<EventTypeRow | null, ExplorationCreationRefusal>> {
  const resolved = resolvePicks(types, target.picks);
  if (!resolved.ok) {
    return resolved;
  }
  if (resolved.value.length === 0) {
    return ok(null);
  }
  const [row] = await tx.select().from(eventTypes).where(eq(eventTypes.id, target.typeId));
  if (row === undefined) {
    return err({ kind: 'no_longer_exists' });
  }
  const sheet = withPicks(currentSheet(row), resolved.value);
  const edited = await editProposal(tx, target.typeId, {
    sheet,
    expectedVersion: target.expectedVersion,
  });
  if (!edited.ok) {
    return edited;
  }
  const picked = resolved.value.filter(({ element }) => element === 'illustrationSources');
  await storeSources(
    tx,
    target.typeId,
    picked.flatMap(({ from }) => from.sources.kept),
  );
  return edited;
}

/**
 * Saves what the owner confirms on the exploration screen, in the caller's transaction
 * `tx` (TAX-15, TAX-17, CL-TAX-04): the pasted response is read again as its preview
 * reads it; each ticked type, each once, becomes a proposal of origin exploration, with
 * the status proposed, incomplete if need be, and only those; in targeted mode the
 * elements that the owner picks are copied into the targeted proposal through
 * `editProposal`. The illustration sources that pass the checks of IMP-14 are stored
 * with their proposal only, never in a sheet (TAX-03, CL-TAX-16). The exploration draft
 * of the screen, general or of the targeted proposal, is discarded in the same
 * transaction, so the pasted text is not kept (DSN-32, CL-DSN-17, CA-TAX-08). Refused as
 * `ExplorationCreationRefusal` says, nothing being created for a refused response
 * (CA-TAX-17); a refusal met once a proposal is written leaves its rollback to the
 * caller's transaction, as `transaction()` of `@/lib/db` does for a failure.
 */
export async function createFromExploration(
  tx: Transaction,
  choice: ExplorationChoice,
): Promise<Result<ExplorationCreation, ExplorationCreationRefusal>> {
  const read = await readCheckedResponse(tx, choice.pastedText);
  if (!read.ok) {
    return read;
  }
  const created = await createEveryTicked(tx, read.value.types, choice.ticked);
  if (!created.ok) {
    return created;
  }
  const { target } = choice;
  const edited = target === null ? ok(null) : await copyPicks(tx, read.value.types, target);
  if (!edited.ok) {
    return edited;
  }
  await discardDraft(tx, { kind: 'exploration_response', eventTypeId: target?.typeId ?? null });
  return ok({ created: created.value, target: edited.value });
}
