// Proves that lint keeps the route shells of route-shells.ts thin: eslint.config.ts
// applies the shell rules to every file name of that list. The probes run in the
// temporary project of lint-probes.ts; the other probes of eslint.config.ts are in
// eslint.config.test.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes, SHELL_PROBES } from './lint-probes';

const { ruleIds, remove } = createProbes();

describe('route shells stay thin', { timeout: 120_000 }, () => {
  afterAll(remove);

  const page = 'export default function Page(): null {\n  return null;\n}\n';

  it.each(SHELL_PROBES)('applies the shell rules to %s', async (file) => {
    const code =
      'export default function Shell(): null {\n  for (const item of [1]) {\n    void item;\n  }\n  return null;\n}\n';

    expect(await ruleIds(file, code)).toContain('no-restricted-syntax');
  });

  it.each([
    [
      'a loop',
      'export default function Page(): null {\n  for (const item of [1]) {\n    void item;\n  }\n  return null;\n}\n',
    ],
    [
      'a top-level helper',
      "const helper = (): string => 'x';\n\nexport default function Page(): string {\n  return helper();\n}\n",
    ],
    [
      'an exported helper function',
      `export function label(): string {\n  return 'x';\n}\n\n${page}`,
    ],
    ['an exported helper arrow', `export const label = (): string => 'x';\n\n${page}`],
    ['a class', `export class Store {}\n\n${page}`],
    ['an export list', `const label = 'x';\nexport { label };\n\n${page}`],
    ['a default export that is not a function declaration', 'export default (): null => null;\n'],
  ])('rejects %s in page.tsx', async (_kind, code) => {
    expect(await ruleIds('src/app/probe/page.tsx', code)).toContain('no-restricted-syntax');
  });

  it('tolerates a condition and an inline callback under the caps, as CLAUDE.md says', async () => {
    const code = [
      'export default function Page({ names }: Readonly<{ names: readonly string[] }>): string {',
      "  return names.length > 0 ? names.map((name) => name.trim()).join(', ') : 'none';",
      '}',
      '',
    ].join('\n');

    expect(await ruleIds('src/app/probe/page.tsx', code)).not.toContain('no-restricted-syntax');
  });

  it('accepts the exports that Next.js reads from page.tsx', async () => {
    const code = [
      "import type { Metadata } from 'next';",
      '',
      "export const metadata: Metadata = { title: 'Probe' };",
      '',
      'export function generateStaticParams(): { id: string }[] {',
      "  return [{ id: 'one' }];",
      '}',
      '',
      page,
    ].join('\n');

    expect(await ruleIds('src/app/probe/page.tsx', code)).not.toContain('no-restricted-syntax');
  });

  it.each([
    [
      'not-found.tsx',
      'src/app/probe/not-found.tsx',
      "export const viewport = { colorScheme: 'dark' };\n",
    ],
    ['loading.tsx', 'src/app/probe/loading.tsx', "export const metadata = { title: 'Probe' };\n"],
  ])('rejects an export that Next.js does not read from %s', async (_kind, file, code) => {
    expect(await ruleIds(file, `${code}\n${page}`)).toContain('no-restricted-syntax');
  });

  it('caps the complexity of every function in the file', async () => {
    const code = [
      'export default function Page({ a, b }: Readonly<{ a: boolean; b: boolean }>): string {',
      "  const pick = (): string => (a ? (b ? 'ab' : 'a') : b ? 'b' : 'none');",
      '  return pick();',
      '}',
      '',
    ].join('\n');

    expect(await ruleIds('src/app/probe/page.tsx', code)).toContain('complexity');
  });
});
