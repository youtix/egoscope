import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pureCoreImports, setupImports } from './mutation-imports';
import { mutationTriggers } from './mutation-scope';

const ROOT = path.join(import.meta.dirname, '..');
// What the pure core and the configurations of the mutation run import on this tree.
const IMPORTED: ReadonlySet<string> = new Set([...pureCoreImports(ROOT), ...setupImports(ROOT)]);

describe('mutationTriggers', () => {
  it.each([
    'src/lib/stats-engine/game-score.ts',
    'src/lib/stats-engine/game-score.test.ts',
    'src/lib/stats-engine/performance/game-score.ts',
    'src/lib/ai-exchange/research-prompt.ts',
    'src/lib/ai-exchange/checks/research-result.test.ts',
    'stryker.config.ts',
    'scripts/mutation-run.ts',
    'vitest.stryker.config.ts',
    'vitest.config.ts',
    '.github/workflows/mutation.yml',
  ])(
    'runs the mutation tests after a change to %s, in the pure core or the Stryker setup',
    (file) => {
      expect(mutationTriggers(['src/app/page.tsx', file, 'README.md'], new Set())).toStrictEqual([
        file,
      ]);
    },
  );

  it.each([
    'scripts/mutation-scope.ts',
    'scripts/ignored-folders.ts',
    'scripts/generated-files.ts',
    'scripts/route-shells.ts',
    'scripts/vitest-shard.ts',
    'scripts/signal-relay.ts',
  ])('runs them after a change to %s, which a configuration of the run imports', (file) => {
    expect(mutationTriggers([file], IMPORTED)).toStrictEqual([file]);
    expect(mutationTriggers([file], new Set())).toStrictEqual([]);
  });

  it('runs them after a change to a fixture that a test of the pure core imports', () => {
    const fixture = 'data/fixtures/ai-exchange/extract-json/comment.json';

    expect(mutationTriggers([fixture], IMPORTED)).toStrictEqual([fixture]);
    expect(mutationTriggers([fixture], new Set())).toStrictEqual([]);
  });

  it.each([
    'data/fixtures/telegram/answers.json',
    'data/fixtures/stats-source/season/game-log.json',
    'data/README.md',
  ])('does not run them after a change to %s, which no file of the pure core imports', (file) => {
    expect(mutationTriggers([file], IMPORTED)).toStrictEqual([]);
  });

  it('runs them after a change to tsconfig.json alone, whose paths resolve `@data/`', () => {
    expect(mutationTriggers(['tsconfig.json'], new Set())).toStrictEqual(['tsconfig.json']);
  });

  it('runs them on an upgrade of Stryker, Vitest or fast-check', () => {
    const upgrade = ['package.json', 'bun.lock'];

    expect(mutationTriggers(upgrade, new Set())).toStrictEqual(upgrade);
  });

  it('names every changed path of the scope, in the order of the changes', () => {
    expect(
      mutationTriggers(
        [
          'bun.lock',
          'src/app/page.tsx',
          'data/fixtures/stats-engine/engine-params.json',
          'src/lib/stats-engine/game-score.ts',
          'package.json',
        ],
        IMPORTED,
      ),
    ).toStrictEqual([
      'bun.lock',
      'data/fixtures/stats-engine/engine-params.json',
      'src/lib/stats-engine/game-score.ts',
      'package.json',
    ]);
  });

  it('does not run them when nothing in the scope changed', () => {
    expect(
      mutationTriggers(
        [
          'src/lib/stats-engine-next/game-score.ts',
          'src/lib/env/server-env.ts',
          'src/app/page.tsx',
          '.github/workflows/ci.yml',
          'docs/07-statistiques-de-match.md',
          'scripts/mutation-gate.ts',
          'scripts/mutation-imports.ts',
          'scripts/mutation-scope.test.ts',
          'tsconfig.pure-core.json',
          'database/fixture.json',
        ],
        IMPORTED,
      ),
    ).toStrictEqual([]);
    expect(mutationTriggers([], IMPORTED)).toStrictEqual([]);
  });
});
