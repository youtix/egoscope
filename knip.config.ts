import { IGNORED_FOLDERS } from './scripts/ignored-folders';

import type { KnipConfig } from 'knip';

// Finds unused files, exports and dependencies. Next.js routes, tests, configs and
// package scripts are found by Knip's plugins; only project-specific entries are
// listed here.
const config: KnipConfig = {
  entry: [
    // A module publishes its API in index.ts, often before its first consumer
    // lands, so these files are entry points. Unused code inside a module is
    // still reported.
    'src/lib/*/index.ts',
    // Started through scripts/with-lock.ts, where Knip does not look for entries.
    'scripts/check-changed.ts',
  ],
  // The other agents' worktrees are not part of this project.
  project: ['**/*.{ts,tsx,mts,cts,css}', ...IGNORED_FOLDERS.map((folder) => `!${folder}**`)],
  // A system tool from util-linux, not an npm package.
  ignoreBinaries: ['flock'],
};

export default config;
