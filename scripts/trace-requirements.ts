/**
 * The requirements traceability check: every requirement and acceptance criterion of
 * the French specifications is verified by a test that names it in its title, or
 * listed with its reason in the waiver register, docs/engineering/requirement-waivers.md.
 * CLAUDE.md ("Requirement traceability") says how to tag tests and when an entry of
 * the register is legitimate.
 *
 *   bun scripts/trace-requirements.ts [--strict] [--require <ids>] [--require-claimed] [--write-index]
 *
 * - Always (`bun run trace`, one of the static checks): every ID that a test or suite
 *   title cites in square brackets is one that the specs define (spec-ids.ts); the
 *   register names only requirements and criteria, each once, with a known kind, and
 *   waives no tested ID (trace-rules.ts); the criteria index is up to date
 *   (criteria-index.ts).
 * - --require <ids>, separated by commas or spaces, and --require-claimed, which reads
 *   a pull request body on standard input and requires the IDs of its "Requirements
 *   covered" section: each of these IDs is tested or waived, and one with a limit has
 *   its tests. The trace workflow runs --require-claimed on every pull request.
 * - --strict (`bun run trace:strict`): the same for every requirement and criterion.
 * - --write-index rewrites docs/engineering/acceptance-criteria-index.md first.
 *
 * It prints a summary, writes the full report to reports/requirements-trace.md, and
 * exits with 1 when a rule is broken, 2 when the arguments are wrong.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { criteriaIndex, INDEX_PATH } from './criteria-index';
import { isIgnoredPath } from './ignored-folders';
import { isSpecSource, readSpecIds } from './spec-ids';
import { findTitleTags, isTestFile } from './test-titles';
import { REPORT_PATH, reportMarkdown, summaryLines } from './trace-report';
import { traceIds } from './trace-rules';
import { readRegister, REGISTER_PATH } from './waiver-register';

import type { Criterion, MarkdownFile, Problem, SpecIds } from './spec-ids';
import type { Required } from './trace-report';
import type { Trace } from './trace-rules';
import type { Register } from './waiver-register';

/** What the check reads and writes: the files of the repository, standard input, the console. */
export type TraceIo = Readonly<{
  /** The repository-relative paths of every file of the repository. */
  paths: readonly string[];
  read: (file: string) => string;
  write: (file: string, text: string) => void;
  /** The text on standard input, which only --require-claimed reads. */
  input: () => string;
  info: (line: string) => void;
  error: (line: string) => void;
}>;

type Options = Readonly<{
  strict: boolean;
  required: readonly string[];
  claimed: boolean;
  writeIndex: boolean;
}>;
type Outcome = Readonly<{ trace: Trace; problems: readonly Problem[]; required: Required }>;

const USAGE =
  'Usage: bun scripts/trace-requirements.ts [--strict] [--require <ids>] [--require-claimed] [--write-index]';
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const CLAIMS_HEADING = /^#{1,6}\s+Requirements covered\s*$/iu;
const HEADING = /^(?<hashes>#{1,6})\s/u;
const COMMENT = /<!--[\s\S]*?-->/gu;
// A token shaped like an ID: CA-JOU-02, and also UTF-8 or HMAC-SHA-256.
const ID = /\b[A-Z]+(?:-[A-Z]+)*-\d+\b/gu;
const PREFIX = /^[A-Z]+/u;
const ID_SEPARATORS = /[\s,]+/u;

/** The level of a heading line; any other line ranks below every heading. */
const headingLevel = (line: string): number =>
  HEADING.exec(line)?.groups?.['hashes']?.length ?? Infinity;

/** The prefix of an ID, or of a token shaped like one: CA of CA-JOU-02, HMAC of HMAC-SHA-256. */
const prefixOf = (token: string): string => PREFIX.exec(token)?.[0] ?? '';

/**
 * The prefixes of the IDs that the specs and the rulings define: those of the
 * requirements, CA of the criteria, H, Q and D of the hypotheses, questions and
 * decisions, CL of the rulings.
 */
function prefixesOf(specs: SpecIds): ReadonlySet<string> {
  const defined = [...specs.requirements, ...specs.criteria].map(({ id }) => id);
  return new Set([...defined, ...specs.citable].map((id) => prefixOf(id)));
}

/**
 * The IDs that a pull request body claims: every ID of its "Requirements covered"
 * section, up to the next heading of the same level, outside HTML comments. A token
 * shaped like an ID is one only when `specs` define an ID of its prefix, so that
 * UTF-8 or SHA-256 claims nothing, while a typo such as JOU-4 is claimed, and fails as
 * an ID that the specs do not define.
 */
export function claimedIds(body: string, specs: SpecIds): readonly string[] {
  const lines = body.replaceAll(COMMENT, '').split(/\r?\n/u);
  const start = lines.findIndex((line) => CLAIMS_HEADING.test(line));
  if (start === -1) {
    return [];
  }
  const level = headingLevel(lines[start] ?? '');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => headingLevel(line) <= level);
  const section = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  const prefixes = prefixesOf(specs);
  return [...new Set(section.match(ID))].filter((token) => prefixes.has(prefixOf(token)));
}

/** The options that `args` give, or what is wrong with them. */
function optionsOf(args: readonly string[]): Options | string {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: {
        strict: { type: 'boolean', default: false },
        require: { type: 'string', multiple: true, default: [] },
        'require-claimed': { type: 'boolean', default: false },
        'write-index': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    return {
      strict: values.strict,
      required: values.require.flatMap((ids) => ids.split(ID_SEPARATORS)).filter((id) => id !== ''),
      claimed: values['require-claimed'],
      writeIndex: values['write-index'],
    };
  } catch (error) {
    // parseArgs reports wrong arguments by throwing: here they become a value.
    return error instanceof Error ? error.message : String(error);
  }
}

/** Writes the criteria index, or says how it differs from the committed one. */
async function indexProblems(
  criteria: readonly Criterion[],
  io: TraceIo,
  options: Options,
): Promise<readonly Problem[]> {
  const index = await criteriaIndex(criteria);
  if (options.writeIndex) {
    io.write(INDEX_PATH, index);
    return [];
  }
  const current = io.paths.includes(INDEX_PATH) ? io.read(INDEX_PATH) : '';
  return current === index
    ? []
    : [
        {
          where: INDEX_PATH,
          problem:
            'The acceptance criteria index does not match the specs: run `bun run trace --write-index`, then commit the file.',
        },
      ];
}

function registerOf(io: TraceIo): Register {
  return io.paths.includes(REGISTER_PATH)
    ? readRegister(io.read(REGISTER_PATH))
    : {
        entries: [],
        problems: [{ where: REGISTER_PATH, problem: 'The waiver register is missing.' }],
      };
}

/** Prints the summary and the problems, writes the report, and returns the exit code. */
function report(io: TraceIo, outcome: Outcome): number {
  const { trace, problems, required } = outcome;
  for (const line of summaryLines(trace, required)) {
    io.info(line);
  }
  io.write(REPORT_PATH, reportMarkdown(trace, problems));
  if (problems.length === 0) {
    io.info('Requirement traceability passed.');
    return 0;
  }
  for (const { where, problem } of problems) {
    io.error(`${where}: ${problem}`);
  }
  io.error(`\nRequirement traceability failed: ${String(problems.length)} problem(s).`);
  return EXIT_PROBLEMS;
}

/** Runs the check with the command-line arguments `args`, and returns its exit code. */
export async function runTrace(args: readonly string[], io: TraceIo): Promise<number> {
  const options = optionsOf(args);
  if (typeof options === 'string') {
    io.error(`${options}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const specs = readSpecIds(
    io.paths
      .filter((file) => isSpecSource(file))
      .map((file): MarkdownFile => ({ path: file, text: io.read(file) })),
  );
  const register = registerOf(io);
  const tags = io.paths
    .filter((file) => isTestFile(file))
    .flatMap((file) => findTitleTags(file, io.read(file)));
  const required = [...options.required, ...(options.claimed ? claimedIds(io.input(), specs) : [])];
  const trace = traceIds(
    { specs, tags, entries: register.entries },
    { strict: options.strict, required },
  );
  const problems = [
    ...specs.problems,
    ...register.problems,
    ...(await indexProblems(specs.criteria, io, options)),
    ...trace.problems,
  ];
  return report(io, { trace, problems, required: { ids: required, citable: specs.citable } });
}

/** The files of the repository: those git tracks or would track, that exist. */
function repositoryPaths(): readonly string[] {
  const listing = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  return listing
    .split('\0')
    .filter((file) => file !== '' && !isIgnoredPath(file) && existsSync(file))
    .toSorted((left, right) => left.localeCompare(right, 'en'));
}

/** The real repository, standard input and console. */
export function systemIo(): TraceIo {
  return {
    paths: repositoryPaths(),
    read: (file) => readFileSync(file, 'utf8'),
    write: (file, text) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    input: () => readFileSync(0, 'utf8'),
    info: (line) => {
      console.info(line);
    },
    error: (line) => {
      console.error(line);
    },
  };
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runTrace(process.argv.slice(2), systemIo());
}
