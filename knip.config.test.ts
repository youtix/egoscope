// Proves that knip reads every TypeScript and CSS file but those of the folders
// that no tool may read and of the generated files: the configuration reads
// scripts/ignored-folders.ts and scripts/generated-files.ts.
import { describe, expect, it } from 'vitest';

import config from './knip.config';
import { GENERATED_FOLDERS } from './scripts/generated-files';
import { IGNORED_FOLDERS } from './scripts/ignored-folders';

describe('knip.config.ts', () => {
  it('leaves the ignored and generated folders out of the project, and nothing else', () => {
    expect(config).toHaveProperty('project', [
      '**/*.{ts,tsx,mts,cts,css}',
      ...IGNORED_FOLDERS.map((folder) => `!${folder}**`),
      ...GENERATED_FOLDERS.map((folder) => `!${folder}**`),
    ]);
  });
});
