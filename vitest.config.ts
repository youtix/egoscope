import path from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';

// The extensions let Vite's native config loader, Node itself, import the files.
import { GENERATED_FOLDERS } from './scripts/generated-files.ts';
import { IGNORED_FOLDERS } from './scripts/ignored-folders.ts';
import { ROUTE_SHELLS } from './scripts/route-shells.ts';

import type { ViteUserConfig } from 'vitest/config';

// Several agents share one small machine: locally, tests use at most half the
// cores. CI runners are dedicated, so CI keeps Vitest's default.
const isCi = process.env['CI'] === 'true';

// The other agents' worktrees. The include globs below never enter a dot folder
// anyway; this says so explicitly.
const exclude = [...configDefaults.exclude, ...IGNORED_FOLDERS.map((folder) => `${folder}**`)];

const config: ViteUserConfig = defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside a React Server Components bundle; tests run in plain Node.
      'server-only': path.join(import.meta.dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    ...(!isCi && { maxWorkers: '50%' }),
    allowOnly: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', '*.test.ts'],
          exclude,
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          exclude,
          setupFiles: ['./vitest.dom-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Listing every source file makes untested files count as uncovered.
      include: ['src/**/*.{ts,tsx,mts,cts}'],
      // Route shells are left out (scripts/route-shells.ts says which, and why), and
      // so are generated files (scripts/generated-files.ts).
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        ...ROUTE_SHELLS,
        ...GENERATED_FOLDERS.map((folder) => `${folder}**`),
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        // Never lower these: add the missing tests instead.
        perFile: true,
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        'src/lib/stats-engine/**': { 100: true, perFile: true },
        'src/lib/ai-exchange/**': { 100: true, perFile: true },
      },
    },
  },
});

export default config;
