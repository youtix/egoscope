/**
 * The Vitest configuration that Stryker runs the tests with (stryker.config.ts):
 * the project's own, vitest.config.ts, with one project that holds the tests of the
 * pure core and no other, so that they alone must kill every mutant.
 *
 * These tests are chosen here, not by Stryker's `testFiles` option. Stryker hands
 * the files of `testFiles` to a mutant of code that runs when a module loads (a
 * static mutant, such as one in a named constant or a pattern) as the tests to run,
 * and so activates it only once the module has loaded: the mutant changes nothing,
 * and survives the tests that pin its value. Without that option, Stryker activates
 * such a mutant before the test files load, and Vitest runs against it every test
 * of the pure core that imports its file, directly or not (`related` mode).
 */
import { defineConfig } from 'vitest/config';

// The extensions let Vite's native config loader, Node itself, import the files.
import { PURE_CORE_TESTS } from './scripts/mutation-scope.ts';
import config from './vitest.config.ts';

import type { ViteUserConfig } from 'vitest/config';

const strykerConfig: ViteUserConfig = defineConfig({
  ...config,
  test: {
    ...config.test,
    // An inline project extends this file, so the options of vitest.config.ts apply.
    projects: [{ test: { name: 'pure-core', environment: 'node', include: [...PURE_CORE_TESTS] } }],
  },
});

export default strykerConfig;
