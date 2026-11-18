/**
 * Mutation testing of the pure core (CLAUDE.md, "Mutation testing"). Stryker plants
 * one small fault at a time, a mutant, in the non-test files of the pure core, and
 * runs the core's own tests against it: a mutant that no test catches survives. Run
 * with `bun run test:mutation`, which passes this file to Stryker through
 * scripts/mutation-run.ts.
 */
// The extensions let Node itself, which loads this file for Stryker, import the files.
import { IGNORED_FOLDERS } from './scripts/ignored-folders.ts';
import { INCREMENTAL_FILE, PURE_CORE_MODULES, PURE_CORE_TESTS } from './scripts/mutation-scope.ts';

import type { Stryker } from '@stryker-mutator/core';

// The options that Stryker's own entry point takes, each of them optional.
type StrykerOptions = ConstructorParameters<typeof Stryker>[0];

// Several agents share one small machine: locally, two workers. CI runners are
// dedicated, so CI keeps Stryker's default.
const isCi = process.env['CI'] === 'true';

const config = {
  testRunner: 'vitest',
  // The non-test files of both modules, at any depth.
  mutate: [
    ...PURE_CORE_MODULES.map((folder) => `${folder}**/*.ts`),
    ...PURE_CORE_TESTS.map((glob) => `!${glob}`),
  ],
  // Only the core's own tests run, so they alone must catch every mutant: this
  // Vitest configuration holds them alone, and says why Stryker's `testFiles`
  // option, which would also choose them, must stay unset.
  vitest: { configFile: 'vitest.stryker.config.ts' },
  // Below a 100% mutation score, the run fails. A survivor gets a better test or,
  // when no test can tell it from the code, the one comment CLAUDE.md allows.
  thresholds: { high: 100, low: 100, break: 100 },
  // Each run records its results in INCREMENTAL_FILE, which git ignores and CI
  // caches, and the next run tests only the mutants of what changed. First,
  // scripts/mutation-run.ts takes out of them the mutants of code that runs when its
  // module loads, whose results Stryker cannot judge, so that every run tests them.
  incremental: true,
  incrementalFile: INCREMENTAL_FILE,
  ...(!isCi && { concurrency: 2 }),
  reporters: ['clear-text', 'progress', 'html', 'json'],
  // The other agents' worktrees never reach the sandbox (scripts/ignored-folders.ts).
  ignorePatterns: IGNORED_FOLDERS.map((folder) => `/${folder}`),
  // Sandboxes sit in a folder that every tool of the gate skips, so that one that an
  // interrupted run leaves behind is never linted, type-checked or tested.
  tempDirName: 'reports/.stryker-tmp',
} satisfies StrykerOptions;

export default config;
