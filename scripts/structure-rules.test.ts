import { describe, expect, it } from 'vitest';

import { findStructureViolations } from './structure-rules';

const VALID_LAYOUT = [
  'README.md',
  'eslint.config.ts',
  'eslint.config.test.ts',
  'data/README.md',
  'data/fixtures/box-scores.json',
  'scripts/with-lock.ts',
  'src/proxy.ts',
  'src/app/favicon.ico',
  'src/app/globals.css',
  'src/app/layout.tsx',
  'src/app/manifest.json',
  'src/app/page.tsx',
  'src/app/page.test.tsx',
  'src/app/(account)/sign-in/page.tsx',
  'src/app/@modal/(..)players/page.tsx',
  'src/app/api/health/route.ts',
  'src/app/api/health/route.test.ts',
  'src/app/players/[playerId]/page.tsx',
  'src/app/players/[playerId]/player-card.tsx',
  'src/app/docs/[...slug]/page.tsx',
  'src/app/shop/[[...filters]]/page.tsx',
  'src/lib/env/index.ts',
  'src/lib/env/server-env.ts',
  'src/lib/env/server-env.test.ts',
  'src/lib/stats-engine/index.ts',
  'src/lib/stats-engine/reference/season-reference.ts',
];

function problemsFor(paths: readonly string[]): readonly string[] {
  return findStructureViolations(paths).map(
    (violation) => `${violation.path}: ${violation.problem}`,
  );
}

describe('findStructureViolations', () => {
  it('accepts the documented layout, Next.js route segments included', () => {
    expect(findStructureViolations(VALID_LAYOUT)).toStrictEqual([]);
  });

  it.each([
    ['src/lib/stats-engine/reference/seasons/season.ts', 'Too deep'],
    ['src/lib/helpers.ts', 'module folder'],
    ['src/app/players/_components/card.tsx', 'private _folders'],
    ['src/components/button.tsx', 'only app/ and lib/'],
    ['src/utils.ts', 'only app/ and lib/'],
  ])('module rule 5: rejects %s', (path, problem) => {
    const paths = [...VALID_LAYOUT, path];

    expect(problemsFor(paths).join('\n')).toContain(`${path}: `);
    expect(problemsFor(paths).join('\n')).toContain(problem);
  });

  it.each([
    ['src/lib/env/serverEnv.ts', 'File name "serverEnv.ts"'],
    ['src/lib/env/Server_Env.test.ts', 'File name "Server_Env.test.ts"'],
    ['src/lib/statsEngine/index.ts', 'Folder "statsEngine"'],
    ['src/app/Players/page.tsx', 'Folder "Players"'],
    ['src/app/players/[player_id]/page.tsx', 'Folder "[player_id]"'],
    ['data/Raw Data/seasons.json', 'Folder "Raw Data"'],
    ['scripts/__tests__/gate.test.ts', 'Folder "__tests__"'],
  ])('module rule 6: rejects the name in %s', (path, problem) => {
    expect(problemsFor([...VALID_LAYOUT, path]).join('\n')).toContain(problem);
  });

  it('module rule 4: rejects a module without an index.ts', () => {
    const paths = [...VALID_LAYOUT, 'src/lib/time/instant.ts'];

    expect(problemsFor(paths)).toStrictEqual([
      'src/lib/time/: A module exposes its public API through its index.ts (module rule 4).',
    ]);
  });

  it.each([
    ['data/seed.ts', 'data/ holds data only'],
    ['src/lib/env/players.csv', 'belong in data/'],
    ['src/lib/env/fixture.json', 'belong in data/'],
    ['src/lib/env/globals.d.ts', 'No hand-written .d.ts'],
    ['src/lib/env/legacy.js', 'TypeScript only'],
  ])('keeps code and data apart: rejects %s', (path, problem) => {
    expect(problemsFor([...VALID_LAYOUT, path]).join('\n')).toContain(problem);
  });

  it('rejects a test that does not sit next to the file it tests', () => {
    const paths = [...VALID_LAYOUT, 'src/lib/env/parse.test.ts'];

    expect(problemsFor(paths)).toStrictEqual([
      'src/lib/env/parse.test.ts: A test sits next to the file it tests: foo.test.ts beside foo.ts.',
    ]);
  });
});
