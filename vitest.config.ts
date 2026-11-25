import path from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';

// The extensions let Vite's native config loader, Node itself, import the files.
import { GENERATED_FOLDERS } from './scripts/generated-files.ts';
import { IGNORED_FOLDERS } from './scripts/ignored-folders.ts';
import { ROUTE_SHELLS } from './scripts/route-shells.ts';
import { isShardOfSeveral } from './scripts/vitest-shard.ts';

import type { ViteUserConfig } from 'vitest/config';

// Several agents share one small machine: locally, tests use at most half the
// cores. CI runners are dedicated, so CI keeps Vitest's default.
const isCi = process.env['CI'] === 'true';

// CI runs the unit suite in shards (`--shard=<index>/<count>`), and a shard runs only
// part of the tests of a file, so it cannot meet the thresholds set for the whole
// suite: such a run alone leaves them out, and CI's `coverage` job judges them once,
// on the merged reports of the shards. Every other run judges them, `bun run
// test:coverage` and that merge included. The switch is here because Vitest's
// command line cannot override the thresholds of the globs below.
const isShard = isShardOfSeveral(process.argv);

// The other agents' worktrees. The include globs below never enter a dot folder
// anyway; this says so explicitly.
const exclude = [...configDefaults.exclude, ...IGNORED_FOLDERS.map((folder) => `${folder}**`)];

// The variables of the server environment (src/lib/env/server-env.ts) that every
// test starts without, whatever the shell exports: it may export the production
// connection strings (TRV-76), and the environment is valid or invalid as one
// whole. Empty, which the schema reads as unset; a test stubs what it needs. A
// test of src/lib/env fails when a variable of the schema is missing here.
const UNSET_SERVER_VARIABLES = [
  'LOG_LEVEL',
  'VERCEL_ENV',
  'VERCEL_DEPLOYMENT_ID',
  'APP_BASE_URL',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'CRON_SECRET',
  'INITIAL_PASSWORD',
  'FINGERPRINT_KEY',
  'BACKUP_GITHUB_REPOSITORY',
  'BACKUP_GITHUB_TOKEN',
  'BACKUP_ENCRYPTION_KEY',
  'STATS_SOURCE_BASE_URL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_AI_API_TOKEN',
  'GROQ_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'EGOSCOPE_LOT',
  'EGOSCOPE_FAKES',
];

// The environment that every test starts from: no variable of the server set,
// and NODE_ENV as Vitest sets it.
const serverEnvironment = {
  ...Object.fromEntries(UNSET_SERVER_VARIABLES.map((name) => [name, ''])),
  NODE_ENV: 'test' as const,
};

// Refuses every connection a test would make to the network (module map §5), before
// any test of either project runs.
const NETWORK_GUARD = './vitest.network-guard.ts';

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
    env: serverEnvironment,
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
          setupFiles: [NETWORK_GUARD],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          exclude,
          setupFiles: [NETWORK_GUARD, './vitest.dom-setup.ts'],
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
      ...(!isShard && {
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
      }),
    },
  },
});

export default config;
