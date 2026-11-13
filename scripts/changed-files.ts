/**
 * Decides what the fast local check (`bun run check:changed`) looks at, given
 * the changes against origin/main, and which steps it runs. A deletion or a
 * rename counts as a change.
 */
import { FROZEN_MANIFEST, isFrozenSpec } from './content-rules';
import { isGeneratedPath } from './generated-files';

/** One changed path: present in the working tree, or removed (deleted, or renamed away). */
export type Change = Readonly<{ path: string; removed: boolean }>;

export type CheckPlan = Readonly<{
  /** Whether anything changed at all, deletions included. */
  changed: boolean;
  /** Present files for Prettier (which skips the kinds it does not know). */
  files: readonly string[];
  /** Present files for ESLint. */
  code: readonly string[];
  /** Present files for markdownlint. */
  markdown: readonly string[];
  /** Frozen French specifications that changed without their checksum manifest. */
  frozen: readonly string[];
  /** Present sources, tests and fixtures, for `vitest related`. */
  related: readonly string[];
  /** Why the whole test suite must run instead: changed tooling or migrations, removed sources. */
  wholeSuite: readonly string[];
}>;

/** One step of the fast check: the name it reports, and the command it runs. */
export type Step = Readonly<{ name: string; command: readonly string[] }>;

const CODE = /\.[cm]?[jt]sx?$/u;
// Root files, scripts, CI and dependencies change how everything is built and tested.
const TOOLING = /^(?:scripts\/|\.github\/|[^/]+$)/u;
const PROSE = /^[^/]+\.md$/u;
const SOURCE_OR_DATA = /^(?:src|data)\//u;
// Every test database is built from the migrations, so a changed one may break any test.
const MIGRATIONS = 'drizzle/';
// In `git diff --name-status -z` output: the status, then one or two paths.
const FIELDS_OF_ONE_PATH = 2;
const FIELDS_OF_TWO_PATHS = 3;
const NAMED_FILES = 3;

const byPath = (left: string, right: string): number => left.localeCompare(right, 'en');

/**
 * Reads the output of `git diff --name-status -z`: a deletion removes its path, a
 * rename removes the old path and adds the new one, a copy adds the new one.
 */
export function parseNameStatus(output: string): Change[] {
  const fields = output.split('\0').filter(Boolean);
  const changes: Change[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index] ?? '';
    const first = fields[index + 1] ?? '';
    // A rename or a copy names two paths after its status, any other change one.
    const hasTwoPaths = status.startsWith('R') || status.startsWith('C');
    changes.push(
      ...(hasTwoPaths
        ? [
            { path: first, removed: status.startsWith('R') },
            { path: fields[index + 2] ?? '', removed: false },
          ]
        : [{ path: first, removed: status === 'D' }]),
    );
    index += hasTwoPaths ? FIELDS_OF_TWO_PATHS : FIELDS_OF_ONE_PATH;
  }
  return changes;
}

/** Plans the fast check of `changes` (repository-relative paths, forward slashes). */
export function planCheck(changes: readonly Change[]): CheckPlan {
  const present = [
    ...new Set(changes.filter((change) => !change.removed).map((change) => change.path)),
  ].toSorted(byPath);
  const removed = [
    ...new Set(changes.filter((change) => change.removed).map((change) => change.path)),
  ].toSorted(byPath);
  const all = [...new Set([...present, ...removed])].toSorted(byPath);
  const hasManifestChanged = all.includes(FROZEN_MANIFEST);
  // Generated files answer to their generator, not to Prettier, ESLint or markdownlint.
  const files = present.filter((file) => !isFrozenSpec(file) && !isGeneratedPath(file));
  return {
    changed: all.length > 0,
    files,
    code: files.filter((file) => CODE.test(file)),
    markdown: files.filter((file) => file.endsWith('.md')),
    frozen: hasManifestChanged ? [] : all.filter((file) => isFrozenSpec(file)),
    related: files.filter((file) => SOURCE_OR_DATA.test(file)),
    wholeSuite: [
      ...all.filter((file) => TOOLING.test(file) && !PROSE.test(file)),
      ...all.filter((file) => file.startsWith(MIGRATIONS)),
      ...removed.filter((file) => SOURCE_OR_DATA.test(file)),
    ],
  };
}

/** Names the first few of `files`, and says how many more there are. */
export function describeFiles(files: readonly string[]): string {
  const others = files.length - NAMED_FILES;
  return files.slice(0, NAMED_FILES).join(', ') + (others > 0 ? ` and ${String(others)} more` : '');
}

/** The unit tests to run: all of them, those related to the changed files, or none. */
export function testStep(plan: CheckPlan): Step | undefined {
  if (plan.wholeSuite.length > 0) {
    return {
      name: `All unit tests, because of ${describeFiles(plan.wholeSuite)}`,
      command: ['vitest', 'run'],
    };
  }
  return plan.related.length > 0
    ? {
        name: 'Related unit tests',
        command: ['vitest', 'related', '--run', '--passWithNoTests', ...plan.related],
      }
    : undefined;
}

/**
 * The steps of the fast check, in order: Prettier, ESLint and markdownlint on the
 * present files that they read; then, whatever changed, the structure check, the
 * route types and both type checks; then the unit tests.
 */
export function stepsFor(plan: CheckPlan): Step[] {
  const tests = testStep(plan);
  const when = (isNeeded: boolean, step: Step): Step[] => (isNeeded ? [step] : []);
  return [
    ...when(plan.files.length > 0, {
      name: 'Prettier',
      command: ['prettier', '--check', '--ignore-unknown', ...plan.files],
    }),
    ...when(plan.code.length > 0, {
      name: 'ESLint',
      command: ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...plan.code],
    }),
    ...when(plan.markdown.length > 0, {
      name: 'markdownlint',
      command: ['markdownlint-cli2', ...plan.markdown],
    }),
    { name: 'Structure check', command: ['bun', 'scripts/check-structure.ts'] },
    { name: 'Route types', command: ['next', 'typegen'] },
    { name: 'Type check, whole project', command: ['tsc', '--noEmit'] },
    {
      name: 'Type check, pure core',
      command: ['tsc', '--noEmit', '-p', 'tsconfig.pure-core.json'],
    },
    ...(tests === undefined ? [] : [tests]),
  ];
}
