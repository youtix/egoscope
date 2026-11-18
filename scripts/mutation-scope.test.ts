import { describe, expect, it } from 'vitest';

import { mutationTriggers } from './mutation-scope';

describe('mutationTriggers', () => {
  it.each([
    'src/lib/stats-engine/game-score.ts',
    'src/lib/stats-engine/game-score.test.ts',
    'src/lib/stats-engine/performance/game-score.ts',
    'src/lib/ai-exchange/research-prompt.ts',
    'src/lib/ai-exchange/checks/research-result.test.ts',
    'stryker.config.ts',
    '.github/workflows/mutation.yml',
  ])(
    'runs the mutation tests after a change to %s, in the pure core or the Stryker setup',
    (path) => {
      expect(mutationTriggers(['src/app/page.tsx', path, 'README.md'])).toStrictEqual([path]);
    },
  );

  it('runs them on an upgrade of Stryker, Vitest or fast-check, a new test configuration or a new scope', () => {
    const upgrade = ['package.json', 'bun.lock'];

    expect(mutationTriggers(upgrade)).toStrictEqual(upgrade);
    expect(mutationTriggers(['vitest.config.ts'])).toStrictEqual(['vitest.config.ts']);
    expect(mutationTriggers(['scripts/mutation-scope.ts'])).toStrictEqual([
      'scripts/mutation-scope.ts',
    ]);
  });

  it('names every changed path of the scope, in the order of the changes', () => {
    expect(
      mutationTriggers([
        'bun.lock',
        'src/app/page.tsx',
        'src/lib/stats-engine/game-score.ts',
        'package.json',
      ]),
    ).toStrictEqual(['bun.lock', 'src/lib/stats-engine/game-score.ts', 'package.json']);
  });

  it('does not run them when nothing in the scope changed', () => {
    // A fixture or tsconfig.json starts the next run afresh instead (mutation.yml).
    expect(
      mutationTriggers([
        'src/lib/stats-engine-next/game-score.ts',
        'src/lib/env/server-env.ts',
        'src/app/page.tsx',
        '.github/workflows/ci.yml',
        'docs/07-statistiques-de-match.md',
        'data/fixtures/trace/spec-id-counts.json',
        'tsconfig.json',
      ]),
    ).toStrictEqual([]);
    expect(mutationTriggers([])).toStrictEqual([]);
  });
});
