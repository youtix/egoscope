// The possible duplicates between types of CL-TAX-05: a deterministic hint, compared by
// the words of names and definitions. Apart from queries.ts only to keep each file within
// the size limits.
import 'server-only';

import { allTypes } from './queries';

import type { EventTypeStatus, NamedType, Reader } from './queries';

// The words a name or a definition loses before it is compared (CL-TAX-05).
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'and',
  'or',
  'his',
  'her',
  'its',
  'their',
  'player',
  'players',
]);
// The share of words two names or two definitions share from which they are close.
const CLOSE_SHARE = 0.5;
const DIACRITIC = /\p{M}/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/u;
// A word of two characters or more, counted in code points: one-letter words are dropped.
const TWO_CHARACTERS = /^.{2}/su;

/** What two texts are compared on: a name, and a definition that may be missing. */
export type DuplicateCandidate = Readonly<{ name: string; definition: string | null }>;

/** Which of the two texts of a pair are close: `'names' | 'definitions' | 'both'`. */
export type Closeness = 'names' | 'definitions' | 'both';

/**
 * The words of a text as CL-TAX-05 compares them: Unicode NFKD, diacritics removed,
 * lowercase, split on every character that is not a letter or a digit, one-letter words and
 * the listed stop words dropped.
 */
function wordsOf(text: string | null): ReadonlySet<string> {
  const words = (text ?? '')
    .normalize('NFKD')
    .replaceAll(DIACRITIC, '')
    .toLowerCase()
    .split(NOT_LETTER_OR_DIGIT);
  return new Set(words.filter((word) => TWO_CHARACTERS.test(word) && !STOP_WORDS.has(word)));
}

function sharedCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  return [...left].filter((word) => right.has(word)).length;
}

/**
 * Whether two names are close: one word set contains the other, or they share at least
 * half of the words of the smaller one, which containment satisfies; an empty set is close
 * to none.
 */
function areNamesClose(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const smaller = Math.min(left.size, right.size);
  return smaller > 0 && sharedCount(left, right) >= smaller * CLOSE_SHARE;
}

/** Whether two definitions are close: their shared words are at least half of their union. */
function areDefinitionsClose(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const shared = sharedCount(left, right);
  const union = left.size + right.size - shared;
  return union > 0 && shared >= union * CLOSE_SHARE;
}

/**
 * Whether two types are possible duplicates, and on what (CL-TAX-05, TAX-17, TAX-18):
 * `'names'`, `'definitions'` or `'both'` when their names or their definitions are close,
 * null otherwise. A name or definition whose words are all dropped, a missing definition
 * included, is close to none.
 */
export function duplicateCloseness(
  left: DuplicateCandidate,
  right: DuplicateCandidate,
): Closeness | null {
  const areNames = areNamesClose(wordsOf(left.name), wordsOf(right.name));
  const areDefinitions = areDefinitionsClose(wordsOf(left.definition), wordsOf(right.definition));
  if (areNames && areDefinitions) {
    return 'both';
  }
  if (areNames) {
    return 'names';
  }
  return areDefinitions ? 'definitions' : null;
}

/**
 * A type close to a compared one: `type` (`id`, `name`, `definition` and `status`, so that
 * both texts show side by side) and `closeness`.
 */
export type PossibleDuplicate = Readonly<{
  type: NamedType & Readonly<{ status: EventTypeStatus }>;
  closeness: Closeness;
}>;

/**
 * The types, in any state and in the order of the taxonomy, that are possible duplicates
 * of a type of that name and definition, each saying whether the names, the definitions or
 * both are close (CL-TAX-05, TAX-17, TAX-18).
 */
export async function possibleDuplicates(
  db: Reader,
  name: string,
  definition: string | null,
): Promise<readonly PossibleDuplicate[]> {
  const compared = { name, definition };
  const types = await allTypes(db);
  const duplicates: PossibleDuplicate[] = [];
  for (const type of types) {
    const closeness = duplicateCloseness(compared, type);
    if (closeness === null) {
      continue;
    }
    const { id, status } = type;
    duplicates.push({
      type: { id, name: type.name, definition: type.definition, status },
      closeness,
    });
  }
  return duplicates;
}
