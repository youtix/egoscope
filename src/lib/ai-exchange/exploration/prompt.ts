// The exploration prompt (TAX-16), in English and asking for an answer in English
// (CL-TAX-03): its fixed blocks; the existing types that the taxonomy gathers, each
// named by its name and definition, and a rejected type by its rejection reason too,
// never the owner's comment (CL-TAX-10); and in targeted mode the idea or the proposal
// to deepen, with the references of the articles behind a detection proposal, never
// their text. It asks for the exploration response of CL-TAX-04, with the keys of
// glossary section 6.2.
import { EXPLORATION_FORMAT, EXPLORATION_FORMAT_VERSION } from './format';

/** The closed list of rejection reasons (TAX-13, H-TAX-04), in the order of glossary section 4.1. */
export type TypeRejectionReason =
  'not_clean' | 'not_datable' | 'duplicate_of_existing_type' | 'out_of_scope' | 'other';

/**
 * An existing type as the prompt names it: its name and its definition, which a
 * proposal may still lack (TAX-16, CL-TAX-10).
 */
export type ExplorationTypeEntry = Readonly<{ name: string; definition: string | null }>;

/** A rejected type, with its rejection reason and never the owner's comment (CL-TAX-10). */
export type ExplorationRejectedType = ExplorationTypeEntry &
  Readonly<{ rejectionReason: TypeRejectionReason }>;

/**
 * The reference of an article that gave rise to a detection proposal, never its text
 * (TAX-16, TAX-18): its link; its outlet and its title as published, which an article
 * may lack; and its publication date, written `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM±HH:MM`.
 */
export type ExplorationArticleReference = Readonly<{
  url: string;
  outlet: string | null;
  title: string | null;
  publicationDate: string;
}>;

/**
 * What a targeted exploration deepens (TAX-16): an idea that the owner describes in one
 * sentence, or a pending proposal with the references of the articles that gave rise to
 * it, which only a detection proposal has.
 */
export type ExplorationTarget =
  | Readonly<{ kind: 'idea'; idea: string }>
  | Readonly<{
      kind: 'proposal';
      proposal: ExplorationTypeEntry;
      articleReferences: readonly ExplorationArticleReference[];
    }>;

/**
 * What the exploration prompt is built from (TAX-16): its mode, `general`, or
 * `targeted` with its target (glossary `ExplorationMode`); the validated types; and the
 * do-not-repropose list, made of the pending proposals, the one a targeted exploration
 * deepens included, the rejected types and the withdrawn types (CL-TAX-10). Each list
 * is written in the order given.
 */
export type ExplorationPromptInput = Readonly<{
  validatedTypes: readonly ExplorationTypeEntry[];
  pendingProposals: readonly ExplorationTypeEntry[];
  rejectedTypes: readonly ExplorationRejectedType[];
  withdrawnTypes: readonly ExplorationTypeEntry[];
}> &
  (Readonly<{ mode: 'general' }> | Readonly<{ mode: 'targeted'; target: ExplorationTarget }>);

const HEADER = `DEEP RESEARCH — EVENT TYPES THAT MAY AFFECT AN NBA PLAYER'S EGO
Request issued by Egoscope, a personal app.`;

const GOAL = `1. GOAL
Propose types of public, individual and datable events that may affect an NBA player's ego. For each event of such a type, the app then measures the effect on the player's individual performance in the next game he plays.`;

// The last sentences of the goal, which say the mode and what a targeted exploration deepens.
const GENERAL_MODE =
  'This exploration is general: look for new types, other than those of point 5.';
const IDEA_MODE =
  'This exploration is targeted: deepen the idea below rather than look for other types.';
const PROPOSAL_MODE =
  'This exploration is targeted: deepen the proposal below rather than look for other types; it is the one type of point 5 that you may propose again.';
const ARTICLES = 'Articles that gave rise to this proposal, given by reference only:';

// TAX-04, TAX-05 and TAX-07, with the neighboring types of TAX-06.
const CLEAN_AND_DATABLE = `2. CLEAN AND DATABLE TYPES
A type is clean when:
- it is recognized by a public, observable fact, without assuming the player's state of mind: the app does not measure ego, it finds facts that may affect it;
- its criteria allow a yes-or-no decision on reading an article, so that the app's automatic classification and its user file the same article under the same type;
- the fact targets one player by name, not a team;
- no fact can belong both to it and to another validated type: when two types are neighbors, the exclusion criteria of each say which one prevails.
A type is datable when its dating rule gives each event a single reference date, the moment the fact became public, established by a dated press source. The rule places the event before or after the tip-off of the measured game, the first NBA game the player plays after the event became public; for a fact that unfolds over time, it names the moment that counts, such as the first publication by a national outlet. A type whose events cannot be dated at least to the day cannot be validated.
No criterion may depend on what happened in the measured game: neither the player's performance, nor his response to criticism, nor the result of the game. A type defined by its outcome would keep only feel-good stories.`;

// D-10, H-11 and DSN-01 in the English product (CL-TAX-03), with the address that the
// source checks of IMP-14 ask of an illustration source (CL-TAX-04).
const SOURCES = `3. SOURCES
Only public, dated press articles, in English or in French: sports press, general press, news archives. No social networks, forums, collaborative encyclopedias, or videos without an article. Give the exact address of each article, never that of a home page or a search page. Never invent a fact, a date, an address, a title or an outlet, and cite only articles whose existence you have checked.`;

// TAX-09, with no word of the banned vocabulary (glossary section 8.2).
const EXCLUSIONS = `4. EXCLUSIONS
No type may be about:
- a fact that targets only a team;
- a fact about the player's private life or health;
- a fact specific to another sport;
- anything to do with putting money on the outcome of games or performances.`;

// The elements of TAX-16 with the invitation of D-06 and the risk of TAX-08.
const WHAT_TO_GIVE = `6. WHAT TO GIVE FOR EACH TYPE
For each type you propose, give its name; its definition; its inclusion criteria; its exclusion criteria, naming the neighboring type that prevails, if any; its dating rule, which says whether its events are known in advance; a generic example that names no real person, written with player A, team X and a national outlet; its documentation difficulty; its possible overlaps with the types of point 5; and its illustration sources, public and dated articles that report real events of the type. Write short sentences, in English, that an AI can apply without interpretation.
The documentation difficulty, easy, medium or hard, says how easily a search of dated press, archives included, finds every event of the type. Also propose types whose events are harder to document, provided they are clean and datable, and flag them by their difficulty: for such a type, a search mostly finds the events that people remember, often because a striking game followed, which threatens a complete count.`;

// The exploration response of CL-TAX-04, whose sources are those of the research result.
const ANSWER_FORMAT = `7. ANSWER FORMAT
Your answer consists only of one valid JSON object, written in English: no text before or after it, no formatting tags, no footnote calls or citation markers. If your tool still adds a report, the complete JSON must appear in one piece at the very end. Expected structure, where each value describes what to put there:
{
  "format": "${EXPLORATION_FORMAT}",
  "format_version": "${EXPLORATION_FORMAT_VERSION}",
  "proposed_types": [
    {
      "name": "short name of the type",
      "definition": "what the type covers, in short sentences",
      "inclusion_criteria": "the criteria that a fact must meet, each decided by yes or no",
      "exclusion_criteria": "the facts left out, each with the neighboring type that prevails, if any",
      "dating_rule": "how each event gets its single reference date",
      "known_in_advance": false,
      "generic_example": "an example with player A, team X and a national outlet",
      "documentation_difficulty": "easy, medium or hard",
      "possible_overlaps": ["one sentence per possible overlap with a type of point 5"],
      "illustration_sources": [
        {
          "url": "full address of the article, starting with https:// or http://",
          "outlet": "name of the outlet",
          "title": "exact title of the article, in its own language",
          "publication_date": "YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known"
        }
      ]
    }
  ]
}
Format rules: give each type a "name", and every other element you can establish; omit an element you cannot establish rather than leave it empty, and never write null; "known_in_advance" is true when the day of each event is known beforehand, as for a birthday, and false otherwise; write the enumerated values in lowercase; if no type meets these rules, send back the same object with "proposed_types": []; add no other field; use straight quotation marks only.`;

/** A rejection reason as the prompt writes it: its label of glossary section 4.1, in lowercase. */
function reasonText(reason: TypeRejectionReason): string {
  switch (reason) {
    case 'not_clean': {
      return 'not clean';
    }
    case 'not_datable': {
      return 'not datable';
    }
    case 'duplicate_of_existing_type': {
      return 'duplicate of an existing type';
    }
    case 'out_of_scope': {
      return 'out of scope';
    }
    case 'other': {
      return 'other';
    }
  }
}

/**
 * A type as the prompt names it: its name followed by `mark`, then its definition unless
 * it has none, both trimmed.
 */
function named(type: ExplorationTypeEntry, mark: string): string {
  const name = `${type.name.trim()}${mark}`;
  const definition = type.definition?.trim() ?? '';
  return definition === '' ? name : `${name}: ${definition}`;
}

/** The lines of a list of point 5, one type each. */
function typeLines(types: readonly ExplorationTypeEntry[]): readonly string[] {
  return types.map((type) => `- ${named(type, '')}`);
}

/** The lines of the rejected types, each with its rejection reason (CL-TAX-10). */
function rejectedLines(types: readonly ExplorationRejectedType[]): readonly string[] {
  return types.map((type) => {
    const mark = ` (rejection reason: ${reasonText(type.rejectionReason)})`;
    return `- ${named(type, mark)}`;
  });
}

/** A list of point 5 under its heading, which says "none." of an empty list. */
function list(heading: string, lines: readonly string[]): string {
  return lines.length === 0 ? `${heading}: none.` : [`${heading}:`, ...lines].join('\n');
}

/** Point 5: the validated types, then the do-not-repropose list (TAX-16, CL-TAX-10). */
function existingTypes(input: ExplorationPromptInput): string {
  return [
    '5. EXISTING TYPES',
    list('5.1 Validated types, by name and definition', typeLines(input.validatedTypes)),
    list('5.2 Pending proposals, not to propose again', typeLines(input.pendingProposals)),
    list(
      '5.3 Rejected types, not to propose again, with their rejection reason',
      rejectedLines(input.rejectedTypes),
    ),
    list('5.4 Withdrawn types, not to propose again', typeLines(input.withdrawnTypes)),
  ].join('\n');
}

/** An article by its reference: its link, then its outlet, title and date, those it has. */
function referenceLine(article: ExplorationArticleReference): string {
  const title = article.title === null ? null : `"${article.title}"`;
  const details = [article.outlet, title, article.publicationDate].filter((part) => part !== null);
  return `- ${article.url} (${details.join(', ')})`;
}

/** What a targeted exploration deepens, with the references of its articles (TAX-16). */
function targetLines(target: ExplorationTarget): readonly string[] {
  if (target.kind === 'idea') {
    return [IDEA_MODE, `Idea to deepen: ${target.idea}`];
  }
  const references = target.articleReferences.map((article) => referenceLine(article));
  return [
    PROPOSAL_MODE,
    `Proposal to deepen: ${named(target.proposal, '')}`,
    ...(references.length === 0 ? [] : [ARTICLES, ...references]),
  ];
}

/** Point 1: the goal, then the mode and, in targeted mode, what the exploration deepens. */
function goal(input: ExplorationPromptInput): string {
  const lines = input.mode === 'general' ? [GENERAL_MODE] : targetLines(input.target);
  return [GOAL, ...lines].join('\n');
}

/**
 * Builds the exploration prompt (TAX-16), in English (CL-TAX-03), for the owner to paste
 * into a deep-research AI: the goal; the definitions of clean and datable and the ban on
 * criteria that depend on the measured game; the admitted sources, public and dated
 * English- or French-language press; the exclusions of TAX-09; the validated types, then
 * the do-not-repropose list, a rejected type with its reason only (CL-TAX-10); the
 * elements of each proposed type, with the invitation to propose harder-to-document types
 * flagged by their difficulty (D-06); and the answer skeleton of CL-TAX-04 with its rules.
 * In targeted mode, the goal ends with the idea or the proposal to deepen and the
 * references of its articles, never their text; general mode holds none of these.
 */
export function buildExplorationPrompt(input: ExplorationPromptInput): string {
  return [
    HEADER,
    goal(input),
    CLEAN_AND_DATABLE,
    SOURCES,
    EXCLUSIONS,
    existingTypes(input),
    WHAT_TO_GIVE,
    ANSWER_FORMAT,
  ].join('\n\n');
}
