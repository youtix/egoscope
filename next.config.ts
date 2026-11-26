import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

import type { NextConfig } from 'next';

// --- The service worker (F-pwa) ---------------------------------------------------------
// After each production build, src/app/sw.ts is bundled into .next/static/sw.js and started
// with the build's static files, which it precaches; /sw.js serves it, so that it controls
// the whole app. Every build lists other files, so each deployment gives a new worker,
// which is how the app detects a new version (module map section 3.1). The browser checks
// a worker's script past any cache whenever it looks for a new version. `next dev` builds
// no worker.
const SERVICE_WORKER_SOURCE = './src/app/sw.ts';
const SERVICE_WORKER_URL = '/sw.js';
const STATIC_FOLDER = 'static';
const STATIC_URL = '/_next/static/';
const BUILT_SERVICE_WORKER = 'sw.js';
// The part of the list's hash that names a build's version: enough that two builds never
// share one.
const VERSION_LENGTH = 16;

type BuildMetadata = Readonly<{ projectDir: string; distDir: string }>;

/** The URL of every file that the build put in its static folder, in a stable order. */
async function staticFiles(staticFolder: string): Promise<string[]> {
  const entries = await readdir(staticFolder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(staticFolder, path.join(entry.parentPath, entry.name)))
    .map((file) => STATIC_URL + file.split(path.sep).join('/'))
    .toSorted((left, right) => left.localeCompare(right, 'en'));
}

/** Bundles the service worker of src/app/sw.ts with the static files of the build. */
async function buildServiceWorker({ projectDir, distDir }: BuildMetadata): Promise<void> {
  const staticFolder = path.resolve(projectDir, distDir, STATIC_FOLDER);
  const files = await staticFiles(staticFolder);
  const version = createHash('sha256').update(files.join('\n')).digest('hex');
  const shell = { version: version.slice(0, VERSION_LENGTH), files };
  await build({
    stdin: {
      contents: `import { startServiceWorker } from '${SERVICE_WORKER_SOURCE}';\nstartServiceWorker(self, ${JSON.stringify(shell)});\n`,
      loader: 'ts',
      resolveDir: projectDir,
      sourcefile: 'service-worker-entry.ts',
    },
    bundle: true,
    format: 'iife',
    minify: true,
    platform: 'browser',
    target: 'es2024',
    tsconfig: path.join(projectDir, 'tsconfig.json'),
    outfile: path.join(staticFolder, BUILT_SERVICE_WORKER),
    logLevel: 'warning',
  });
}

const nextConfig: NextConfig = {
  // Version-matched Next.js guidance for agents lives in CLAUDE.md, so `next dev`
  // must not write its own AGENTS.md into the working tree.
  agentRules: false,
  // The end-to-end harness builds the hermetic server of each lot into a folder of its
  // own (e2e/fixtures/hermetic-server.ts); every other build uses Next.js's own, .next/.
  distDir: process.env['EGOSCOPE_E2E_BUILD_DIR'] ?? '.next',
  // Routes are prerendered except where they read request-time or uncached data.
  cacheComponents: true,
  partialPrefetching: true,
  // Links and router calls are type-checked against the routes that exist.
  typedRoutes: true,
  poweredByHeader: false,
  // PGlite loads its WebAssembly and data files next to its own module at run
  // time, which bundling would break; Next.js already keeps `pg` external.
  serverExternalPackages: ['@electric-sql/pglite'],
  turbopack: {
    // Each git worktree is its own project, even when nested in another checkout.
    root: import.meta.dirname,
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  // The service worker (F-pwa, above).
  compiler: { runAfterProductionCompile: buildServiceWorker },
  // eslint-disable-next-line @typescript-eslint/require-await -- Next.js reads the rewrites from an async function, and this list is fixed
  rewrites: async () => [
    { source: SERVICE_WORKER_URL, destination: STATIC_URL + BUILT_SERVICE_WORKER },
  ],
};

export default nextConfig;
