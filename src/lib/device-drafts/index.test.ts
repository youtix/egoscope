import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The device half runs in a browser (module map, `device-drafts`): none of its production
// files may reach a server module, directly or through another module. A lint rule will
// take this check over with the tooling batch.
const SRC_LIB = path.join(import.meta.dirname, '..');
const SERVER_MODULES: ReadonlySet<string> = new Set([
  'server-only',
  '@/lib/db',
  '@/lib/params',
  '@/lib/env',
  '@/lib/log',
  '@/lib/drafts',
]);
// The Node APIs, which a browser lacks, under the `node:` prefix or their bare names.
const NODE_PREFIX = 'node:';
const BARE_NODE_MODULES: ReadonlySet<string> = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'stream',
  'url',
  'util',
  'worker_threads',
  'zlib',
]);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const TEST_FILE = /\.test\.tsx?$/;

/** A file to read, with the chain of imports that led to it. */
type Visit = Readonly<{ file: string; chain: readonly string[] }>;

/** Says whether `specifier` names a server module or a Node API. */
function isServerModule(specifier: string): boolean {
  return (
    SERVER_MODULES.has(specifier) ||
    specifier.startsWith(NODE_PREFIX) ||
    BARE_NODE_MODULES.has(specifier)
  );
}

/** The source file that `specifier`, imported from `fromFile`, resolves to, `null` for a package. */
function resolve(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/lib/')) {
    base = path.join(SRC_LIB, specifier.slice('@/lib/'.length));
  } else if (specifier.startsWith('.')) {
    base = path.join(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`Cannot resolve ${specifier} from ${fromFile}.`);
  }
  return found;
}

/**
 * Reads the module references of `visit`'s file, of every kind (imports, type-only ones
 * included, re-exports and `import()`): records each server module it names in `reached`,
 * and returns the source files it leads to.
 */
function step(visit: Visit, reached: string[]): Visit[] {
  const { importedFiles } = ts.preProcessFile(readFileSync(visit.file, 'utf8'), true, true);
  const next: Visit[] = [];
  for (const { fileName: specifier } of importedFiles) {
    const chain = [...visit.chain, specifier];
    const target = isServerModule(specifier) ? null : resolve(specifier, visit.file);
    if (isServerModule(specifier)) {
      reached.push(chain.join(' -> '));
    } else if (target !== null) {
      next.push({ file: target, chain });
    }
  }
  return next;
}

/**
 * Every server module or Node API that the production files of `folder` reach, each with
 * the chain of files that leads to it.
 */
function serverModulesReachedFrom(folder: string): string[] {
  const queue: Visit[] = readdirSync(folder)
    .filter((name) => SOURCE_EXTENSIONS.includes(path.extname(name)) && !TEST_FILE.test(name))
    .map((name) => path.join(folder, name))
    .map((file) => ({ file, chain: [path.relative(SRC_LIB, file)] }));
  const reached: string[] = [];
  const seen = new Set<string>();
  for (let visit = queue.shift(); visit !== undefined; visit = queue.shift()) {
    if (seen.has(visit.file)) {
      continue;
    }
    seen.add(visit.file);
    queue.push(...step(visit, reached));
  }
  return reached;
}

describe('the device half of the drafts, which runs in a browser', () => {
  it('[IHM-42] reaches no server module and no Node API from any of its production files', () => {
    expect(serverModulesReachedFrom(import.meta.dirname)).toStrictEqual([]);
  });

  it('[IHM-42] finds the server modules that the server half of the drafts reaches', () => {
    const reached = serverModulesReachedFrom(path.join(SRC_LIB, 'drafts'));

    expect(reached).toContain('drafts/server-drafts.ts -> server-only');
    expect(reached).toContain('drafts/server-drafts.ts -> @/lib/db');
    expect(reached).toContain('drafts/server-drafts.ts -> @/lib/params');
  });
});
