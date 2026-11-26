// Proves that the mutation scope reads the fixtures and the setup files from the imports
// of the tree: in throwaway trees, with exact paths, and on this tree, where a walk of
// every node of the syntax tree checks that nothing reaches a file in a way that the
// scanner does not read.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it, onTestFinished } from 'vitest';

import { PATH_ALIASES, pureCoreFiles, pureCoreImports, setupImports } from './mutation-imports';
import { MUTATION_CONFIGURATIONS } from './mutation-scope';

const ROOT = path.join(import.meta.dirname, '..');
const DATA_ALIAS = '@data/';
// Every file that the scanner tries, in this order, after a specifier that names no file.
const TRIED_SUFFIXES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/** A throwaway tree that holds `files` (repository-relative path to text), removed when the test ends. */
function treeWith(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'egoscope-mutation-imports-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

// The names under which code may load a file with CommonJS.
const REQUIRE_NAMES: ReadonlySet<string> = new Set(['require', 'createRequire']);

/** What a walk of every node of a file finds. */
type Reads = Readonly<{
  // The specifiers of the static imports and re-exports, which the scanner reads.
  specifiers: readonly string[];
  // Every other import, as `file:line: what`.
  otherImports: readonly string[];
  // Every use of import.meta, and every string outside a specifier that names data/.
  otherReads: readonly string[];
}>;

/** Says whether `node` is the specifier of a static import or re-export. */
function isStaticSpecifier(node: ts.Node): boolean {
  if (!ts.isStringLiteral(node)) {
    return false;
  }
  const { parent } = node;
  return (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  );
}

/** What `node` is, when it imports a file in a way that the scanner does not read. */
function otherImport(node: ts.Node): string | undefined {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return 'a dynamic import()';
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return 'an import = require()';
  }
  return ts.isIdentifier(node) && REQUIRE_NAMES.has(node.text)
    ? `a use of ${node.text}`
    : undefined;
}

/** What `node` is, when it may read a file otherwise: import.meta, or a string that names data/. */
function otherRead(node: ts.Node): string | undefined {
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
    return 'a use of import.meta';
  }
  return (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) &&
    !isStaticSpecifier(node) &&
    node.text.includes('data/')
    ? `a string that names data/: ${JSON.stringify(node.text)}`
    : undefined;
}

/** Walks every node of `text`, the source of `file`. */
function readsOf(file: string, text: string): Reads {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const otherImports: string[] = [];
  const otherReads: string[] = [];
  const at = (node: ts.Node, what: string): string => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return `${file}:${String(line + 1)}: ${what}`;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && isStaticSpecifier(node)) {
      specifiers.push(node.text);
    }
    const imported = otherImport(node);
    if (imported !== undefined) {
      otherImports.push(at(node, imported));
    }
    const read = otherRead(node);
    if (read !== undefined) {
      otherReads.push(at(node, read));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, otherImports, otherReads };
}

const readsOfFile = (file: string): Reads =>
  readsOf(file, readFileSync(path.join(ROOT, file), 'utf8'));

describe('setupImports', () => {
  it('follows the static imports and re-exports of the configurations, through other local files, packages aside', () => {
    const root = treeWith({
      'stryker.config.ts': [
        "import path from 'node:path';",
        "import type { Stryker } from '@stryker-mutator/core';",
        "import { a } from './scripts/a.ts';",
        "import './scripts/side-effect.ts';",
        "export { b } from './scripts/b';",
        "export * from './scripts/c';",
        'export { path };',
        "// import './scripts/commented.ts';",
        'const quoted = "import \'./scripts/quoted.ts\'";',
      ].join('\n'),
      'vitest.stryker.config.ts': "import config from './vitest.config.ts';\n",
      'vitest.config.ts': "import { d } from './scripts/d.ts';\n",
      'scripts/mutation-run.ts': "import { a } from './a';\n",
      'scripts/a.ts': "import { e } from './nested/e';\n",
      'scripts/nested/e.ts': "import { a } from '../a';\n",
      'scripts/b.ts': '',
      'scripts/c.ts': '',
      'scripts/d.ts': '',
      'scripts/side-effect.ts': '',
      'scripts/commented.ts': '',
      'scripts/quoted.ts': '',
    });

    expect(setupImports(root)).toStrictEqual([
      'scripts/a.ts',
      'scripts/b.ts',
      'scripts/c.ts',
      'scripts/d.ts',
      'scripts/nested/e.ts',
      'scripts/side-effect.ts',
      'vitest.config.ts',
    ]);
  });

  it('resolves an extension-less specifier, the index of a folder, the paths of tsconfig.json and a query', () => {
    const root = treeWith({
      'stryker.config.ts': [
        "import { thing } from '@/lib/thing';",
        "import fixture from '@data/fixtures/f.json';",
        "import text from '@data/fixtures/t.txt?raw';",
        "import { y } from './scripts/y';",
      ].join('\n'),
      'src/lib/thing/index.ts': "import other from '@data/fixtures/g.json';\n",
      'data/fixtures/f.json': '{}',
      'data/fixtures/g.json': '{}',
      // A fixture ends the walk: the imports that its text shows are no code.
      'data/fixtures/t.txt': "import './scripts/never.ts';\n",
      'scripts/never.ts': '',
      'scripts/y.ts': '',
      'scripts/y.json': '{}',
    });

    expect(setupImports(root)).toStrictEqual([
      'data/fixtures/f.json',
      'data/fixtures/g.json',
      'data/fixtures/t.txt',
      'scripts/y.ts',
      'src/lib/thing/index.ts',
    ]);
  });

  it('counts every file that an import of a missing file may name, so that adding or removing it counts', () => {
    const root = treeWith({ 'vitest.config.ts': "import { gone } from './scripts/gone';\n" });
    const tried = ['', ...TRIED_SUFFIXES, ...TRIED_SUFFIXES.map((suffix) => `/index${suffix}`)].map(
      (suffix) => `scripts/gone${suffix}`,
    );

    expect(new Set(setupImports(root))).toStrictEqual(new Set(tried));
    expect(setupImports(root)).toHaveLength(tried.length);
  });

  it('pins the files that the configurations of the mutation run import on this tree', () => {
    expect(setupImports(ROOT)).toStrictEqual([
      'scripts/generated-files.ts',
      'scripts/ignored-folders.ts',
      'scripts/mutation-scope.ts',
      'scripts/route-shells.ts',
      'scripts/signal-relay.ts',
      'scripts/vitest-shard.ts',
      'vitest.config.ts',
    ]);
  });

  it('finds no other import in the configurations or the files that they import, which the closure would not reach', () => {
    const files = [...MUTATION_CONFIGURATIONS, ...setupImports(ROOT)];

    expect(files.flatMap((file) => readsOfFile(file).otherImports)).toStrictEqual([]);
  });
});

describe('pureCoreImports', () => {
  it('finds the files outside the pure core that its .ts files import, its own files aside', () => {
    const root = treeWith({
      'src/lib/ai-exchange/extract.test.ts': [
        "import comment from '@data/fixtures/ai-exchange/comment.json';",
        "import { extract } from './extract';",
        "import { z } from 'zod';",
      ].join('\n'),
      'src/lib/ai-exchange/extract.ts': '',
      'src/lib/stats-engine/profiles/evaluate.test.ts':
        "export { default } from '@data/fixtures/stats-engine/params.json';\n",
      'src/lib/stats-engine/notes.md': "import notes from '@data/fixtures/notes.json';\n",
      'data/fixtures/ai-exchange/comment.json': '{}',
      'data/fixtures/stats-engine/params.json': '{}',
      'data/fixtures/telegram/answers.json': '{}',
      'data/fixtures/notes.json': '{}',
    });

    expect(pureCoreImports(root)).toStrictEqual([
      'data/fixtures/ai-exchange/comment.json',
      'data/fixtures/stats-engine/params.json',
    ]);
  });

  it('finds no file outside the pure core in a tree without one', () => {
    expect(pureCoreImports(treeWith({ 'data/fixtures/f.json': '{}' }))).toStrictEqual([]);
  });

  it('returns on this tree exactly the fixtures that the `@data/` specifiers of the pure core name', () => {
    const named = new Set(
      pureCoreFiles(ROOT).flatMap((file) =>
        readsOfFile(file)
          .specifiers.filter((specifier) => specifier.startsWith(DATA_ALIAS))
          .map((specifier) => `data/${specifier.slice(DATA_ALIAS.length)}`),
      ),
    );

    expect(named).toContain('data/fixtures/ai-exchange/extract-json/comment.json');
    expect(new Set(pureCoreImports(ROOT))).toStrictEqual(named);
    expect(pureCoreImports(ROOT)).toHaveLength(named.size);
  });

  it('finds on this tree no other way for the pure core to read a file, which the count would miss', () => {
    const reads = pureCoreFiles(ROOT).flatMap((file) => {
      const found = readsOfFile(file);
      return [...found.otherImports, ...found.otherReads];
    });

    expect(pureCoreFiles(ROOT)).toContain('src/lib/ai-exchange/extract-json.test.ts');
    expect(reads).toStrictEqual([]);
  });

  it('maps the specifiers as tsconfig.json maps its paths', () => {
    const read = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), (file) =>
      ts.sys.readFile(file),
    );
    const config: unknown = read.config;
    const paths = Object.fromEntries(
      [...PATH_ALIASES].map(([prefix, folder]) => [`${prefix}*`, [`./${folder}*`]]),
    );

    expect(config).toMatchObject({ compilerOptions: { paths } });
    expect(paths).toStrictEqual({ '@/*': ['./src/*'], '@data/*': ['./data/*'] });
  });
});

describe('the walk that guards the scope', () => {
  it('reports each other way to import or read a file, with its file and line', () => {
    const text = [
      "import fixture from '@data/fixtures/f.json';",
      "const later = await import('@data/fixtures/g.json');",
      "const loaded = require('./h.json');",
      "import other = require('./i');",
      'const here = import.meta.dirname;',
      "const named = 'data/fixtures/j.json';",
      'const built = `../data/${here}`;',
      '// data/fixtures/k.json, in a comment, reads nothing.',
    ].join('\n');

    expect(readsOf('src/lib/stats-engine/probe.test.ts', text)).toStrictEqual({
      specifiers: ['@data/fixtures/f.json'],
      otherImports: [
        'src/lib/stats-engine/probe.test.ts:2: a dynamic import()',
        'src/lib/stats-engine/probe.test.ts:3: a use of require',
        'src/lib/stats-engine/probe.test.ts:4: an import = require()',
      ],
      otherReads: [
        'src/lib/stats-engine/probe.test.ts:2: a string that names data/: "@data/fixtures/g.json"',
        'src/lib/stats-engine/probe.test.ts:5: a use of import.meta',
        'src/lib/stats-engine/probe.test.ts:6: a string that names data/: "data/fixtures/j.json"',
        'src/lib/stats-engine/probe.test.ts:7: a string that names data/: "../data/"',
      ],
    });
  });
});
