// Proves that tsconfig.pure-core.json gives the pure core the ECMAScript library
// only: a Node.js or DOM global used there is a type error.
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = import.meta.dirname;
const PROBE = path.join(ROOT, 'src/lib/stats-engine/purity-probe.ts');

/** Type-checks `code` as if it were a file of the statistics core. */
function typeErrors(code: string): readonly string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(ROOT, 'tsconfig.pure-core.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (parsed === undefined) {
    throw new Error('tsconfig.pure-core.json cannot be read.');
  }
  const base = ts.createCompilerHost(parsed.options);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (file) => file === PROBE || base.fileExists(file),
    readFile: (file) => (file === PROBE ? code : base.readFile(file)),
    getSourceFile: (file, version, ...rest) =>
      file === PROBE
        ? ts.createSourceFile(file, code, version)
        : base.getSourceFile(file, version, ...rest),
  };
  const program = ts.createProgram({ rootNames: [PROBE], options: parsed.options, host });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('tsconfig.pure-core.json', () => {
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
});
