/**
 * The requirement status of TRV-79, docs/guide/requirement-status.md: for every
 * requirement of the French specifications, Done, Partial or Not done (the glossary's
 * `RequirementStatus`), how to verify it, and the rows of the deviations register that
 * change it, with their record. It reads what the traceability check reads, through the
 * same helpers (trace-requirements.ts): the IDs that the specs define, the test titles
 * and the waiver register.
 *
 *   bun scripts/requirement-status.ts
 *
 * - Done: a test names the requirement, and a test names every acceptance criterion
 *   that cites it.
 * - Partial: short of that, a test names the requirement or one of its criteria, or the
 *   waiver register waives one of them.
 * - Not done: neither.
 *
 * A criterion cites the requirements that its text starts with: `(JOU-04, JOU-05) Étant
 * donné…` or `**BKT-01, BKT-08** — …`. The trace workflow writes the page on every run
 * and uploads it; only the Lot 1 milestone and the final release commit it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { label } from '@/lib/wording';

import { isSpecSource, readSpecIds } from './spec-ids';
import { findTitleTags, idTokens, isTestFile } from './test-titles';
import { systemIo } from './trace-requirements';
import { traceIds } from './trace-rules';
import { readRegister, REGISTER_PATH } from './waiver-register';

import type { MarkdownFile, SpecIds } from './spec-ids';
import type { TraceIo } from './trace-requirements';
import type { TracedId } from './trace-rules';
import type { RegisterEntry } from './waiver-register';
import type { StatusValue } from '@/lib/wording';

export const STATUS_PATH = 'docs/guide/requirement-status.md';
export const DEVIATIONS_PATH = 'docs/engineering/spec-deviations.md';

/** What the generator reads and writes: the files of the repository and the console. */
type StatusIo = Pick<TraceIo, 'paths' | 'read' | 'write' | 'info'>;

type Status = StatusValue<'RequirementStatus'>;

/** A row of the deviations register: the ID it changes, its kind and its record. */
type Deviation = Readonly<{ id: string; kind: string; record: string }>;

/** A requirement with the criteria that cite it, the deviations of either, and its status. */
type RequirementRow = Readonly<{
  requirement: TracedId;
  lot: number;
  criteria: readonly TracedId[];
  deviations: readonly Deviation[];
  status: Status;
}>;

const STATUSES: readonly Status[] = ['done', 'partial', 'not_done'];
// The columns of a table of the deviations register: ID, what the spec says, what we do
// instead, kind, record.
const DEVIATION_COLUMNS = 5;
const KIND_COLUMN = 3;
const RECORD_COLUMN = 4;
const TABLE_ROW = /^\s*\|/u;
const SEPARATOR_CELL = /^:?-+:?$/u;
// A pipe that ends a cell: one that no backslash escapes.
const CELL_BOUNDARY = /(?<!\\)\|/u;
// The requirements that a criterion's text starts with, bold or in parentheses.
const CITED = /^\s*(?:\*\*)?\(?(?<ids>[A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)/u;
// Characters that would start Markdown in a test title, which the page escapes.
const MARKDOWN = /[\\|*_`[\]<>]/gu;
const INTRODUCTION = [
  '# Requirement status',
  '',
  'For every requirement of the French specifications (TRV-79), its status and how to verify it.',
  'A requirement is Done when a test names it and a test names every acceptance criterion that cites',
  'it; Partial when short of that a test names it or one of its criteria, or the',
  '[waiver register](../engineering/requirement-waivers.md) waives one of them; Not done otherwise.',
  'Each requirement lists the tests that name it or its criteria, with their file and title, its',
  'entries in the waiver register, and the rows of the',
  '[deviations register](../engineering/spec-deviations.md) that change it, with their record.',
  '',
  'This page is generated, so never edit it by hand: `bun run docs:generate` writes it from the',
  'specifications, the test titles and the two registers. The trace workflow uploads it as the',
  '`requirement-status` artifact of every run, and the repository commits it only at the Lot 1',
  'milestone and the final release.',
  '',
];

/** The cells of a table row, trimmed, with their escaped pipes restored. */
function cellsOf(row: string): readonly string[] {
  return row
    .trim()
    .replace(/^\|/u, '')
    .replace(/(?<!\\)\|$/u, '')
    .split(CELL_BOUNDARY)
    .map((cell) => cell.trim().replaceAll(String.raw`\|`, '|'));
}

/** The rows of the tables of the deviations register whose text is `text` (TRV-79). */
export function readDeviations(text: string): readonly Deviation[] {
  return text
    .split(/\r?\n/u)
    .filter((line) => TABLE_ROW.test(line))
    .map((line) => cellsOf(line))
    .filter((cells) => cells.length === DEVIATION_COLUMNS)
    .flatMap((cells) => {
      const [id = ''] = cells;
      const kind = cells[KIND_COLUMN] ?? '';
      const record = cells[RECORD_COLUMN] ?? '';
      return id === 'ID' || SEPARATOR_CELL.test(id) ? [] : { id, kind, record };
    });
}

/** The requirement IDs that the text of a criterion starts with. */
const citedBy = (text: string): readonly string[] =>
  idTokens(CITED.exec(text)?.groups?.['ids'] ?? '');

/** `text` with the characters that would start Markdown escaped. */
const escaped = (text: string): string => text.replaceAll(MARKDOWN, String.raw`\$&`);

const isTested = (id: TracedId): boolean => id.tests.length > 0;

/** The status of a requirement, given it and the criteria that cite it (TRV-79). */
function statusOf(ids: readonly TracedId[]): Status {
  if (ids.every((id) => isTested(id))) {
    return 'done';
  }
  return ids.some((id) => isTested(id) || id.entry?.kind === 'waiver') ? 'partial' : 'not_done';
}

/** Every requirement of the specs, in their order, with its criteria, deviations and status. */
function requirementRows(
  specs: SpecIds,
  traced: readonly TracedId[],
  deviations: readonly Deviation[],
): readonly RequirementRow[] {
  const byId = new Map(traced.map((each) => [each.id, each]));
  const citations = Map.groupBy(
    specs.criteria.flatMap((criterion) => {
      const tracedCriterion = byId.get(criterion.id);
      return tracedCriterion === undefined
        ? []
        : citedBy(criterion.text).map((cited) => ({ cited, criterion: tracedCriterion }));
    }),
    (citation) => citation.cited,
  );
  return specs.requirements.flatMap(({ id, lot }) => {
    const requirement = byId.get(id);
    if (requirement === undefined) {
      return [];
    }
    const criteria = (citations.get(id) ?? []).map((citation) => citation.criterion);
    const ids = new Set([id, ...criteria.map((criterion) => criterion.id)]);
    return {
      requirement,
      lot,
      criteria,
      deviations: deviations.filter((deviation) => ids.has(deviation.id)),
      status: statusOf([requirement, ...criteria]),
    };
  });
}

function entryLine(id: string, entry: RegisterEntry): string {
  return entry.kind === 'waiver'
    ? `- ${id}: waived. ${entry.reason} Reference: ${entry.check}`
    : `- ${id}: limit on ${entry.part}. ${entry.reason} Checked by hand: ${entry.check}`;
}

/** How to verify one requirement or criterion: its register entry, its tests, or none. */
function verificationLines(id: TracedId): readonly string[] {
  const entry = id.entry === undefined ? [] : [entryLine(id.id, id.entry)];
  const tests = id.tests.map((test) => `- ${id.id}: \`${test.where}\` ${escaped(test.title)}`);
  const none = isTested(id) || id.entry?.kind === 'waiver' ? [] : [`- ${id.id}: no test.`];
  return [...entry, ...tests, ...none];
}

function requirementSection(row: RequirementRow): readonly string[] {
  const deviations = row.deviations.map(
    (deviation) =>
      `- ${deviation.id}: ${deviation.kind} in the deviations register, record ${deviation.record}.`,
  );
  return [
    `### ${row.requirement.id} — ${label('RequirementStatus', row.status)}`,
    '',
    ...deviations,
    ...[row.requirement, ...row.criteria].flatMap((id) => verificationLines(id)),
    '',
  ];
}

function fileSection(file: string, rows: readonly RequirementRow[]): readonly string[] {
  const name = path.posix.basename(file);
  const link = path.posix.relative(path.posix.dirname(STATUS_PATH), file);
  return [`## [${name}](${link})`, '', ...rows.flatMap((row) => requirementSection(row))];
}

/** The count of each status, lot by lot. */
function summary(rows: readonly RequirementRow[]): readonly string[] {
  const lots = Map.groupBy(
    rows.toSorted((left, right) => left.lot - right.lot),
    (row) => row.lot,
  );
  const counts = Array.from(lots, ([lot, ofLot]) => {
    const cells = STATUSES.map((status) => ofLot.filter((row) => row.status === status).length);
    return `| Lot ${String(lot)} | ${cells.join(' | ')} |`;
  });
  return [
    `| Lot | ${STATUSES.map((status) => label('RequirementStatus', status)).join(' | ')} |`,
    `| --- | ${STATUSES.map(() => '---').join(' | ')} |`,
    ...counts,
    '',
  ];
}

/**
 * The requirement status page of the repository that `io` reads, formatted as Prettier
 * formats Markdown (TRV-79): every requirement ID of the specs with its status, its tests
 * or waiver, and the deviations that change it, with their record.
 */
export async function requirementStatus(io: Pick<StatusIo, 'paths' | 'read'>): Promise<string> {
  const specs = readSpecIds(
    io.paths
      .filter((file) => isSpecSource(file))
      .map((file): MarkdownFile => ({ path: file, text: io.read(file) })),
  );
  const titles = io.paths
    .filter((file) => isTestFile(file))
    .map((file) => findTitleTags(file, io.read(file)));
  const trace = traceIds(
    {
      specs,
      tags: titles.flatMap((each) => each.cited),
      stray: titles.flatMap((each) => each.stray),
      entries: readRegister(io.read(REGISTER_PATH)).entries,
    },
    { strict: false, required: [] },
  );
  const rows = requirementRows(specs, trace.ids, readDeviations(io.read(DEVIATIONS_PATH)));
  const files = Map.groupBy(rows, (row) => row.requirement.file);
  const markdown = [
    ...INTRODUCTION,
    ...summary(rows),
    ...Array.from(files, ([file, ofFile]) => fileSection(file, ofFile)).flat(),
  ].join('\n');
  const options = await resolveConfig(STATUS_PATH);
  return format(markdown, { ...options, filepath: STATUS_PATH });
}

/** Writes docs/guide/requirement-status.md from the repository that `io` reads (TRV-79). */
export async function writeRequirementStatus(io: StatusIo): Promise<void> {
  io.write(STATUS_PATH, await requirementStatus(io));
  io.info(`Wrote ${STATUS_PATH}.`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await writeRequirementStatus(systemIo());
}
