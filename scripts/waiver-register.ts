/**
 * Reads the waiver register, docs/engineering/requirement-waivers.md, for the
 * traceability check (trace-requirements.ts). The register is one Markdown table,
 * `ID | kind | part | reason | manual check or reference`, with one row per entry:
 *
 * - `waiver`: no automated test can or must verify the requirement, so its ID has no
 *   test;
 * - `limit`: tests prove the application's part of the requirement, and the part
 *   that the entry names is checked by hand, as its last column says; the ID keeps
 *   its tests.
 *
 * Every entry gives its reason, a limit names its part and its manual check, and an
 * ID has one entry at most. Whether the ID exists is for trace-rules.ts to say.
 */
import { repeats } from './spec-ids';

import type { Problem } from './spec-ids';

export const REGISTER_PATH = 'docs/engineering/requirement-waivers.md';

/** The kinds of entry, as the `kind` column writes them. */
export type EntryKind = 'waiver' | 'limit';

export type RegisterEntry = Readonly<{
  id: string;
  kind: EntryKind;
  part: string;
  reason: string;
  /** The manual check of a limit, or the reference behind a waiver. */
  check: string;
  where: string;
}>;

export type Register = Readonly<{
  entries: readonly RegisterEntry[];
  problems: readonly Problem[];
}>;

const HEADER = ['ID', 'kind', 'part', 'reason', 'manual check or reference'];
const KINDS: ReadonlySet<string> = new Set<EntryKind>(['waiver', 'limit']);
const TABLE_ROW = /^\s*\|/u;
const SEPARATOR_CELL = /^:?-+:?$/u;
// A pipe that ends a cell: one that no backslash escapes.
const CELL_BOUNDARY = /(?<!\\)\|/u;

const isKind = (kind: string): kind is EntryKind => KINDS.has(kind);

/** The cells of a table row, trimmed, with their escaped pipes restored. */
function cellsOf(row: string): readonly string[] {
  return row
    .trim()
    .replace(/^\|/u, '')
    .replace(/(?<!\\)\|$/u, '')
    .split(CELL_BOUNDARY)
    .map((cell) => cell.trim().replaceAll(String.raw`\|`, '|'));
}

/** What is missing from an entry whose kind is known. */
function gaps(entry: RegisterEntry): readonly string[] {
  const isLimit = entry.kind === 'limit';
  return [
    ...(entry.reason === '' ? [`${entry.id} gives no reason.`] : []),
    ...(isLimit && entry.part === ''
      ? [`${entry.id} is a limit that names no part: a limit names the part checked by hand.`]
      : []),
    ...(isLimit && entry.check === ''
      ? [`${entry.id} is a limit that gives no manual check, such as a script or a guide step.`]
      : []),
  ];
}

function readEntry(cells: readonly string[], where: string): Register {
  if (cells.length !== HEADER.length) {
    const problem = `This row has ${String(cells.length)} cells; the register has ${String(HEADER.length)} columns.`;
    return { entries: [], problems: [{ where, problem }] };
  }
  const [id = '', kind = '', part = '', reason = '', check = ''] = cells;
  if (!isKind(kind)) {
    const problem = `${id} has the unknown kind "${kind}": an entry is a waiver or a limit.`;
    return { entries: [], problems: [{ where, problem }] };
  }
  const entry = { id, kind, part, reason, check, where };
  return { entries: [entry], problems: gaps(entry).map((problem) => ({ where, problem })) };
}

/** Reads the entries of the register whose text is `text`, and what is wrong with them. */
export function readRegister(text: string): Register {
  const lines = text.split(/\r?\n/u);
  const header = lines.findIndex(
    (line) => TABLE_ROW.test(line) && cellsOf(line).join('|') === HEADER.join('|'),
  );
  if (header === -1) {
    const problem = `The register needs its table: | ${HEADER.join(' | ')} |.`;
    return { entries: [], problems: [{ where: REGISTER_PATH, problem }] };
  }
  const rows = lines.slice(header + 1);
  const end = rows.findIndex((line) => !TABLE_ROW.test(line));
  const read = (end === -1 ? rows : rows.slice(0, end))
    .map((line, index) => ({ cells: cellsOf(line), number: header + index + 2 }))
    // The row under the header separates it from the entries.
    .filter(({ cells }) => cells.some((cell) => !SEPARATOR_CELL.test(cell)))
    .map(({ cells, number }) => readEntry(cells, `${REGISTER_PATH}:${String(number)}`));
  const entries = read.flatMap((each) => each.entries);
  return {
    entries,
    problems: [
      ...read.flatMap((each) => each.problems),
      ...repeats(entries, (id, first) => `${id} has two entries; the first is at ${first}.`),
    ],
  };
}
