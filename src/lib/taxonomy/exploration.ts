// The exploration round trip of TAX-16 and TAX-17, its prompt and its preview: the
// prompt, written on request and never stored, and the preview of a pasted response,
// which creates nothing. exploration-creation.ts, beside it for the size limits, creates
// the proposals. Writing the prompt and reading the response are the pure core's
// (ai-exchange/exploration/).
import 'server-only';

import {
  buildExplorationPrompt,
  checkSources,
  parseExplorationResponse,
  readDate,
} from '@/lib/ai-exchange';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { cleanLink } from '@/lib/stats-engine';
import { now } from '@/lib/time';

import { duplicateCloseness } from './duplicates';
import { allTypes } from './queries';

import type { Closeness } from './duplicates';
import type { EventTypeStatus, NamedType, Reader } from './queries';
import type { EventTypeRow } from './types';
import type {
  ExplorationResponseError,
  ExplorationTarget,
  ExplorationTypeEntry,
  ExplorationWarning,
  ProposedIllustrationSource,
  ProposedType,
  ResearchSource,
  SourceChecks,
} from '@/lib/ai-exchange';
import type { NoLongerExists } from '@/lib/db';
import type { Result } from '@/lib/result';

/**
 * What a targeted exploration deepens (TAX-16): an idea that the owner describes in one
 * sentence, or a proposed type, by its identifier.
 */
export type ExplorationAim =
  Readonly<{ kind: 'idea'; idea: string }> | Readonly<{ kind: 'proposal'; typeId: string }>;

/** The prompt asked for: its mode, `general`, or `targeted` with its aim (TAX-16, glossary `ExplorationMode`). */
export type ExplorationPromptChoice =
  Readonly<{ mode: 'general' }> | Readonly<{ mode: 'targeted'; aim: ExplorationAim }>;

/** Why no prompt is written: a blank idea, or a proposal to deepen that is gone or no longer proposed. */
export type ExplorationPromptRefusal =
  | Readonly<{ kind: 'idea_required' }>
  | NoLongerExists
  | Readonly<{ kind: 'not_proposed'; status: EventTypeStatus }>;

/**
 * A type close to a proposed type of the preview (CL-TAX-05): an existing type, whatever
 * its status, or another proposed type of the same response, by its 1-based position,
 * each with its name and definition to show beside those of the proposed type, and
 * whether the names, the definitions or both are close.
 */
export type ExplorationDuplicate = Readonly<{
  closeness: Closeness;
  other:
    | (NamedType & Readonly<{ kind: 'type'; status: EventTypeStatus }>)
    | Readonly<{
        kind: 'proposed_type';
        position: number;
        name: string | undefined;
        definition: string | undefined;
      }>;
}>;

/**
 * A proposed type as the preview shows it (TAX-17): as read, with its missing elements
 * and its citation markers, which the source checks do not repeat (CL-IMP-07); its
 * possible duplicates; and its illustration sources through the checks of IMP-14, the
 * kept ones and the warnings, each dropped one's among them (CL-TAX-04).
 */
export type PreviewedType = Readonly<{
  proposedType: ProposedType;
  possibleDuplicates: readonly ExplorationDuplicate[];
  illustrationSources: SourceChecks;
}>;

/** The exploration preview: the proposed types in the order of the response, and its warnings (TAX-17). */
export type ExplorationPreview = Readonly<{
  proposedTypes: readonly PreviewedType[];
  warnings: readonly ExplorationWarning[];
}>;

/** A proposed type as read, with its illustration sources through the checks of IMP-14. */
export type CheckedType = Readonly<{ type: ProposedType; sources: SourceChecks }>;

/** A response as read, each proposed type with its checked sources, and its warnings. */
type CheckedResponse = Readonly<{
  types: readonly CheckedType[];
  warnings: readonly ExplorationWarning[];
}>;

const entryOf = (type: EventTypeRow): ExplorationTypeEntry => ({
  name: type.name,
  definition: type.definition,
});

function entriesOf(types: readonly EventTypeRow[], status: EventTypeStatus) {
  return types.filter((type) => type.status === status).map((type) => entryOf(type));
}

/** The entry of a rejected type, with its reason, or null for a type with none. */
function rejectedEntryOf(type: EventTypeRow) {
  const { rejectionReason } = type;
  return rejectionReason === null ? null : { ...entryOf(type), rejectionReason };
}

/**
 * The lists of the prompt (TAX-16, CL-TAX-10): the validated types, then the
 * do-not-repropose list by status, the calendar-derived types among them like any other.
 * A rejected type, the only one with a rejection reason (its row check), comes with that
 * closed-list reason, never the owner's comment.
 */
function existingLists(types: readonly EventTypeRow[]) {
  return {
    validatedTypes: entriesOf(types, 'validated'),
    pendingProposals: entriesOf(types, 'proposed'),
    rejectedTypes: types.map((type) => rejectedEntryOf(type)).filter((entry) => entry !== null),
    withdrawnTypes: entriesOf(types, 'withdrawn'),
  };
}

/** What a targeted prompt deepens, or why it cannot. */
function targetOf(
  aim: ExplorationAim,
  types: readonly EventTypeRow[],
): Result<ExplorationTarget, ExplorationPromptRefusal> {
  if (aim.kind === 'idea') {
    return aim.idea.trim() === '' ? err({ kind: 'idea_required' }) : ok(aim);
  }
  const type = types.find((candidate) => candidate.id === aim.typeId);
  if (type === undefined) {
    return err({ kind: 'no_longer_exists' });
  }
  if (type.status !== 'proposed') {
    return err({ kind: 'not_proposed', status: type.status });
  }
  // Only a detection proposal, of Lot 2, has article references.
  return ok({ kind: 'proposal', proposal: entryOf(type), articleReferences: [] });
}

/**
 * Writes the exploration prompt that the owner asks for (TAX-16, CL-TAX-03), and stores
 * nothing: general, or targeted on an idea, trimmed, or on a proposed type by its current
 * name and definition. It names the validated types by name and definition, then the
 * do-not-repropose list: the pending proposals, the targeted one included, the rejected
 * types with their closed-list reason and never the owner's comment, and the withdrawn
 * types; the calendar-derived types take part like any other (CL-TAX-10, CA-TAX-06), so
 * the two seeded ones are in that list at a first start. Refused for a blank idea, and
 * for a proposal that is gone or no longer proposed.
 */
export async function generateExplorationPrompt(
  db: Reader,
  choice: ExplorationPromptChoice,
): Promise<Result<string, ExplorationPromptRefusal>> {
  const types = await allTypes(db);
  const lists = existingLists(types);
  if (choice.mode === 'general') {
    return ok(buildExplorationPrompt({ mode: 'general', ...lists }));
  }
  const target = targetOf(choice.aim, types);
  return target.ok
    ? ok(buildExplorationPrompt({ mode: 'targeted', target: target.value, ...lists }))
    : target;
}

const researchSource = (source: ProposedIllustrationSource): ResearchSource => ({
  url: source.url,
  outlet: source.outlet,
  title: source.title,
  publicationDate: readDate(source.publicationDate),
});

/**
 * Reads a pasted exploration response (TAX-17, CL-TAX-04), bounded by
 * `imports.maxPastedTextMegabytes` (IMP-02), each proposed type's illustration sources
 * through the source checks of IMP-14, against `imports.disallowedSourceDomains` and the
 * instant of the reading; refused whole as `parseExplorationResponse` refuses it.
 */
export async function readCheckedResponse(
  db: Reader,
  pastedText: string,
): Promise<Result<CheckedResponse, ExplorationResponseError>> {
  const maxPastedTextMegabytes = await getParam(db, 'imports.maxPastedTextMegabytes');
  const read = parseExplorationResponse(pastedText, { maxPastedTextMegabytes });
  if (!read.ok) {
    return err(read.error);
  }
  const disallowedDomains = await getParam(db, 'imports.disallowedSourceDomains');
  const rules = { cleanLink, disallowedDomains, checkedAt: now() };
  const types = read.response.proposedTypes.map((type) => {
    const sources = (type.illustrationSources ?? []).map((source) => researchSource(source));
    return { type, sources: checkSources(sources, rules) };
  });
  return ok({ types, warnings: read.response.warnings });
}

/** The two texts of a proposed type that CL-TAX-05 compares, a missing one being close to none. */
const comparedOf = (type: ProposedType) => ({
  name: type.name ?? '',
  definition: type.definition ?? null,
});

/** The possible duplicates of `type`: the existing types first, then the others of its response. */
function duplicatesOf(
  type: ProposedType,
  others: readonly Readonly<{ position: number; type: ProposedType }>[],
  existing: readonly EventTypeRow[],
): readonly ExplorationDuplicate[] {
  const compared = comparedOf(type);
  const ofTypes = existing.map(({ id, name, definition, status }) => {
    const closeness = duplicateCloseness(compared, { name, definition });
    const other = { kind: 'type', id, name, definition, status } as const;
    return closeness === null ? null : { closeness, other };
  });
  const ofResponse = others.map(({ position, type: otherType }) => {
    const closeness = duplicateCloseness(compared, comparedOf(otherType));
    const { name, definition } = otherType;
    const other = { kind: 'proposed_type', position, name, definition } as const;
    return closeness === null ? null : { closeness, other };
  });
  return [...ofTypes, ...ofResponse].filter((duplicate) => duplicate !== null);
}

/**
 * Reads a pasted exploration response for its preview (TAX-17, CL-TAX-04), and creates
 * nothing: the response as `parseExplorationResponse` reads it, refused whole as it
 * refuses it, a research result included (CA-TAX-17), each proposed type with its missing
 * elements; the possible duplicates of each (CL-TAX-05), by close names or close
 * definitions, among every type whatever its status, in the order of the taxonomy, then
 * among the other proposed types of the response; and its illustration sources through
 * the source checks of IMP-14, a failing one dropped with a warning (CL-TAX-04), against
 * the disallowed domains of `imports.disallowedSourceDomains`.
 */
export async function previewExplorationResponse(
  db: Reader,
  pastedText: string,
): Promise<Result<ExplorationPreview, ExplorationResponseError>> {
  const read = await readCheckedResponse(db, pastedText);
  if (!read.ok) {
    return read;
  }
  const existing = await allTypes(db);
  const positioned = read.value.types.map(({ type }, index) => ({ position: index + 1, type }));
  const proposedTypes = read.value.types.map(({ type, sources }, index) => {
    const others = positioned.filter(({ position }) => position !== index + 1);
    const possibleDuplicates = duplicatesOf(type, others, existing);
    return { proposedType: type, possibleDuplicates, illustrationSources: sources };
  });
  return ok({ proposedTypes, warnings: read.value.warnings });
}
