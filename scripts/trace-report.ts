/**
 * What the traceability check (trace-requirements.ts) reports: a summary for the
 * console, and the full report that it writes to reports/requirements-trace.md, which
 * git ignores. Both give, per spec file, how many IDs are covered, waived or open, and
 * the limits with their manual checks; the report also lists every ID with the tests
 * that cover it, and the problems.
 */
import path from 'node:path';

import type { Problem } from './spec-ids';
import type { Trace, TracedId } from './trace-rules';

export const REPORT_PATH = 'reports/requirements-trace.md';

/** What the summary says of the IDs a run requires by name. */
export type Required = Readonly<{ ids: readonly string[]; citable: ReadonlySet<string> }>;

type Counts = Readonly<{
  name: string;
  ids: number;
  covered: number;
  waived: number;
  open: number;
}>;

const COLUMNS = ['IDs', 'Covered', 'Waived', 'Open'] as const;
const GAP = '  ';
const ALL_FILES = 'All spec files';

function countsOf(name: string, ids: readonly TracedId[]): Counts {
  const count = (status: TracedId['status']): number =>
    ids.filter((id) => id.status === status).length;
  return {
    name,
    ids: ids.length,
    covered: count('covered'),
    waived: count('waived'),
    open: count('open'),
  };
}

/** The counts of each spec file, in the order of the specs, then those of all of them. */
function perFile(trace: Trace): readonly Counts[] {
  const files = Map.groupBy(trace.ids, (id) => path.posix.basename(id.file));
  return [...[...files].map(([name, ids]) => countsOf(name, ids)), countsOf(ALL_FILES, trace.ids)];
}

const cellsOf = (counts: Counts): readonly string[] => [
  String(counts.ids),
  String(counts.covered),
  String(counts.waived),
  String(counts.open),
];

function headline(trace: Trace): string {
  const requirements = trace.ids.filter((id) => !id.criterion).length;
  const all = countsOf(ALL_FILES, trace.ids);
  return `${String(requirements)} requirements and ${String(all.ids - requirements)} acceptance criteria: ${String(all.covered)} covered, ${String(all.waived)} waived, ${String(all.open)} open.`;
}

function countsTable(trace: Trace): readonly string[] {
  const counts = perFile(trace);
  const width = Math.max(...counts.map((each) => each.name.length));
  const line = (name: string, cells: readonly string[]): string =>
    [name.padEnd(width), ...cells.map((cell, index) => cell.padStart(COLUMNS[index]?.length ?? 0))]
      .join(GAP)
      .trimEnd();
  return [line('Spec file', COLUMNS), ...counts.map((each) => line(each.name, cellsOf(each)))];
}

const limitsOf = (trace: Trace): readonly TracedId[] =>
  trace.ids.filter((id) => id.entry?.kind === 'limit');

/** Where the tests of an ID are, each file once: `a.test.ts:12,40, b.test.ts:7`. */
function placesOf(traced: TracedId): string {
  const files = Map.groupBy(traced.tests, (test) =>
    test.where.slice(0, test.where.lastIndexOf(':')),
  );
  return [...files]
    .map(
      ([file, tests]) =>
        `${file}:${tests.map((test) => test.where.slice(file.length + 1)).join(',')}`,
    )
    .join(', ');
}

/** What has become of an ID that the run requires by name. */
function requiredState(id: string, trace: Trace, citable: ReadonlySet<string>): string {
  const traced = trace.ids.find((each) => each.id === id);
  if (traced === undefined) {
    return citable.has(id) ? 'cited only, it needs no test' : 'not an ID of the specs';
  }
  const places = placesOf(traced);
  return places === '' ? traced.status : `${traced.status} by ${places}`;
}

/** The lines that the console shows. */
export function summaryLines(trace: Trace, required: Required): readonly string[] {
  const limits = limitsOf(trace);
  return [
    `Requirement traceability: ${headline(trace)}`,
    '',
    ...countsTable(trace),
    '',
    limits.length === 0 ? 'Limits, checked by hand: none.' : 'Limits, checked by hand:',
    ...limits.map((id) => `  ${id.id}, ${id.entry?.part ?? ''}: ${id.entry?.check ?? ''}`),
    ...(required.ids.length === 0 ? [] : ['Required by name:']),
    ...required.ids.map((id) => `  ${id}: ${requiredState(id, trace, required.citable)}`),
    `Full report: ${REPORT_PATH}`,
  ];
}

/** A table cell that shows `text` as it is. */
const cellOf = (text: string): string => text.replaceAll('|', String.raw`\|`);

/** A row of a Markdown table. */
const tableRow = (cells: readonly string[]): string =>
  `| ${cells.map((cell) => cellOf(cell)).join(' | ')} |`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [tableRow(header), tableRow(header.map(() => '---')), ...rows.map((row) => tableRow(row))];
}

const section = (title: string, lines: readonly string[]): string[] => [
  `## ${title}`,
  '',
  ...lines,
  '',
];

function limitsSection(trace: Trace): string[] {
  const limits = limitsOf(trace);
  const rows = limits.map((id) => [id.id, id.entry?.part ?? '', id.entry?.check ?? '']);
  return section(
    'Limits, checked by hand',
    rows.length === 0 ? ['None.'] : table(['ID', 'Part', 'Manual check'], rows),
  );
}

function idsSection(trace: Trace): string[] {
  const rows = trace.ids.map((id) => [
    id.id,
    path.posix.basename(id.file),
    id.status,
    id.tests.map((test) => `${test.where} ${test.title}`).join('; '),
  ]);
  return section('Every ID', table(['ID', 'Spec file', 'Status', 'Tests'], rows));
}

/** The full report, in Markdown. */
export function reportMarkdown(trace: Trace, problems: readonly Problem[]): string {
  const counts = perFile(trace).map((each) => [each.name, ...cellsOf(each)]);
  return [
    '# Requirement traceability',
    '',
    headline(trace),
    '',
    ...section('Per spec file', table(['Spec file', ...COLUMNS], counts)),
    ...limitsSection(trace),
    ...section(
      'Problems',
      problems.length === 0
        ? ['None.']
        : problems.map((each) => `- ${each.where}: ${each.problem}`),
    ),
    ...idsSection(trace),
  ].join('\n');
}
