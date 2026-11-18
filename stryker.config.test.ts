// Proves that Stryker mutates the non-test files of both pure-core modules, at any
// depth, runs their own tests only, and fails a run below a 100% mutation score;
// that the configuration sets exactly the options below, so that a new one, such as
// a project-wide exclusion, which needs no comment in the code, is a change that a
// reviewer reads; and that CI reuses the results of earlier runs only while what
// incremental mode cannot see stays the same.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { PURE_CORE_MODULES } from './scripts/mutation-scope';
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

// Every option that the configuration sets in CI; locally, `concurrency` too.
const OPTIONS = [
  'testRunner',
  'mutate',
  'testFiles',
  'thresholds',
  'incremental',
  'reporters',
  'ignorePatterns',
  'tempDirName',
];

/** The options that the configuration sets, loaded afresh with `CI` set to `ci`. */
async function optionsWhere(ci: string): Promise<ReadonlySet<string>> {
  vi.stubEnv('CI', ci);
  vi.resetModules();
  const loaded = await import('./stryker.config');
  return new Set(Object.keys(loaded.default));
}

const WORKFLOW = path.join(import.meta.dirname, '.github/workflows/mutation.yml');
// The step of the mutation workflow that restores the results of earlier runs.
const RESTORE_STEP = z.object({
  id: z.literal('incremental'),
  env: z.object({ PREFIX: z.string() }),
  with: z.object({ path: z.string(), 'restore-keys': z.string() }),
});
const STRYKER_JOB = z.object({ steps: z.array(z.unknown()) });
const WORKFLOW_JOBS = z.object({ jobs: z.object({ stryker: STRYKER_JOB }) });

/** The step of mutation.yml that restores the results of earlier runs. */
function restoreStep(): z.infer<typeof RESTORE_STEP> {
  const workflow = WORKFLOW_JOBS.parse(parse(readFileSync(WORKFLOW, 'utf8')));
  return RESTORE_STEP.parse(
    workflow.jobs.stryker.steps.find((step) => RESTORE_STEP.safeParse(step).success),
  );
}

/** The globs of the files whose content names the cache: those that its prefix hashes. */
function cacheKeyGlobs(): readonly string[] {
  const listed = /hashFiles\((?<globs>[^)]*)\)/u.exec(restoreStep().env.PREFIX)?.groups?.['globs'];
  return (listed ?? '').split(',').map((glob) => glob.trim().replaceAll("'", ''));
}

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

  it('sets these options and no other, so that an exclusion such as `mutator` is a deliberate change', async () => {
    await expect(optionsWhere('true')).resolves.toStrictEqual(new Set(OPTIONS));
    await expect(optionsWhere('')).resolves.toStrictEqual(new Set([...OPTIONS, 'concurrency']));
  });

  it('mutates whole files of the pure core, which no other glob, negation or line range narrows', () => {
    expect(config.mutate).toStrictEqual([
      ...PURE_CORE_MODULES.map((folder) => `${folder}**/*.ts`),
      ...PURE_CORE_MODULES.map((folder) => `!${folder}**/*.test.ts`),
    ]);
  });
});

describe('the cache of the mutation workflow', () => {
  it.each([
    'stryker.config.ts',
    'vitest.config.ts',
    'tsconfig.json',
    'bun.lock',
    'data/fixtures/trace/spec-id-counts.json',
    'data/fixtures/stats-source/season/game-log.json',
  ])('starts the CI run afresh after a change to %s, which incremental mode cannot see', (file) => {
    expect(cacheKeyGlobs().some((glob) => path.matchesGlob(file, glob))).toBe(true);
  });

  it('restores only results that were recorded under the same key prefix', () => {
    expect(restoreStep().with).toStrictEqual({
      path: 'reports/stryker-incremental.json',
      'restore-keys': '${{ env.PREFIX }}',
    });
  });
});
