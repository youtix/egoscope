import 'server-only';

import { asc, eq, inArray, sql } from 'drizzle-orm';

import { eventTypes, eventTypeStatusChanges, typeOccurrences } from '@/lib/db';
import { record } from '@/lib/journal';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { createProposal } from './proposals';
import { instant } from './queries';

import type { InvalidProposalFields, ProposalSheet } from './proposals';
import type { EventTypeStatus, Reader } from './queries';
import type { EventTypeRow, TypeOccurrenceRow } from './types';
import type { NoLongerExists, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/**
 * The reference of an article as an occurrence copies it, never its text, so that it
 * outlives the article's purge (TAX-18, DET-34, DSN-09): its link, its outlet and its
 * title as published, which an article may lack, and its retained publication instant
 * with the precision of that instant (COL-20).
 */
export type ArticleReference = Readonly<{
  url: string;
  outlet: string | null;
  title: string | null;
  publishedAt: EpochMs;
  publicationPrecision: TypeOccurrenceRow['articlePublicationPrecision'];
}>;

/**
 * A fact that detection hands over (TAX-18, DET-34): the followed player it touches, the
 * article it comes from, and the model's justification, held to the wording rules of
 * file 13 or replaced by « texte non conservé » (CL-DET-18, CL-DET-19).
 */
export type DetectedFact = Readonly<{
  playerId: string;
  article: ArticleReference;
  justification: string;
}>;

/** A new-type proposal as detection suggests it, with the fact it was born from (TAX-18, DET-34). */
export type DetectionProposal = Readonly<{
  name: string;
  definition: string;
  fact: DetectedFact;
}>;

/**
 * What became of a fact that detection handed over: the type it now belongs to, and
 * whether that type is a new proposal, on which alone detection emits the
 * `type_proposal_new` fact (TAX-18, TEL-14).
 */
export type ReceivedFact = Readonly<{ typeId: string; created: boolean }>;

/**
 * Why a type cannot take an occurrence (TAX-18, CL-TAX-21): it is gone, it is validated
 * (no entry of the do-not-repropose list), or it is derived from the calendar, whose
 * facts give no occurrence whatever its state.
 */
export type EntryRefusal =
  | NoLongerExists
  | Readonly<{ kind: 'not_an_entry'; status: EventTypeStatus }>
  | Readonly<{ kind: 'handled_by_calendar' }>;

/** Why a proposal cannot be attached as an occurrence of another entry (TAX-18, H-TAX-12). */
export type AttachRefusal =
  | NoLongerExists
  | Readonly<{ kind: 'not_proposed'; status: EventTypeStatus }>
  | Readonly<{ kind: 'not_from_detection' }>
  | Readonly<{ kind: 'same_type' }>
  | Readonly<{ kind: 'invalid_entry'; refusal: EntryRefusal }>;

/** Why an occurrence cannot be detached into a distinct proposal (TAX-18, H-TAX-12). */
export type DetachRefusal =
  | NoLongerExists
  // The fact that created its proposal is that proposal, not an occurrence attached to it.
  | Readonly<{ kind: 'originating_fact' }>
  | InvalidProposalFields;

const NO_LONGER_EXISTS = { kind: 'no_longer_exists' } as const;

/** The type `typeId`, locked until the end of the transaction, if it exists. */
async function lockedType(tx: Transaction, typeId: string): Promise<EventTypeRow | undefined> {
  const [type] = await tx.select().from(eventTypes).where(eq(eventTypes.id, typeId)).for('update');
  return type;
}

/** Why `type` takes no occurrence, if it does not (TAX-18, CL-TAX-21). */
function entryRefusal(type: EventTypeRow | undefined): EntryRefusal | undefined {
  if (type === undefined) {
    return NO_LONGER_EXISTS;
  }
  if (type.calendarDerivation !== null) {
    return { kind: 'handled_by_calendar' };
  }
  return type.status === 'validated' ? { kind: 'not_an_entry', status: type.status } : undefined;
}

/** The columns of an occurrence of `typeId` that copies `fact`, recorded now. */
function occurrenceColumns(typeId: string, fact: DetectedFact, isOriginatingFact: boolean) {
  const { article } = fact;
  return {
    eventTypeId: typeId,
    playerId: fact.playerId,
    recordedAt: new Date(now()),
    isOriginatingFact,
    justification: fact.justification,
    articleUrl: article.url,
    articleOutlet: article.outlet,
    articleTitle: article.title,
    articlePublishedAt: new Date(article.publishedAt),
    articlePublicationPrecision: article.publicationPrecision,
  };
}

/** Sets the reason why no validated type fits on the new detection proposal `typeId` (CL-DET-19). */
async function setNoFitReason(
  tx: Transaction,
  typeId: string,
  reason: string | null,
): Promise<EventTypeRow> {
  const [proposal] = await tx
    .update(eventTypes)
    .set({ noFitReason: reason })
    .where(eq(eventTypes.id, typeId))
    .returning();
  if (proposal === undefined) {
    throw new Error(`The proposal ${typeId} created in this transaction is gone.`);
  }
  return proposal;
}

/**
 * Creates, in the caller's transaction `tx`, the detection proposal that `proposal`
 * suggests (TAX-18, DET-34, CL-DET-19, CL-TEL-10): proposed, of origin detection, dated
 * now, the transmission instant, with the suggested name and definition, no « sujet
 * intime » mark, which only the owner sets, and the fact's justification as the reason
 * why no validated type fits; and its originating occurrence, which copies the fact's
 * player, article reference and justification. Its identifier is allocated, and the save
 * journaled, by `createProposal`. Reports `created`, on which detection emits the one
 * `type_proposal_new` fact in the same transaction (TEL-14); taxonomy emits none. Refused
 * as `createProposal` refuses a sheet.
 */
export async function receiveDetectionProposal(
  tx: Transaction,
  proposal: DetectionProposal,
): Promise<Result<ReceivedFact, InvalidProposalFields>> {
  const created = await createProposal(tx, 'detection', {
    name: proposal.name,
    definition: proposal.definition,
  });
  if (!created.ok) {
    return created;
  }
  const typeId = created.value.id;
  await setNoFitReason(tx, typeId, proposal.fact.justification);
  await tx.insert(typeOccurrences).values(occurrenceColumns(typeId, proposal.fact, true));
  return ok({ typeId, created: true });
}

/**
 * Adds `fact` as an occurrence of the entry `entryId` of the do-not-repropose list, a
 * pending proposal, a rejected or a withdrawn type, in the caller's transaction `tx`,
 * which the classifier matched (TAX-18, CA-TAX-09, DET-14, DET-34, CL-DET-19): no
 * proposal is created and `created` is false, so no fact follows; the type's occurrence
 * count grows by one, and the occurrence keeps its justification. Refused for a type
 * that is gone, a validated one, and a calendar-derived one, whatever its state
 * (CL-TAX-21). Journaled by the detection pass that counts the occurrences it adds (TRV-41).
 */
export async function addOccurrence(
  tx: Transaction,
  entryId: string,
  fact: DetectedFact,
): Promise<Result<ReceivedFact, EntryRefusal>> {
  const refusal = entryRefusal(await lockedType(tx, entryId));
  if (refusal !== undefined) {
    return err(refusal);
  }
  await tx.insert(typeOccurrences).values(occurrenceColumns(entryId, fact, false));
  return ok({ typeId: entryId, created: false });
}

/** Why the detection proposal `proposal` cannot be attached to `entry`, if it cannot. */
function attachRefusal(
  proposal: EventTypeRow | undefined,
  entry: EventTypeRow | undefined,
): AttachRefusal | undefined {
  if (proposal === undefined) {
    return NO_LONGER_EXISTS;
  }
  if (proposal.status !== 'proposed') {
    return { kind: 'not_proposed', status: proposal.status };
  }
  if (proposal.origin !== 'detection') {
    return { kind: 'not_from_detection' };
  }
  if (proposal.id === entry?.id) {
    return { kind: 'same_type' };
  }
  const refusal = entryRefusal(entry);
  return refusal === undefined ? undefined : { kind: 'invalid_entry', refusal };
}

/** Rejects the proposal `typeId` as a duplicate of an existing type, with its dated transition (TAX-13). */
async function rejectAsDuplicate(tx: Transaction, typeId: string): Promise<void> {
  const changedAt = new Date(now());
  await tx
    .update(eventTypes)
    .set({
      status: 'rejected',
      rejectionReason: 'duplicate_of_existing_type',
      rowVersion: sql`${eventTypes.rowVersion} + 1`,
    })
    .where(eq(eventTypes.id, typeId));
  await tx
    .insert(eventTypeStatusChanges)
    .values({ eventTypeId: typeId, changedAt, fromStatus: 'proposed', toStatus: 'rejected' });
  await record(tx, { messageKey: 'type_rejected', eventTypeId: typeId });
}

/**
 * Attaches the pending detection proposal `proposalId` as an occurrence of the entry
 * `entryId`, in the caller's transaction `tx` (TAX-18, H-TAX-12, TAX-02, TAX-13): its
 * occurrences, the originating one included, move to that entry as ordinary occurrences,
 * and it is rejected as a duplicate of an existing type, with its dated transition, so
 * that its identifier stays taken; the rejection is journaled. The composed action then
 * moves its facts on the detection side. Refused when the proposal is gone, is no longer
 * proposed or does not come from detection, when both are the same type, and when the
 * entry takes no occurrence. Returns the number of occurrences moved.
 */
export async function attachAsOccurrence(
  tx: Transaction,
  proposalId: string,
  entryId: string,
): Promise<Result<number, AttachRefusal>> {
  const proposal = await lockedType(tx, proposalId);
  const refusal = attachRefusal(proposal, await lockedType(tx, entryId));
  if (refusal !== undefined) {
    return err(refusal);
  }
  const moved = await tx
    .update(typeOccurrences)
    .set({ eventTypeId: entryId, isOriginatingFact: false })
    .where(eq(typeOccurrences.eventTypeId, proposalId))
    .returning({ id: typeOccurrences.id });
  await rejectAsDuplicate(tx, proposalId);
  return ok(moved.length);
}

/**
 * Detaches the occurrence `occurrenceId`, wrongly attached, into a distinct proposal of
 * origin detection with the owner's `sheet`, in the caller's transaction `tx` (TAX-18,
 * H-TAX-12, CL-DET-19): created and journaled by `createProposal`, it takes the
 * occurrence's justification as the reason why no validated type fits, and the
 * occurrence moves to it as its originating fact, leaving the occurrence count of its
 * former type one lower. Refused when the occurrence is gone, when it is the fact that
 * created its proposal, and as `createProposal` refuses a sheet.
 */
export async function detachOccurrence(
  tx: Transaction,
  occurrenceId: number,
  sheet: ProposalSheet,
): Promise<Result<EventTypeRow, DetachRefusal>> {
  const [occurrence] = await tx
    .select()
    .from(typeOccurrences)
    .where(eq(typeOccurrences.id, occurrenceId))
    .for('update');
  if (occurrence === undefined) {
    return err(NO_LONGER_EXISTS);
  }
  if (occurrence.isOriginatingFact) {
    return err({ kind: 'originating_fact' });
  }
  const created = await createProposal(tx, 'detection', sheet);
  if (!created.ok) {
    return created;
  }
  const proposal = await setNoFitReason(tx, created.value.id, occurrence.justification);
  await tx
    .update(typeOccurrences)
    .set({ eventTypeId: proposal.id, isOriginatingFact: true })
    .where(eq(typeOccurrences.id, occurrenceId));
  return ok(proposal);
}

/**
 * Deletes, in the caller's transaction `tx`, every occurrence that copied one of
 * `articleLinks`, the links of the articles that the withdrawal of an event, or its
 * erasure by requalification or split, erases (an article attached to that event and to
 * no other): DSN-34 prevails there over DSN-09, since such a link would designate the
 * withdrawn event (COL-37, CL-JRN-01). Detection's eraser calls it before collection
 * erases those articles; the withdrawal's own entry journals it, and no entry of its own
 * keeps a trace. Returns the number of occurrences deleted.
 */
export async function eraseOccurrencesOf(
  tx: Transaction,
  articleLinks: readonly string[],
): Promise<number> {
  const erased = await tx
    .delete(typeOccurrences)
    .where(inArray(typeOccurrences.articleUrl, [...articleLinks]))
    .returning({ id: typeOccurrences.id });
  return erased.length;
}

/**
 * The references of the articles that gave rise to the type `typeId` and to its
 * occurrences, each once, by publication then by link, for the targeted exploration
 * prompt (TAX-16, TAX-18, DSN-09): link, outlet, title and publication instant with its
 * precision, copied by the occurrences, never a text; they outlive the article's purge.
 */
export async function proposalArticleReferences(
  db: Reader,
  typeId: string,
): Promise<readonly ArticleReference[]> {
  const rows = await db
    .selectDistinct({
      url: typeOccurrences.articleUrl,
      outlet: typeOccurrences.articleOutlet,
      title: typeOccurrences.articleTitle,
      publishedAt: typeOccurrences.articlePublishedAt,
      publicationPrecision: typeOccurrences.articlePublicationPrecision,
    })
    .from(typeOccurrences)
    .where(eq(typeOccurrences.eventTypeId, typeId))
    .orderBy(asc(typeOccurrences.articlePublishedAt), asc(typeOccurrences.articleUrl));
  return rows.map((row) => ({ ...row, publishedAt: instant(row.publishedAt) }));
}
