// Proves that coverage leaves out exactly the route shells that lint keeps thin,
// and the generated files: the configuration reads scripts/route-shells.ts and
// scripts/generated-files.ts. Also proves that it holds the pure core to 100%.
import { describe, expect, it } from 'vitest';

import { GENERATED_FOLDERS } from './scripts/generated-files';
import { ROUTE_SHELLS } from './scripts/route-shells';
import config from './vitest.config';

describe('vitest.config.ts', () => {
  it('leaves the route shells and the generated files out of coverage, and nothing else', () => {
    const exclude = config.test?.coverage?.exclude ?? [];

    expect(exclude).toStrictEqual([
      'src/**/*.test.{ts,tsx}',
      'src/**/*.d.ts',
      ...ROUTE_SHELLS,
      ...GENERATED_FOLDERS.map((folder) => `${folder}**`),
    ]);
  });

  it('holds every file of both pure-core modules to 100% coverage', () => {
    expect(config.test?.coverage?.thresholds).toMatchObject({
      'src/lib/stats-engine/**': { 100: true, perFile: true },
      'src/lib/ai-exchange/**': { 100: true, perFile: true },
    });
  });
});
