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

// How Stryker runs: its configuration, and the workflow that runs it in CI.
const STRYKER_SETUP: ReadonlySet<string> = new Set([
  'stryker.config.ts',
  '.github/workflows/mutation.yml',
]);

/** Says whether a change to `path` (repository-relative) can change what mutation testing finds. */
export function isInMutationScope(path: string): boolean {
  return STRYKER_SETUP.has(path) || PURE_CORE_MODULES.some((folder) => path.startsWith(folder));
}
