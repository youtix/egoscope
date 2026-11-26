// Proves the Next.js configuration: the service worker that each production build bundles
// and serves, and the build folders: every build goes to .next/ and is type-checked with
// tsconfig.json, but the one that the end-to-end harness makes for the Lot 2 hermetic
// server, which goes to a folder of its own with its own route types.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';

import nextConfig from './next.config';

import type { NextConfig } from 'next';

// The static files of a production build, under .next/static/.
const BUILD = [
  '/_next/static/b7Xq/_buildManifest.js',
  '/_next/static/chunks/app-1a2b.js',
  '/_next/static/media/font-9c8d.woff2',
];
const NEXT_BUILD = ['/_next/static/c8Yr/_buildManifest.js', ...BUILD.slice(1)];
const SHELL_CACHE = /^egoscope-shell-[\da-f]{16}$/u;

// Where Next.js writes the route types of a build, under the folder of that build.
const ROUTE_TYPES = /^\.next\//u;

// The part of a TypeScript configuration that says which files it type-checks.
const withInclude = z.object({ include: z.array(z.string()) });

/** The `include` of a TypeScript configuration of the repository, comments allowed. */
function includeOf(file: string): readonly string[] {
  const read: { config?: unknown; error?: ts.Diagnostic } = ts.readConfigFile(
    path.join(import.meta.dirname, file),
    (name) => ts.sys.readFile(name),
  );
  expect(read.error).toBeUndefined();
  return withInclude.parse(read.config).include;
}

/** Runs `call` once the current turn ends, as an answer of the browser does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** A folder of build output that holds `files`, removed when the test ends. */
async function buildOutput(files: readonly string[]): Promise<string> {
  const distDir = await mkdtemp(path.join(tmpdir(), 'egoscope-build-'));
  onTestFinished(async () => rm(distDir, { recursive: true, force: true }));
  for (const file of files) {
    const target = path.join(distDir, file.replace('/_next/', ''));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file);
  }
  return distDir;
}

/**
 * Builds the worker after a build of `files`, runs its script as the browser does, and
 * installs it: returns the events it answers, the cache it opened and the files it added.
 */
async function buildAndInstall(files: readonly string[], config: NextConfig = nextConfig) {
  const distDir = await buildOutput(files);
  await config.compiler?.runAfterProductionCompile?.({
    projectDir: import.meta.dirname,
    distDir,
  });
  const script = await readFile(path.join(distDir, 'static', 'sw.js'), 'utf8');
  type Listener = (event: Readonly<{ waitUntil: (promise: Promise<unknown>) => void }>) => void;
  const listeners = new Map<string, Listener>();
  const opened: string[] = [];
  const added: string[] = [];
  const cache = {
    add: async (file: string) =>
      later(() => {
        added.push(file);
      }),
    put: async () => later(() => undefined),
  };
  const caches = {
    open: async (name: string) =>
      later(() => {
        opened.push(name);
        return cache;
      }),
    match: async () => later(() => undefined),
  };
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    caches,
    location: { origin: 'https://egoscope.test' },
  };
  // eslint-disable-next-line sonarjs/code-eval -- runs the worker script that the build wrote, as the browser does
  runInNewContext(script, { self, URL, Response });
  const pending: Promise<unknown>[] = [];
  listeners.get('install')?.({
    waitUntil: (promise) => {
      pending.push(promise);
    },
  });
  await Promise.all(pending);
  return { events: Array.from(listeners, ([type]) => type), opened, added };
}

/** The configuration, as Next.js loads it in a process whose environment is stubbed. */
async function loadConfig(): Promise<NextConfig> {
  vi.resetModules();
  const { default: config } = await import('./next.config');
  return config;
}

/**
 * The configuration without its hooks, which each load makes anew, so that they are
 * compared by what they do, in the tests of the service worker.
 */
function withoutHooks(config: NextConfig): NextConfig {
  const { compiler, rewrites, ...rest } = config;
  expect(Object.keys(compiler ?? {})).toStrictEqual(['runAfterProductionCompile']);
  expect(rewrites).toBeTypeOf('function');
  return rest;
}

describe('the service worker build', () => {
  it('[TRV-21] [TRV-22] serves the worker that the production build bundles at /sw.js', async () => {
    expect(await nextConfig.rewrites?.()).toStrictEqual([
      { source: '/sw.js', destination: '/_next/static/sw.js' },
    ]);
  });

  it('[TRV-22] bundles src/app/sw.ts into a script that starts the worker with every static file of the build', async () => {
    const worker = await buildAndInstall(BUILD);

    expect(worker.events).toStrictEqual(['install', 'activate', 'fetch', 'message']);
    expect(worker.opened).toHaveLength(1);
    expect(worker.opened[0]).toMatch(SHELL_CACHE);
    expect(worker.added).toStrictEqual(BUILD);
  });

  it('[IHM-03] gives each build a version of its own, so that each deployment brings a new worker', async () => {
    const first = await buildAndInstall(BUILD);
    const same = await buildAndInstall(BUILD);
    const next = await buildAndInstall(NEXT_BUILD);

    expect(same.opened).toStrictEqual(first.opened);
    expect(next.opened).not.toStrictEqual(first.opened);
    expect(next.opened[0]).toMatch(SHELL_CACHE);
  });
});

describe('next.config.ts', () => {
  it.each(['', 'false', 'TRUE', '1'])(
    'builds into .next/, type-checked with tsconfig.json, when EGOSCOPE_E2E_LOT2_BUILD is %j',
    async (value) => {
      vi.stubEnv('EGOSCOPE_E2E_LOT2_BUILD', value);
      const { distDir, typescript } = await loadConfig();

      expect({ distDir, typescript }).toStrictEqual({ distDir: undefined, typescript: undefined });
    },
  );

  it('builds the Lot 2 hermetic server into .next/lot2, type-checked with tsconfig.lot2.json, when the harness sets EGOSCOPE_E2E_LOT2_BUILD=true', async () => {
    vi.stubEnv('EGOSCOPE_E2E_LOT2_BUILD', 'true');
    const { distDir, typescript } = await loadConfig();

    expect({ distDir, typescript }).toStrictEqual({
      distDir: '.next/lot2',
      typescript: { tsconfigPath: 'tsconfig.lot2.json' },
    });
  });

  it('changes nothing else of the configuration for the Lot 2 build', async () => {
    vi.stubEnv('EGOSCOPE_E2E_LOT2_BUILD', '');
    const usual = await loadConfig();
    vi.stubEnv('EGOSCOPE_E2E_LOT2_BUILD', 'true');

    expect(withoutHooks(await loadConfig())).toStrictEqual({
      ...withoutHooks(usual),
      distDir: '.next/lot2',
      typescript: { tsconfigPath: 'tsconfig.lot2.json' },
    });
  });

  it('bundles the worker of the Lot 2 build into the build folder that Next.js passes it and serves it at /sw.js, as for every build', async () => {
    vi.stubEnv('EGOSCOPE_E2E_LOT2_BUILD', 'true');
    const lot2 = await loadConfig();
    const worker = await buildAndInstall(BUILD, lot2);

    expect(worker.added).toStrictEqual(BUILD);
    expect(await lot2.rewrites?.()).toStrictEqual([
      { source: '/sw.js', destination: '/_next/static/sw.js' },
    ]);
  });

  it('type-checks the Lot 2 build with every file of tsconfig.json, its route types taken from .next/lot2 instead of .next', () => {
    const usual = includeOf('tsconfig.json');

    expect(usual).toContain('.next/types/**/*.ts');
    expect(includeOf('tsconfig.lot2.json')).toStrictEqual(
      usual.map((pattern) => pattern.replace(ROUTE_TYPES, '.next/lot2/')),
    );
  });
});
