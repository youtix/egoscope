// Proves that tsconfig.pure-core.json gives the pure core the ECMAScript library
// only: a Node.js or DOM global used there is a type error, and no Node or DOM
// declaration file is part of the program at all.
//
// Each test builds a TypeScript program, which takes seconds when the shared
// machine is busy: the suite has its own timeout, and the programs share the
// configuration and the declaration files they parse.
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = import.meta.dirname;
const PROBE = path.join(ROOT, 'src/lib/stats-engine/purity-probe.ts');
const NODE_TYPES = /[/\\]@types[/\\]node[/\\]/u;
const DOM_LIBRARY = /[/\\]lib\.dom(?:\.[a-z]+)*\.d\.ts$/u;

const isNodeOrDom = (file: string): boolean => NODE_TYPES.test(file) || DOM_LIBRARY.test(file);

function readConfig(): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(ROOT, 'tsconfig.pure-core.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (parsed === undefined) {
    throw new Error('tsconfig.pure-core.json cannot be read.');
  }
  return parsed;
}

const CONFIG = readConfig();
const BASE_HOST = ts.createCompilerHost(CONFIG.options);
const parsedFiles = new Map<string, ts.SourceFile | undefined>();

/**
 * The pure-core program: its real files, or, given `code`, a probe file of the
 * statistics core holding that code.
 */
function pureCoreProgram(code?: string): ts.Program {
  const host: ts.CompilerHost = {
    ...BASE_HOST,
    fileExists: (file) => file === PROBE || BASE_HOST.fileExists(file),
    readFile: (file) => (file === PROBE ? code : BASE_HOST.readFile(file)),
    getSourceFile: (file, version, ...rest) => {
      if (file === PROBE) {
        return ts.createSourceFile(file, code ?? '', version);
      }
      if (!parsedFiles.has(file)) {
        parsedFiles.set(file, BASE_HOST.getSourceFile(file, version, ...rest));
      }
      return parsedFiles.get(file);
    },
  };
  const rootNames = code === undefined ? CONFIG.fileNames : [PROBE];
  return ts.createProgram({ rootNames, options: CONFIG.options, host });
}

function typeErrors(code: string): readonly string[] {
  return ts
    .getPreEmitDiagnostics(pureCoreProgram(code))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

const fileNames = (program: ts.Program): readonly string[] =>
  program.getSourceFiles().map((file) => file.fileName);

describe('tsconfig.pure-core.json', { timeout: 60_000 }, () => {
  it.each([
    ['process', "export const level = process.env['LOG_LEVEL'];\n"],
    ['setTimeout', 'export const later = setTimeout(() => undefined, 1);\n'],
    ['console', "export const say = (): void => console.info('x');\n"],
    ['fetch', "export const load = fetch('https://example.com');\n"],
    ['document', 'export const title = document.title;\n'],
  ])('makes the global %s a type error', (name, code) => {
    expect(typeErrors(code).join('\n')).toContain(`Cannot find name '${name}'`);
  });

  it('accepts plain ECMAScript', () => {
    const code =
      'export const start = Date.UTC(2025, 2, 14);\nexport const half = Math.round(0.5);\n';

    expect(typeErrors(code)).toStrictEqual([]);
  });

  it('reads no Node or DOM declaration file for the real pure core', () => {
    const files = fileNames(pureCoreProgram());

    expect(files.filter((file) => file.includes('/src/lib/stats-engine/'))).not.toHaveLength(0);
    expect(files.filter((file) => isNodeOrDom(file))).toStrictEqual([]);
  });

  it('would read the Node types through a type import, which the module rules refuse', () => {
    const code =
      "import type { NextRequest } from 'next/server';\n\nexport type Probe = NextRequest;\n";

    expect(fileNames(pureCoreProgram(code)).some((file) => isNodeOrDom(file))).toBe(true);
  });
});
