import path from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';

import type { ViteUserConfig } from 'vitest/config';

// Files that Next.js renders itself. Lint keeps them unable to hold logic (see the
// route-shell rules in eslint.config.ts), and they are left out of unit coverage.
// Route handlers (route.ts) are not shells: they are covered.
const ROUTE_SHELLS =
  'src/app/**/{page,layout,template,loading,error,global-error,not-found,global-not-found,forbidden,unauthorized,default}.{ts,tsx}';

// Several agents share one small machine: locally, tests use at most half the
// cores. CI runners are dedicated, so CI keeps Vitest's default.
const isCi = process.env['CI'] === 'true';

// The other agents' worktrees (the folders of scripts/ignored-folders.ts, repeated
// here because Vite's native config loader takes no extensionless imports). The
// include globs below never enter a dot folder anyway; this says so explicitly.
const exclude = [...configDefaults.exclude, '.claude/**'];

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
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', ROUTE_SHELLS],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        // Never lower these: add the missing tests instead.
        perFile: true,
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        'src/lib/stats-engine/**': { 100: true, perFile: true },
      },
    },
  },
});

export default config;
