import { describe, expect, it } from 'vitest';

import { isInMutationScope } from './mutation-scope';

describe('isInMutationScope', () => {
  it.each([
    'src/lib/stats-engine/game-score.ts',
    'src/lib/stats-engine/game-score.test.ts',
    'src/lib/stats-engine/performance/game-score.ts',
    'src/lib/ai-exchange/research-prompt.ts',
    'src/lib/ai-exchange/checks/research-result.test.ts',
    'stryker.config.ts',
    '.github/workflows/mutation.yml',
  ])('counts a change to %s', (path) => {
    expect(isInMutationScope(path)).toBe(true);
  });

  it.each([
    'src/lib/stats-engine-next/game-score.ts',
    'src/lib/env/server-env.ts',
    'src/app/page.tsx',
    'vitest.config.ts',
    '.github/workflows/ci.yml',
    'docs/07-statistiques-de-match.md',
  ])('ignores a change to %s, outside the pure core and the Stryker setup', (path) => {
    expect(isInMutationScope(path)).toBe(false);
  });
});
