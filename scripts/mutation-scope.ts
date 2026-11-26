/**
 * What mutation testing covers (CLAUDE.md): Stryker mutates the non-test files of
 * the two pure-core modules and runs their own tests against each mutant, as
 * stryker.config.ts and vitest.stryker.config.ts set up from PURE_CORE_MODULES, and
 * records its results in INCREMENTAL_FILE.
 *
 * A change in the mutation scope (the pure core, its tests included, the fixtures of
 * data/ that a file of the pure core imports, and the way Stryker is set up) can
 * change what mutation testing finds. `bun run gate` and the mutation workflow run
 * the mutation tests, from scratch, when such a change differs from their base, and
 * only then, which keeps the common gate fast (scripts/mutation-gate.ts).
 *
 * The fixtures and the files that the configurations of the run import are read from
 * the imports of the head being tested (scripts/mutation-imports.ts), never listed by
 * hand. This file imports nothing, so that Node's own loader can load it for the
 * configurations.
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
 * (stryker.config.ts): mutation-run.ts edits them before Stryker reads them.
 */
export const INCREMENTAL_FILE = 'reports/stryker-incremental.json';

/**
 * The configurations of the mutation run: Stryker's, the Vitest configuration that it
 * runs the tests with and the project's, which that one extends, and the script that
 * starts Stryker. Every file that they import, directly or not, belongs to the setup
 * too (scripts/mutation-imports.ts).
 */
export const MUTATION_CONFIGURATIONS: readonly string[] = [
  'stryker.config.ts',
  'vitest.stryker.config.ts',
  'vitest.config.ts',
  'scripts/mutation-run.ts',
];

/**
 * How Stryker runs, beyond what the configurations import: the configurations
 * themselves; the workflow that runs it in CI; the dependencies, Stryker, Vitest and
 * fast-check among them, and the `test:mutation` script; and tsconfig.json, whose
 * paths resolve the `@data/` imports of the tests.
 */
const NAMED_SETUP: ReadonlySet<string> = new Set([
  ...MUTATION_CONFIGURATIONS,
  '.github/workflows/mutation.yml',
  'package.json',
  'bun.lock',
  'tsconfig.json',
]);

/** Says whether `path` (repository-relative) is a file of the pure core, a test included. */
export const isInPureCore = (path: string): boolean =>
  PURE_CORE_MODULES.some((folder) => path.startsWith(folder));

/**
 * The paths among `changed` (repository-relative) whose change can change what
 * mutation testing finds: a file of the pure core, a named file of the setup, or one
 * of `imported`, the files that the pure core and the configurations import
 * (scripts/mutation-imports.ts). The mutation tests run when there is one.
 */
export function mutationTriggers(
  changed: readonly string[],
  imported: ReadonlySet<string>,
): readonly string[] {
  return changed.filter(
    (path) => isInPureCore(path) || NAMED_SETUP.has(path) || imported.has(path),
  );
}
