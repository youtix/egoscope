/**
 * The parameter list of TRV-79, docs/guide/parameters.md: every parameter of the
 * registry (`@/lib/params`), with what it sets, its default, unit, allowed values,
 * owning spec file and requirement, and the origin of its default (TRV-34). The page is
 * read from the registry itself, through an empty database of its own, in memory, so
 * that every parameter shows its default and no shell's database is ever reached
 * (TRV-76).
 *
 *   bun --no-env-file --conditions=react-server scripts/parameters-doc.ts
 *
 * `bun run docs:generate` runs it, and parameters-doc.test.ts fails when the committed
 * page no longer matches the registry.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { createTestDatabase } from '@/lib/db';
import { listRegistry } from '@/lib/params';

import type { ParameterOrigin, RegistryRow } from '@/lib/params';

export const PARAMETERS_PATH = 'docs/guide/parameters.md';

// Every lot, so that the page lists the Lot 2 parameters too.
const LAST_LOT = 2;
// The default of an entry that holds no value of its own: the per-type criterion
// switch, which no type has on until the owner sets it on its sheet.
const NO_DEFAULT = 'None';
const SPEC_FILE = /^docs\/(?<number>\d{2})-[^/]+\.md$/u;
const INTRODUCTION = [
  '# Parameters',
  '',
  'Every parameter of the application (TRV-79): what it sets, its default, its unit, the',
  'values it accepts, the specification file and the requirement that define it, and the origin of',
  'its default: a decision, a hypothesis of the decision journal, or a local hypothesis to be',
  'confirmed. The owner changes them on the parameters screen; a Lot 2 parameter shows there once',
  'Lot 2 runs.',
  '',
  'This page is generated, so never edit it by hand: `bun run docs:generate` writes it from the',
  'parameter registry, and a test fails when it no longer matches.',
  '',
];

/** Every parameter of the registry, at its default (TRV-34, TRV-79). */
export async function registryRows(): Promise<readonly RegistryRow[]> {
  const database = await createTestDatabase();
  try {
    return await listRegistry(database.db, LAST_LOT);
  } finally {
    await database.close();
  }
}

/** The label of an origin, as the glossary's `ParameterOrigin` writes it. */
function originLabel(origin: ParameterOrigin): string {
  switch (origin) {
    case 'journal_decision': {
      return 'Decision';
    }
    case 'journal_hypothesis': {
      return 'Hypothesis';
    }
    case 'local_hypothesis': {
      return 'Local hypothesis, to be confirmed';
    }
  }
}

function parameterSection(row: RegistryRow): readonly string[] {
  return [
    `### ${row.label}`,
    '',
    row.sentence,
    '',
    `- Key: \`${row.key}\``,
    `- Default: ${row.setting?.defaultWritten ?? NO_DEFAULT}`,
    `- Unit: ${row.unit}`,
    `- Allowed values: ${row.allowed}`,
    `- Requirement: ${row.requirement}`,
    `- Origin: ${originLabel(row.origin)} (${row.source})`,
    `- Lot: ${String(row.lot)}`,
    '',
  ];
}

/** The heading of the parameters of one spec file, linked to it. */
function fileHeading(number: string, specFiles: readonly string[]): string {
  const file = specFiles.find((each) => SPEC_FILE.exec(each)?.groups?.['number'] === number);
  if (file === undefined) {
    // The registry names its file by a requirement prefix, which a spec file owns.
    throw new Error(`No spec file has the number ${number}.`);
  }
  const link = path.posix.relative(path.posix.dirname(PARAMETERS_PATH), file);
  return `## [${path.posix.basename(file)}](${link})`;
}

/**
 * The parameter list of `rows`, grouped by owning spec file in the order of the files,
 * each in the order of the registry, formatted as Prettier formats Markdown (TRV-34,
 * TRV-79); `specFiles` are the repository-relative paths of the spec files to link.
 */
export async function parametersPage(
  rows: readonly RegistryRow[],
  specFiles: readonly string[],
): Promise<string> {
  // A stable sort, so that the registry's order holds inside each file.
  const files = Map.groupBy(
    rows.toSorted((left, right) => left.file.localeCompare(right.file, 'en')),
    (row) => row.file,
  );
  const sections = Array.from(files, ([number, ofFile]) => [
    fileHeading(number, specFiles),
    '',
    ...ofFile.flatMap((row) => parameterSection(row)),
  ]);
  const markdown = [...INTRODUCTION, ...sections.flat()].join('\n');
  const options = await resolveConfig(PARAMETERS_PATH);
  return format(markdown, { ...options, filepath: PARAMETERS_PATH });
}

/** The parameter list of the registry, linked to the spec files of the repository (TRV-79). */
export async function parametersDoc(): Promise<string> {
  const specFiles = readdirSync('docs').map((file) => `docs/${file}`);
  return parametersPage(await registryRows(), specFiles);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const page = await parametersDoc();
  mkdirSync(path.dirname(PARAMETERS_PATH), { recursive: true });
  writeFileSync(PARAMETERS_PATH, page);
  console.info(`Wrote ${PARAMETERS_PATH}.`);
}
