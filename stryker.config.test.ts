// Proves that Stryker mutates the non-test files of both pure-core modules, at any
// depth, runs their own tests only, and fails a run below a 100% mutation score;
// that the configuration sets exactly the options below, so that a new one, such as
// a project-wide exclusion, which needs no comment in the code, is a change that a
// reviewer reads, and that `bun run test:mutation` adds none on the command line;
// that the Vitest configuration that Stryker runs is the project's, with the tests
// of the pure core alone; and that CI caches the results that Stryker records, and
// reuses them only while what incremental mode cannot see stays the same.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { STRYKER_COMMAND } from './scripts/mutation-run';
import { INCREMENTAL_FILE, PURE_CORE_MODULES, STRYKER_SETUP } from './scripts/mutation-scope';
import config from './stryker.config';
import vitestConfig from './vitest.config';
import strykerVitestConfig from './vitest.stryker.config';

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

// The projects of the Vitest configuration that Stryker runs, as far as they choose tests.
const TEST_SELECTION = z.object({ include: z.array(z.string()) });
const TEST_PROJECTS = z.array(z.object({ test: TEST_SELECTION }));

/** Says whether `file` is among the tests that Stryker runs against the mutants. */
const isRunAgainstMutants = (file: string): boolean =>
  TEST_PROJECTS.parse(strykerVitestConfig.test?.projects).some((project) =>
    project.test.include.some((glob) => path.matchesGlob(file, glob)),
  );

// Every option that the configuration sets in CI; locally, `concurrency` too.
const OPTIONS = [
  'testRunner',
  'mutate',
  'vitest',
  'thresholds',
  'incremental',
  'incrementalFile',
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

const PACKAGE = z.object({ scripts: z.record(z.string(), z.string()) });

/** The command that `bun run test:mutation` runs, as package.json writes it. */
function mutationScript(): string | undefined {
  const manifest = readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8');
  return PACKAGE.parse(JSON.parse(manifest)).scripts['test:mutation'];
}

const WORKFLOW = path.join(import.meta.dirname, '.github/workflows/mutation.yml');
// The step of the mutation workflow that restores the results of earlier runs.
const RESTORE_STEP = z.object({
  id: z.literal('incremental'),
  env: z.object({ PREFIX: z.string() }),
  with: z.object({ path: z.string(), 'restore-keys': z.string() }),
});
// The step that saves the results of the run for later runs.
const SAVE_STEP = z.object({
  uses: z.string().startsWith('actions/cache/save@'),
  with: z.object({ path: z.string(), key: z.string() }),
});
const STRYKER_JOB = z.object({ steps: z.array(z.unknown()) });
const WORKFLOW_JOBS = z.object({ jobs: z.object({ stryker: STRYKER_JOB }) });

/** The step of mutation.yml that `schema` describes, which must be there. */
function stepOf<Step>(schema: z.ZodType<Step>): Step {
  const workflow = WORKFLOW_JOBS.parse(parse(readFileSync(WORKFLOW, 'utf8')));
  return schema.parse(workflow.jobs.stryker.steps.find((step) => schema.safeParse(step).success));
}

/** The step of mutation.yml that restores the results of earlier runs. */
const restoreStep = (): z.infer<typeof RESTORE_STEP> => stepOf(RESTORE_STEP);

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

  it.each([
    'src/lib/env/server-env.test.ts',
    'src/lib/stats-engine-next/game-score.test.ts',
    'src/app/page.test.tsx',
    'scripts/ci-ok.test.ts',
    'stryker.config.test.ts',
  ])(
    'never runs %s against the mutants, so that only the tests of the pure core kill them',
    (file) => {
      expect(isRunAgainstMutants(file)).toBe(false);
    },
  );

  it('fails a run below a 100% mutation score, and records its results for the next run in the file that scripts/mutation-run.ts edits first', () => {
    expect(config.thresholds).toStrictEqual({ high: 100, low: 100, break: 100 });
    expect(config.incremental).toBe(true);
    expect(config.incrementalFile).toBe(INCREMENTAL_FILE);
  });

  it('sets these options and no other, so that an exclusion such as `mutator` is a deliberate change', async () => {
    await expect(optionsWhere('true')).resolves.toStrictEqual(new Set(OPTIONS));
    await expect(optionsWhere('')).resolves.toStrictEqual(new Set([...OPTIONS, 'concurrency']));
  });

  it('leaves `testFiles` unset, which would let a mutant of code that runs when a module loads survive', () => {
    expect(config).not.toHaveProperty('testFiles');
  });

  it('mutates whole files of the pure core, which no other glob, negation or line range narrows', () => {
    expect(config.mutate).toStrictEqual([
      ...PURE_CORE_MODULES.map((folder) => `${folder}**/*.ts`),
      ...PURE_CORE_MODULES.map((folder) => `!${folder}**/*.test.ts`),
    ]);
  });

  it('is what `bun run test:mutation` runs, under the shared lock and through scripts/mutation-run.ts, with no option of its own such as `--ignoreStatic`', () => {
    expect(mutationScript()).toBe('bun scripts/with-lock.ts bun scripts/mutation-run.ts');
    expect(STRYKER_COMMAND).toStrictEqual(['stryker', 'run', 'stryker.config.ts']);
  });
});

describe('vitest.stryker.config.ts', () => {
  it('is the Vitest configuration that Stryker runs the tests with, and no other option of the Vitest runner is set', () => {
    expect(config.vitest).toStrictEqual({ configFile: 'vitest.stryker.config.ts' });
  });

  it('runs the tests of both pure-core modules, at any depth, in one project in Node, and no other test', () => {
    expect(strykerVitestConfig.test?.projects).toStrictEqual([
      {
        test: {
          name: 'pure-core',
          environment: 'node',
          include: PURE_CORE_MODULES.map((folder) => `${folder}**/*.test.ts`),
        },
      },
    ]);
  });

  it("keeps every other option of the project's own configuration, vitest.config.ts", () => {
    expect({
      ...strykerVitestConfig,
      test: { ...strykerVitestConfig.test, projects: vitestConfig.test?.projects },
    }).toStrictEqual(vitestConfig);
  });
});

describe('the cache of the mutation workflow', () => {
  it.each([
    ...STRYKER_SETUP,
    'data/fixtures/trace/spec-id-counts.json',
    'data/fixtures/ai-exchange/extract-json/comment.json',
  ])('starts the CI run afresh after a change to %s, which incremental mode cannot see', (file) => {
    expect(cacheKeyGlobs().some((glob) => path.matchesGlob(file, glob))).toBe(true);
  });

  it('restores only results that were recorded under the same key prefix, and saves those that Stryker records', () => {
    expect(restoreStep().with).toStrictEqual({
      path: INCREMENTAL_FILE,
      'restore-keys': '${{ env.PREFIX }}',
    });
    expect(stepOf(SAVE_STEP).with).toStrictEqual({
      path: INCREMENTAL_FILE,
      key: '${{ steps.incremental.outputs.cache-primary-key }}',
    });
  });
});
