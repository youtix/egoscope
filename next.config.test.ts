import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, onTestFinished } from 'vitest';

import nextConfig from './next.config';

// The static files of a production build, under .next/static/.
const BUILD = [
  '/_next/static/b7Xq/_buildManifest.js',
  '/_next/static/chunks/app-1a2b.js',
  '/_next/static/media/font-9c8d.woff2',
];
const NEXT_BUILD = ['/_next/static/c8Yr/_buildManifest.js', ...BUILD.slice(1)];
const SHELL_CACHE = /^egoscope-shell-[\da-f]{16}$/u;

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
async function buildAndInstall(files: readonly string[]) {
  const distDir = await buildOutput(files);
  await nextConfig.compiler?.runAfterProductionCompile?.({
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
