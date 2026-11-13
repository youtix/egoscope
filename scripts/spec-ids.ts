/**
 * Reads the IDs that the French specifications define, for the traceability check
 * (trace-requirements.ts). A definition is told from a mere cross-reference by where
 * and how the ID is written:
 *
 * - A requirement is defined by a list item that starts with its ID, bold or not,
 *   followed by its lot in brackets: `- **JOU-04** [Lot 1] — …`,
 *   `- **BKT-01 [Lot 1] — Title.** …` or `- STA-11 [Lot 1] — …`, outside the section
 *   « Critères d'acceptation ». Spec file NN defines only IDs of its own prefix
 *   (SPEC_PREFIXES), each once; a suffixed ID such as `TRV-07 bis` is refused.
 * - The acceptance criteria are the top-level items of the level-2 section « Critères
 *   d'acceptation ». A criterion that starts with its ID (`- **CA-COL-03** …`) carries
 *   it; in a section without such IDs, the nth item is `CA-<PREFIX>-nn`, in document
 *   order, and a numbered item must carry its position. Nested (indented) items are
 *   not criteria.
 * - Hypotheses (`H-13`, `H-STA-03`), open questions (`Q-04`, `Q-STA-01`) and journal
 *   decisions (`D-07`, `D-07 bis`) are defined by the list item that starts with their
 *   ID in the file that owns them: the journal docs/90-*.md, or the spec file of their
 *   prefix. Planning rulings (`CL-STA-01`) are defined by the heading that starts with
 *   their ID in docs/engineering/clarifications/. A test may cite any of them, and none
 *   needs one.
 *
 * Fenced code blocks define nothing.
 */

/** A Markdown file of the repository: its repository-relative path and its text. */
export type MarkdownFile = Readonly<{ path: string; text: string }>;

/** A broken rule, and where: `docs/07-statistiques-de-match.md:96`. */
export type Problem = Readonly<{ where: string; problem: string }>;

/** An ID that the specs define, with its spec file and where it is defined. */
export type DefinedId = Readonly<{ id: string; file: string; where: string }>;

type Requirement = DefinedId & Readonly<{ lot: number }>;

/** An acceptance criterion; `text` is its item, without the marker and the ID it carries. */
export type Criterion = DefinedId & Readonly<{ text: string }>;

export type SpecIds = Readonly<{
  requirements: readonly Requirement[];
  criteria: readonly Criterion[];
  /** Hypotheses, open questions, decisions and rulings: citable, never requiring a test. */
  citable: ReadonlySet<string>;
  problems: readonly Problem[];
}>;

/** The prefix of the IDs that each spec file defines, by the number of its file name. */
const SPEC_PREFIXES: ReadonlyMap<string, string> = new Map([
  ['00', 'VUE'],
  ['01', 'JOU'],
  ['02', 'TAX'],
  ['03', 'COL'],
  ['04', 'DET'],
  ['05', 'BKT'],
  ['06', 'IMP'],
  ['07', 'STA'],
  ['08', 'SEN'],
  ['09', 'ALE'],
  ['10', 'SUI'],
  ['11', 'TEL'],
  ['12', 'IHM'],
  ['13', 'DSN'],
  ['14', 'TRV'],
]);

const SPEC_FILE = /^docs\/(?<number>\d{2})-[^/]+\.md$/u;
const JOURNAL_FILE = /^docs\/90-[^/]+\.md$/u;
const CLARIFICATION_FILE = /^docs\/engineering\/clarifications\/[^/]+\.md$/u;
const CRITERIA_HEADING = "Critères d'acceptation";
const SECTION_LEVEL = 2;
const HEADING = /^(?<hashes>#{1,6})\s(?<title>.*)$/u;
const FENCE = /^ {0,3}(?<fence>`{3,}|~{3,})/u;
const ITEM = /^(?<indent>[ \t]*)(?:[-*+]|(?<number>\d+)[.)])[ \t](?<content>.*)$/u;
const ID_AT_START = /^(?:\*\*)?(?<id>[A-Z]+-\d+)/u;
const LOT = /\[Lot (?<lot>\d+)\]/u;
// The first token of an item: its leading bold span, or its first word.
const FIRST_TOKEN = /^(?:\*\*(?<bold>[^*]+)\*\*|(?<word>\S+))/u;
const CRITERION_ID = /^CA-(?<prefix>[A-Z]+)-\d+$/u;
const JOURNAL_ID = /^(?:\*\*)?(?<id>[DHQ]-\d+(?: bis)?)(?![\w-])/u;
const LOCAL_ID = /^(?:\*\*)?(?<id>[HQ]-(?<prefix>[A-Z]+)-\d+)(?![\w-])/u;
const RULING_ID = /^(?:\*\*)?(?<id>CL-[A-Z]+-\d+)(?![\w-])/u;
const POSITION_DIGITS = 2;

type Line = Readonly<{ text: string; number: number }>;
type Heading = Readonly<{ level: number; title: string }>;
/** A list item; `number` is that of a numbered item, undefined for a bullet. */
type Item = Readonly<{
  number: number | undefined;
  nested: boolean;
  content: string;
  where: string;
}>;
/** A spec file being read: its path, and the prefix of the IDs it defines. */
type Spec = Readonly<{ path: string; prefix: string }>;
type Found<T> = Readonly<{ ids: readonly T[]; problems: readonly Problem[] }>;
type SpecFileIds = Readonly<{
  requirements: Found<Requirement>;
  criteria: Found<Criterion>;
  citable: readonly string[];
  problems: readonly Problem[];
}>;

const NOTHING: Found<never> = { ids: [], problems: [] };
const found = <T>(id: T): Found<T> => ({ ids: [id], problems: [] });
const problemAt = (where: string, problem: string): Found<never> => ({
  ids: [],
  problems: [{ where, problem }],
});

/** Says whether the traceability check reads `path`: the specs, the journal, the rulings. */
export function isSpecSource(path: string): boolean {
  return SPEC_FILE.test(path) || CLARIFICATION_FILE.test(path);
}

/** The lines of a Markdown text outside its fenced code blocks, numbered from 1. */
function proseLines(text: string): readonly Line[] {
  const lines: Line[] = [];
  let fence = '';
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const opening = FENCE.exec(line)?.groups?.['fence'] ?? '';
    if (fence === '' && opening !== '') {
      fence = opening;
    } else if (fence !== '' && opening.startsWith(fence)) {
      fence = '';
    } else if (fence === '') {
      lines.push({ text: line, number: index + 1 });
    }
  }
  return lines;
}

/** The list items among `lines`, nested ones included. */
function itemsOf(lines: readonly Line[], path: string): readonly Item[] {
  return lines.flatMap((line) => {
    const groups = ITEM.exec(line.text)?.groups;
    const number = groups?.['number'];
    return groups === undefined
      ? []
      : {
          number: number === undefined ? undefined : Number(number),
          nested: groups['indent'] !== '',
          content: (groups['content'] ?? '').trimStart(),
          where: `${path}:${String(line.number)}`,
        };
  });
}

/** The level and title of a heading line, or undefined for another line. */
function headingOf(line: Line): Heading | undefined {
  const groups = HEADING.exec(line.text)?.groups;
  return groups === undefined
    ? undefined
    : { level: groups['hashes']?.length ?? 0, title: (groups['title'] ?? '').trim() };
}

/** Splits the lines into those of the criteria sections and the others. */
function splitCriteria(
  lines: readonly Line[],
): Readonly<{ criteria: readonly Line[]; others: readonly Line[]; sections: number }> {
  const criteria: Line[] = [];
  const others: Line[] = [];
  let sections = 0;
  let isCriteria = false;
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading !== undefined && heading.level <= SECTION_LEVEL) {
      isCriteria = heading.level === SECTION_LEVEL && heading.title === CRITERIA_HEADING;
      sections += isCriteria ? 1 : 0;
    }
    (isCriteria ? criteria : others).push(line);
  }
  return { criteria, others, sections };
}

/** The requirement that `item` defines, when it starts with an ID followed by its lot. */
function requirementIn(item: Item, spec: Spec): Found<Requirement> {
  const start = ID_AT_START.exec(item.content);
  const id = start?.groups?.['id'];
  const lot = LOT.exec(item.content);
  if (start === null || id === undefined || lot === null) {
    return NOTHING;
  }
  // Between the ID and its lot, bold markers aside, stands nothing, or a suffix.
  const between = item.content.slice(start[0].length, lot.index).replaceAll('**', '');
  const suffix = between.trim();
  if (/\s/u.test(suffix)) {
    return NOTHING;
  }
  if (suffix !== '') {
    return problemAt(
      item.where,
      `"${id}${between.trimEnd()}" is a suffixed requirement ID: an ID is its prefix and a number, which a test title can cite.`,
    );
  }
  if (!id.startsWith(`${spec.prefix}-`)) {
    return problemAt(item.where, `${id} is defined in a spec file of ${spec.prefix} IDs only.`);
  }
  return found({ id, file: spec.path, where: item.where, lot: Number(lot.groups?.['lot']) });
}

/** The first token of an item, and the length of its text, bold markers included. */
function firstToken(item: Item): Readonly<{ token: string; length: number }> {
  const match = FIRST_TOKEN.exec(item.content);
  const token = match?.groups?.['bold'] ?? match?.groups?.['word'] ?? '';
  return { token, length: match?.[0].length ?? 0 };
}

/** Says whether an item starts with a criterion ID, well formed or not. */
const hasCriterionId = (item: Item): boolean => firstToken(item).token.startsWith('CA-');

/** A criterion of a section whose criteria carry their IDs. */
function explicitCriterion(item: Item, spec: Spec): Found<Criterion> {
  if (!hasCriterionId(item)) {
    return problemAt(item.where, 'This criterion has no ID, while the others of its section do.');
  }
  const { token, length } = firstToken(item);
  const prefix = CRITERION_ID.exec(token)?.groups?.['prefix'];
  if (prefix === undefined) {
    return problemAt(item.where, `"${token}" is not a criterion ID: write CA-${spec.prefix}-nn.`);
  }
  if (prefix !== spec.prefix) {
    return problemAt(
      item.where,
      `${token} is defined in a spec file of CA-${spec.prefix} IDs only.`,
    );
  }
  const text = item.content.slice(length).trim();
  return found({ id: token, file: spec.path, where: item.where, text });
}

/** The nth criterion (from 1) of a section whose criteria carry no ID: CA-<PREFIX>-nn. */
function positionalCriterion(item: Item, position: number, spec: Spec): Found<Criterion> {
  const { number } = item;
  if (number !== undefined && number !== position) {
    return problemAt(
      item.where,
      `Criterion ${String(position)} is numbered ${String(number)}: a numbered list must count 1, 2, 3… in order, since its position gives a criterion its ID.`,
    );
  }
  const id = `CA-${spec.prefix}-${String(position).padStart(POSITION_DIGITS, '0')}`;
  return found({ id, file: spec.path, where: item.where, text: item.content });
}

function merge<T>(all: readonly Found<T>[]): Found<T> {
  return { ids: all.flatMap((each) => each.ids), problems: all.flatMap((each) => each.problems) };
}

function readCriteria(lines: readonly Line[], spec: Spec): Found<Criterion> {
  const items = itemsOf(lines, spec.path).filter((item) => !item.nested);
  const isExplicit = items.some((item) => hasCriterionId(item));
  return merge(
    items.map((item, index) =>
      isExplicit ? explicitCriterion(item, spec) : positionalCriterion(item, index + 1, spec),
    ),
  );
}

/** The hypotheses and questions that a spec file defines: those of its own prefix. */
function localIds(lines: readonly Line[], spec: Spec): readonly string[] {
  return itemsOf(lines, spec.path).flatMap((item) => {
    const groups = LOCAL_ID.exec(item.content)?.groups;
    return groups?.['prefix'] === spec.prefix ? (groups['id'] ?? []) : [];
  });
}

function readSpecFile(file: MarkdownFile, spec: Spec): SpecFileIds {
  const { criteria, others, sections } = splitCriteria(proseLines(file.text));
  return {
    requirements: merge(itemsOf(others, spec.path).map((item) => requirementIn(item, spec))),
    criteria: readCriteria(criteria, spec),
    citable: localIds(others, spec),
    problems:
      sections === 1
        ? []
        : [
            {
              where: file.path,
              problem: `A spec file has one level-2 section « ${CRITERIA_HEADING} »; this one has ${String(sections)}.`,
            },
          ],
  };
}

/** The IDs that start the list items of `file`, as `pattern` reads them. */
function itemIds(file: MarkdownFile, pattern: RegExp): readonly string[] {
  return itemsOf(proseLines(file.text), file.path).flatMap(
    (item) => pattern.exec(item.content)?.groups?.['id'] ?? [],
  );
}

/** The IDs that start the headings of `file`, as `pattern` reads them. */
function headingIds(file: MarkdownFile, pattern: RegExp): readonly string[] {
  return proseLines(file.text).flatMap(
    (line) => pattern.exec(headingOf(line)?.title ?? '')?.groups?.['id'] ?? [],
  );
}

/** One problem for each repeat of an ID among `ids`, which `say` words from the first one. */
export function repeats(
  ids: readonly Readonly<{ id: string; where: string }>[],
  say: (id: string, first: string) => string,
): readonly Problem[] {
  const first = new Map<string, string>();
  return ids.flatMap(({ id, where }) => {
    const earlier = first.get(id);
    first.set(id, earlier ?? where);
    return earlier === undefined ? [] : { where, problem: say(id, earlier) };
  });
}

/**
 * Reads the requirements, acceptance criteria and citable IDs that `files` define:
 * the spec files docs/00-*.md to docs/14-*.md, the journal docs/90-*.md and the
 * clarifications. Other files are ignored.
 */
export function readSpecIds(files: readonly MarkdownFile[]): SpecIds {
  const specs = files
    .toSorted((left, right) => left.path.localeCompare(right.path, 'en'))
    .flatMap((file) => {
      const prefix = SPEC_PREFIXES.get(SPEC_FILE.exec(file.path)?.groups?.['number'] ?? '');
      return prefix === undefined ? [] : readSpecFile(file, { path: file.path, prefix });
    });
  const requirements = specs.flatMap((spec) => spec.requirements.ids);
  const criteria = specs.flatMap((spec) => spec.criteria.ids);
  return {
    requirements,
    criteria,
    citable: new Set([
      ...specs.flatMap((spec) => spec.citable),
      ...files
        .filter((file) => JOURNAL_FILE.test(file.path))
        .flatMap((file) => itemIds(file, JOURNAL_ID)),
      ...files
        .filter((file) => CLARIFICATION_FILE.test(file.path))
        .flatMap((file) => headingIds(file, RULING_ID)),
    ]),
    problems: [
      ...specs.flatMap((spec) => [
        ...spec.requirements.problems,
        ...spec.criteria.problems,
        ...spec.problems,
      ]),
      ...repeats(
        [...requirements, ...criteria],
        (id, first) => `${id} is defined twice; the first definition is at ${first}.`,
      ),
    ],
  };
}
