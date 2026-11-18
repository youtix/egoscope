/**
 * What mutation testing covers (CLAUDE.md): Stryker mutates the non-test files of
 * the two pure-core modules and runs their own tests against each mutant, as
 * stryker.config.ts and vitest.stryker.config.ts set up from PURE_CORE_MODULES, and
 * records its results in INCREMENTAL_FILE.
 *
 * A change in the mutation scope (the pure core, its tests included, the fixtures
 * that these tests may import, and the way Stryker is set up) can change what
 * mutation testing finds. `bun run gate` and the mutation workflow run the mutation
 * tests when such a change differs from their base, and only then, which keeps the
 * common gate fast (scripts/mutation-gate.ts).
 */

/** The folders of the pure-core modules, whose non-test files Stryker mutates. */
export const PURE_CORE_MODULES: readonly string[] = [
  'src/lib/stats-engine/',
  'src/lib/ai-exchange/',
];

/** The tests of both pure-core modules, at any depth: the only tests run against the mutants. */
export const PURE_CORE_TESTS: readonly string[] = PURE_CORE_MODULES.map(
  (folder) => `${folder}**/*.test.ts`,
);

/**
 * Where each run of Stryker records its results, for the next run to reuse
 * (stryker.config.ts): mutation-run.ts edits them before Stryker reads them, and
 * the mutation workflow caches them.
 */
export const INCREMENTAL_FILE = 'reports/stryker-incremental.json';

/**
 * How Stryker runs: its configuration, the script that starts it, mutation-run.ts,
 * and the workflow that runs it in CI; the Vitest configuration that it runs the
 * tests with, and the project's, which that one extends; the dependencies, Stryker,
 * Vitest and fast-check among them, and the `test:mutation` script; this file,
 * which says what Stryker mutates; and tsconfig.json, whose paths resolve the
 * `@data/` imports of the tests.
 */
export const STRYKER_SETUP: ReadonlySet<string> = new Set([
  'stryker.config.ts',
  'scripts/mutation-run.ts',
  '.github/workflows/mutation.yml',
  'vitest.stryker.config.ts',
  'vitest.config.ts',
  'package.json',
  'bun.lock',
  'scripts/mutation-scope.ts',
  'tsconfig.json',
]);

// The fixtures, which the tests of the pure core import as `@data/...`.
const DATA_FOLDER = 'data/';

const isInPureCore = (path: string): boolean =>
  PURE_CORE_MODULES.some((folder) => path.startsWith(folder));

const isInMutationScope = (path: string): boolean =>
  isInPureCore(path) || STRYKER_SETUP.has(path) || path.startsWith(DATA_FOLDER);

/**
 * The paths among `changed` (repository-relative) whose change can change what
 * mutation testing finds: the mutation tests run when there is one.
 */
export function mutationTriggers(changed: readonly string[]): readonly string[] {
  return changed.filter((path) => isInMutationScope(path));
}

/**
 * Says whether a run of the mutation tests that `triggers` started must start
 * afresh, without the results of earlier runs: when one of them lies outside the
 * pure core, since incremental mode compares only the pure core's code and tests,
 * and so would keep results that such a change, an upgrade for one, may overturn.
 */
export function requiresFreshRun(triggers: readonly string[]): boolean {
  return triggers.some((path) => !isInPureCore(path));
}
