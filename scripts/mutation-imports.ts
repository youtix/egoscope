/**
 * The files outside the pure core whose change can change what mutation testing finds,
 * read from the imports of the head being tested, the working tree that the mutation
 * gate runs in (mutation-gate.ts), never from a hand-written list:
 *
 * - pureCoreImports: the files that a file of the pure core, a test included, imports,
 *   which are the fixtures of data/ that its tests import as `@data/...`;
 * - setupImports: the files that the configurations of the mutation run
 *   (MUTATION_CONFIGURATIONS) import, directly or through another local file.
 *
 * Files are parsed with the TypeScript compiler, so a comment or a string that names a
 * file imports nothing. Only static imports and re-exports are read (`import x from`,
 * `import '…'`, `export … from`), of a relative path or of a path that tsconfig.json
 * maps; packages are left aside. A test of mutation-imports.test.ts refuses every other
 * way to read a file in the pure core and every other import in the configurations, which
 * would escape this count.
 *
 * The walk reads the imports of every file of code that it reaches, and a fixture ends
 * it: data/ holds no code (CLAUDE.md, and the structure check refuses code there), so a
 * fixture imports nothing and there is no closure to compute through it.
 *
 * The head's imports are enough. A fixture that the base imported and the head no longer
 * does stops being imported only through a change of a file of the pure core, which is in
 * the scope itself; and a fixture that the head imports but that is missing still counts,
 * since its specifier names it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isInPureCore, MUTATION_CONFIGURATIONS, PURE_CORE_MODULES } from './mutation-scope';

/** The prefixes that tsconfig.json maps (`paths`), and the folders that they stand for. */
export const PATH_ALIASES: ReadonlyMap<string, string> = new Map([
  ['@/', 'src/'],
  ['@data/', 'data/'],
]);

// A relative specifier: `.`, `..`, `./x` or `../x`.
const RELATIVE = /^\.\.?(?:\/|$)/u;
// What starts a query that Vite reads, such as `?raw`, which names no other file.
const QUERY = '?';
// What Vite and Bun try, in this order, after a specifier that names no file as it is.
const EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
];
// The files whose imports are read: code. A fixture is data, which imports nothing.
const CODE = /\.[cm]?[jt]sx?$/u;
// The extension of the files of the pure core that Stryker and Vitest read.
const PURE_CORE_EXTENSION = '.ts';

const byPath = (left: string, right: string): number => left.localeCompare(right, 'en');

const isFile = (root: string, file: string): boolean =>
  statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() === true;

const isFolder = (root: string, folder: string): boolean =>
  statSync(path.join(root, folder), { throwIfNoEntry: false })?.isDirectory() === true;

/** `specifier` without the query that it may end with. */
function withoutQuery(specifier: string): string {
  const query = specifier.indexOf(QUERY);
  return query === -1 ? specifier : specifier.slice(0, query);
}

/** The specifiers of the static imports and re-exports of `text`, the source of `file`. */
function moduleSpecifiers(file: string, text: string): readonly string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
      return [];
    }
    const specifier = statement.moduleSpecifier;
    return specifier !== undefined && ts.isStringLiteral(specifier) ? [specifier.text] : [];
  });
}

/** The repository path that `specifier`, imported by `from`, names, or undefined for a package. */
function localTarget(from: string, specifier: string): string | undefined {
  if (RELATIVE.test(specifier)) {
    return path.posix.join(path.posix.dirname(from), specifier);
  }
  const alias = [...PATH_ALIASES].find(([prefix]) => specifier.startsWith(prefix));
  if (alias === undefined) {
    return undefined;
  }
  const [prefix, folder] = alias;
  return path.posix.normalize(`${folder}${specifier.slice(prefix.length)}`);
}

/**
 * The files that `specifier`, imported by `from`, loads: none for a package, the first
 * file that resolution finds, or, when it finds none, every file that it tries, so that
 * the file counts whichever of them the head adds or removes.
 */
function resolveImport(root: string, from: string, specifier: string): readonly string[] {
  const target = localTarget(from, withoutQuery(specifier));
  if (target === undefined) {
    return [];
  }
  const tried = [
    target,
    ...EXTENSIONS.map((extension) => `${target}${extension}`),
    ...EXTENSIONS.map((extension) => `${target}/index${extension}`),
  ];
  const found = tried.find((file) => isFile(root, file));
  return found === undefined ? tried : [found];
}

/** The local files that `file` imports, if it is code that exists. */
function importsOf(root: string, file: string): readonly string[] {
  if (!CODE.test(file) || !isFile(root, file)) {
    return [];
  }
  const text = readFileSync(path.join(root, file), 'utf8');
  return moduleSpecifiers(file, text).flatMap((specifier) => resolveImport(root, file, specifier));
}

/** The local files that `entries` import, directly or through other local files, sorted. */
function importClosure(root: string, entries: readonly string[]): readonly string[] {
  const reached = new Set<string>();
  const visit = (file: string): void => {
    for (const imported of importsOf(root, file)) {
      if (reached.has(imported)) {
        continue;
      }
      reached.add(imported);
      visit(imported);
    }
  };
  for (const entry of entries) {
    visit(entry);
  }
  return [...reached].toSorted(byPath);
}

/** Every file of the pure core under `root`, tests included, repository-relative. */
export function pureCoreFiles(root: string): readonly string[] {
  return PURE_CORE_MODULES.flatMap((folder) =>
    isFolder(root, folder)
      ? readdirSync(path.join(root, folder), { recursive: true, encoding: 'utf8' })
          .map((file) => `${folder}${file.split(path.sep).join('/')}`)
          .filter((file) => file.endsWith(PURE_CORE_EXTENSION))
      : [],
  );
}

/**
 * The files outside the pure core that a file of the pure core under `root` imports,
 * directly or not: the fixtures of data/ that its tests read, repository-relative.
 */
export function pureCoreImports(root: string): readonly string[] {
  return importClosure(root, pureCoreFiles(root)).filter((file) => !isInPureCore(file));
}

/**
 * The files under `root` that the configurations of the mutation run import, directly
 * or through another local file, repository-relative.
 */
export function setupImports(root: string): readonly string[] {
  return importClosure(root, MUTATION_CONFIGURATIONS);
}
