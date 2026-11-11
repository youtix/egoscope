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
  ],
  project: ['**/*.{ts,tsx,mts,css}'],
};

export default config;
