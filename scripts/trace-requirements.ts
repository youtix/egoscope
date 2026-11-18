/**
 * The requirements traceability check: every requirement and acceptance criterion of
 * the French specifications is verified by a test that names it in its title, or
 * listed with its reason in the waiver register, docs/engineering/requirement-waivers.md.
 * CLAUDE.md ("Requirement traceability") says how to tag tests and when an entry of
 * the register is legitimate.
 *
 *   bun scripts/trace-requirements.ts [--strict] [--require <ids>] [--require-claimed [--author <login>]] [--write-index]
 *
 * - Always (`bun run trace`, one of the static checks): every ID that a test or suite
 *   title cites in the square brackets it starts with is one that the specs define
 *   (spec-ids.ts), and no other square brackets of a title hold an ID; the register
 *   names only requirements and criteria, each once, with a known kind and the columns
 *   that its kind fills, and waives no tested ID (waiver-register.ts, trace-rules.ts);
 *   the criteria index is up to date (criteria-index.ts).
 * - --require <ids>, separated by commas or spaces, and --require-claimed, which reads
 *   a pull request body on standard input and requires the IDs of its "Requirements
 *   covered" section (claimedIds): each of these IDs is tested or waived, and one with
 *   a limit has its tests. The body needs that heading, unless --author names the
 *   dependency-update bot. The trace workflow runs --require-claimed on every pull
 *   request, with the login of the author who opened it.
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
import { findTitleTags, idTokens, isTestFile } from './test-titles';
import { REPORT_PATH, reportMarkdown, summaryLines } from './trace-report';
import { ofKnownPrefix, traceIds } from './trace-rules';
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
  /** The login of the author who opened the pull request whose body --require-claimed reads. */
  author: string | undefined;
  writeIndex: boolean;
}>;
type Outcome = Readonly<{ trace: Trace; problems: readonly Problem[]; required: Required }>;
/** What a pull request body claims, and what is wrong with it. */
type Claims = Readonly<{ ids: readonly string[]; problems: readonly Problem[] }>;

const USAGE =
  'Usage: bun scripts/trace-requirements.ts [--strict] [--require <ids>] [--require-claimed [--author <login>]] [--write-index]';
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
// The author of the pull requests that update dependencies, which cover no requirement.
const DEPENDENCY_BOT = 'dependabot[bot]';
const CLAIMS_HEADING = /^#{1,6}\s+Requirements covered\s*$/iu;
const NO_HEADING =
  'The description has no "Requirements covered" heading outside comments, so it claims nothing: add `## Requirements covered`, then list below it the requirements and criteria that the pull request covers, or write "None" for tooling only.';
const NO_CLAIMS: Claims = { ids: [], problems: [] };
const HEADING = /^(?<hashes>#{1,6})\s/u;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
// Where the end of a comment may start, past `<!`: `<!-->` and `<!--->` are whole comments.
const CLOSE_FROM = '<!'.length;
// The text before a comment that starts a line, as an HTML block does: the start of the
// body or a line break, then at most three spaces, which fit in the last four characters.
const BLOCK_START = /(?:^|\n) {0,3}$/u;
const BLOCK_START_LENGTH = 4;
const ID_SEPARATORS = /[\s,]+/u;

/** The level of a heading line; any other line ranks below every heading. */
const headingLevel = (line: string): number =>
  HEADING.exec(line)?.groups?.['hashes']?.length ?? Infinity;

/** Says whether the comment that opens at `open` starts a line, as an HTML block does. */
const isBlockStart = (body: string, open: number): boolean =>
  BLOCK_START.test(body.slice(Math.max(0, open - BLOCK_START_LENGTH), open));

/**
 * Where the text that GitHub shows ends, when no comment closes after `open`: at the
 * first of the comments from there that starts a line, since, as an HTML block, it hides
 * the rest of the body. An unclosed comment inside a line is text.
 */
function shownUntil(body: string, open: number): number {
  for (let at = open; at !== -1; at = body.indexOf(COMMENT_OPEN, at + 1)) {
    if (isBlockStart(body, at)) {
      return at;
    }
  }
  return body.length;
}

/**
 * The text of a pull request body that GitHub shows, without its HTML comments, read in
 * one scan from left to right: a comment runs from `<!--` to the next `-->`, and one
 * that never closes is read as GitHub does (shownUntil). So the text around a comment
 * never joins into a new one: GitHub shows `<!-<!-- x -->- JOU-04 -->` as
 * `<!-- JOU-04 -->`. The scan does not tell code apart: a `<!--` in a code span opens a
 * comment here, while GitHub shows it.
 */
function shownText(body: string): string {
  const shown: string[] = [];
  let from = 0;
  for (
    let open = body.indexOf(COMMENT_OPEN);
    open !== -1;
    open = body.indexOf(COMMENT_OPEN, from)
  ) {
    const close = body.indexOf(COMMENT_CLOSE, open + CLOSE_FROM);
    if (close === -1) {
      return [...shown, body.slice(from, shownUntil(body, open))].join('');
    }
    shown.push(body.slice(from, open));
    from = close + COMMENT_CLOSE.length;
  }
  return [...shown, body.slice(from)].join('');
}

/**
 * The IDs that a pull request body claims, or undefined when it has no "Requirements
 * covered" heading: the tokens shaped like an ID (idTokens) of that section, up to the
 * next heading of the same level, in the text that GitHub shows (shownText), which are
 * IDs of a known prefix (ofKnownPrefix). So UTF-8 or SHA-256 claims nothing, while a
 * typo such as JOU-4 is claimed, and fails as an ID that the specs do not define.
 */
export function claimedIds(body: string, specs: SpecIds): readonly string[] | undefined {
  const lines = shownText(body).split(/\r?\n/u);
  const start = lines.findIndex((line) => CLAIMS_HEADING.test(line));
  if (start === -1) {
    return undefined;
  }
  const level = headingLevel(lines[start] ?? '');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => headingLevel(line) <= level);
  const section = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  const isId = ofKnownPrefix(specs);
  return [...new Set(idTokens(section))].filter((token) => isId(token));
}

/**
 * What the body of a pull request that `author` opened claims, and the problem of a
 * body without the claims heading. Only the dependency-update bot may leave it out, as
 * its pull requests cover no requirement: the event names the author, the body cannot.
 */
function claimsOf(body: string, specs: SpecIds, author: string | undefined): Claims {
  const ids = claimedIds(body, specs);
  return ids !== undefined || author === DEPENDENCY_BOT
    ? { ids: ids ?? [], problems: [] }
    : { ids: [], problems: [{ where: 'Pull request', problem: NO_HEADING }] };
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
        author: { type: 'string' },
        'write-index': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    return {
      strict: values.strict,
      required: values.require.flatMap((ids) => ids.split(ID_SEPARATORS)).filter((id) => id !== ''),
      claimed: values['require-claimed'],
      author: values.author,
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
  const titles = io.paths
    .filter((file) => isTestFile(file))
    .map((file) => findTitleTags(file, io.read(file)));
  const claims = options.claimed ? claimsOf(io.input(), specs, options.author) : NO_CLAIMS;
  const required = [...options.required, ...claims.ids];
  const trace = traceIds(
    {
      specs,
      tags: titles.flatMap((each) => each.cited),
      stray: titles.flatMap((each) => each.stray),
      entries: register.entries,
    },
    { strict: options.strict, required },
  );
  const problems = [
    ...specs.problems,
    ...register.problems,
    ...(await indexProblems(specs.criteria, io, options)),
    ...claims.problems,
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
