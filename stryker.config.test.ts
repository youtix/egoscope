// Proves that Stryker mutates the non-test files of both pure-core modules, at any
// depth, runs their own tests only, and fails a run below a 100% mutation score.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import config from './stryker.config';

/**
 * Says whether Stryker mutates `file`, reading `mutate` as Stryker does: in order,
 * a negated glob taking back what an earlier one matched, so the last glob that
 * matches decides.
 */
function isMutated(file: string): boolean {
  const deciding = config.mutate.findLast((glob) =>
    path.matchesGlob(file, glob.replace(/^!/u, '')),
  );
  return deciding !== undefined && !deciding.startsWith('!');
}

const isRunAgainstMutants = (file: string): boolean =>
  config.testFiles.some((glob) => path.matchesGlob(file, glob));

describe('stryker.config.ts', () => {
  it.each([
    'src/lib/stats-engine/game-score.ts',
    'src/lib/stats-engine/index.ts',
    'src/lib/stats-engine/performance/game-score.ts',
    'src/lib/ai-exchange/research-prompt.ts',
    'src/lib/ai-exchange/checks/research-result.ts',
  ])('mutates %s, a non-test file of the pure core', (file) => {
    expect(isMutated(file)).toBe(true);
  });

  it.each([
    'src/lib/stats-engine/game-score.test.ts',
    'src/lib/ai-exchange/checks/research-result.test.ts',
    'src/lib/stats-engine-next/game-score.ts',
    'src/lib/env/server-env.ts',
    'src/app/page.tsx',
    'scripts/mutation-scope.ts',
  ])('leaves %s unmutated: a test, or a file outside the pure core', (file) => {
    expect(isMutated(file)).toBe(false);
  });

  it.each([
    'src/lib/stats-engine/game-score.test.ts',
    'src/lib/stats-engine/performance/game-score.test.ts',
    'src/lib/ai-exchange/checks/research-result.test.ts',
  ])('runs %s, a test of the pure core, against the mutants', (file) => {
    expect(isRunAgainstMutants(file)).toBe(true);
  });

  it.each(['src/lib/env/server-env.test.ts', 'src/app/page.test.tsx', 'scripts/ci-ok.test.ts'])(
    'never runs %s against the mutants, so that only the tests of the pure core kill them',
    (file) => {
      expect(isRunAgainstMutants(file)).toBe(false);
    },
  );

  it('fails a run below a 100% mutation score, and records its results for the next run', () => {
    expect(config.thresholds).toStrictEqual({ high: 100, low: 100, break: 100 });
    expect(config.incremental).toBe(true);
  });
});
