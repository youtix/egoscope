/**
 * What mutation testing covers (CLAUDE.md): Stryker mutates the non-test files of
 * the two pure-core modules and runs their own tests against each mutant, as
 * stryker.config.ts sets up from PURE_CORE_MODULES.
 *
 * A change in the mutation scope (the pure core, its tests included, and the way
 * Stryker is set up) can change what mutation testing finds. `bun run gate` and the
 * mutation workflow run the mutation tests when such a change differs from their
 * base, and only then, which keeps the common gate fast (scripts/mutation-gate.ts).
 */

/** The folders of the pure-core modules, whose non-test files Stryker mutates. */
export const PURE_CORE_MODULES: readonly string[] = [
  'src/lib/stats-engine/',
  'src/lib/ai-exchange/',
];

// How Stryker runs: its configuration and the workflow that runs it in CI; the
// Vitest configuration that it runs the tests with; the dependencies, Stryker,
// Vitest and fast-check among them, and the `test:mutation` script; and this
// file, which says what Stryker mutates.
const STRYKER_SETUP: ReadonlySet<string> = new Set([
  'stryker.config.ts',
  '.github/workflows/mutation.yml',
  'vitest.config.ts',
  'package.json',
  'bun.lock',
  'scripts/mutation-scope.ts',
]);

const isInMutationScope = (path: string): boolean =>
  STRYKER_SETUP.has(path) || PURE_CORE_MODULES.some((folder) => path.startsWith(folder));

/**
 * The paths among `changed` (repository-relative) whose change can change what
 * mutation testing finds: the mutation tests run when there is one.
 */
export function mutationTriggers(changed: readonly string[]): readonly string[] {
  return changed.filter((path) => isInMutationScope(path));
}
