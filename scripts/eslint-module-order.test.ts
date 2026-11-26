// Proves where module-order and lot-boundary bite (module map, section 1.2, rules 3 and 9),
// and layer-imports (section 1.1), and that their order is the module map's. The probes
// are fixture files that this test writes into the probe project of lint-probes.ts, one
// per importing module, and lints with the full configuration.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { MODULE_ORDER } from './eslint-module-order';
import { createProbes } from './lint-probes';

import type { Linter } from 'eslint';

const ROOT = path.join(import.meta.dirname, '..');
const ORDER = 'egoscope/module-order';
const BOUNDARY = 'egoscope/lot-boundary';
const LAYERS = 'egoscope/layer-imports';
// The ports (module map, section 2.3).
const PORTS = [
  'stats-source',
  'link-check',
  'backup-storage',
  'runtime-cache',
  'language-model',
  'press-feeds',
  'telegram',
];
// The Lot 2 ports and domain modules (module map, sections 2.3 and 2.5).
const LOT_2 = [
  'language-model',
  'press-feeds',
  'telegram',
  'collection',
  'alerts',
  'tracking',
  'detection',
  'notifications',
];

const { eslint, project, remove } = createProbes();

/** The fixture file of a module, which a probe lints as a file of that module. */
const probe = (module: string): string => `src/lib/${module}/probe.ts`;
const TEST_PROBE = 'src/lib/events/probe.test.ts';
const MACHINERY_TEST_PROBE = 'src/lib/db/probe.test.ts';
const PORT_TEST_PROBE = 'src/lib/link-check/probe.test.ts';
const ROUTE_PROBE = 'src/app/probe/helper.ts';
const IMPORTERS = [
  'env',
  ...PORTS,
  'stats-engine',
  'wake-plan',
  'db',
  'drafts',
  'events',
  'players',
  'collection',
  'withdrawal',
  'todo',
  'tasks',
];
// Written before the first lint, so that the TypeScript project service sees them.
const TEST_PROBES = [TEST_PROBE, MACHINERY_TEST_PROBE, PORT_TEST_PROBE];
for (const file of [...IMPORTERS.map((module) => probe(module)), ...TEST_PROBES, ROUTE_PROBE]) {
  mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  writeFileSync(path.join(project, file), 'export {};\n');
}

/** The problems that `code`, linted as `file`, holds. */
async function problemsIn(file: string, code: string): Promise<readonly Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(project, file) });
  const messages = result?.messages ?? [];
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal !== undefined) {
    // A probe that does not parse would make "not reported" assertions pass vacuously.
    throw new Error(`Probe ${file} does not parse: ${fatal.message}`);
  }
  return messages;
}

/** The rules that report a problem in `code`, linted as `file`. */
async function rulesIn(file: string, code: string): Promise<readonly (string | null)[]> {
  const messages = await problemsIn(file, code);
  return messages.map((message) => message.ruleId);
}

/** What layer-imports says of `code`, linted as `file`. */
async function layerMessages(file: string, code: string): Promise<readonly string[]> {
  const messages = await problemsIn(file, code);
  return messages.filter(({ ruleId }) => ruleId === LAYERS).map(({ message }) => message);
}

/** The module names that `line` of the module map writes in backquotes, in order. */
const modulesOn = (line: string): (string | undefined)[] =>
  Array.from(line.matchAll(/`(?<name>[a-z-]+)`/gu), (match) => match.groups?.['name']);

/** A file that re-exports a name of `module`. */
const reExportOf = (module: string): string => `export { probe } from '@/lib/${module}';\n`;

/** What layer-imports says to the port `importer` that imports `imported`. */
const portMessage = (importer: string, imported: string): string =>
  `\`${importer}\` is a port, which imports only \`env\`, \`log\`, \`time\` and \`result\` (module map, section 1.1), and \`${imported}\` is none of them: pass what the port needs as an argument, or move the code that needs \`${imported}\` into a module that calls the port.`;

/** What layer-imports says to the machinery module `importer` that imports `imported`. */
const machineryMessage = (importer: string, imported: string): string =>
  `\`${importer}\` belongs to the machinery, which imports only earlier machinery and the ports (module map, section 1.1), and \`${imported}\` is the pure core: only the tests of the machinery import it, and \`drafts\` imports \`ai-exchange\` for the size of a pasted text (section 2).`;

describe('the module order of the lint', { timeout: 120_000 }, () => {
  afterAll(remove);

  describe('module-order: a module imports only the modules before it', () => {
    it('follows the allowed order of the module map, section 1.3', () => {
      const map = readFileSync(path.join(ROOT, 'docs/engineering/module-map.md'), 'utf8');
      const section = map.slice(map.indexOf('### 1.3 '), map.indexOf('### 1.4 '));
      const listed = section
        .split('\n')
        .filter((line) => /^\d+\. /u.test(line))
        .flatMap((line) => modulesOn(line));

      expect(MODULE_ORDER).toStrictEqual(listed);
    });

    it('gives every module of src/lib its place in the order', () => {
      const modules = readdirSync(path.join(ROOT, 'src/lib'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      expect(modules.filter((module) => !MODULE_ORDER.includes(module))).toStrictEqual([]);
    });

    it.each([
      ['players', 'games'],
      ['wake-plan', 'db'],
      ['env', 'log'],
      ['stats-source', 'telegram'],
      ['events', 'withdrawal'],
      ['todo', 'tasks'],
    ])('rejects %s importing %s, which comes after it', async (importer, imported) => {
      expect(await rulesIn(probe(importer), reExportOf(imported))).toContain(ORDER);
    });

    it.each([
      [
        'a type-only import',
        "import type { GameRow } from '@/lib/games';\n\nexport type Row = GameRow;\n",
      ],
      [
        'a dynamic import',
        "export const load = async (): Promise<unknown> => import('@/lib/games');\n",
      ],
      ['an import type', "export type Games = typeof import('@/lib/games');\n"],
      ['a star re-export', "export * as games from '@/lib/games';\n"],
      ['a deep import', "export { probe } from '@/lib/games/queries';\n"],
    ])('rejects it through %s', async (_form, code) => {
      expect(await rulesIn(probe('players'), code)).toContain(ORDER);
    });

    it.each([
      ['players', 'events'],
      ['db', 'time'],
      ['events', 'stats-engine'],
      ['tasks', 'notifications'],
      ['events', 'events'],
    ])('lets %s import %s', async (importer, imported) => {
      expect(await rulesIn(probe(importer), reExportOf(imported))).not.toContain(ORDER);
    });

    it('lets only tests import the test support, and holds tests to the order otherwise', async () => {
      expect(await rulesIn(probe('events'), reExportOf('testing'))).toContain(ORDER);
      expect(await rulesIn(TEST_PROBE, reExportOf('testing'))).not.toContain(ORDER);
      expect(await rulesIn(TEST_PROBE, reExportOf('games'))).toContain(ORDER);
    });
  });

  describe('layer-imports: a port and the machinery import only what their layer allows', () => {
    it.each(PORTS)(
      'lets the port %s import env, log, time and result, and nothing else',
      async (port) => {
        const code = ['env', 'log', 'time', 'result', 'wording']
          .map((module) => `export { probe as ${module} } from '@/lib/${module}';\n`)
          .join('');

        await expect(layerMessages(probe(port), code)).resolves.toStrictEqual([
          portMessage(port, 'wording'),
        ]);
      },
    );

    it.each([
      [probe('link-check'), 'stats-source', portMessage('link-check', 'stats-source')],
      [probe('db'), 'stats-engine', machineryMessage('db', 'stats-engine')],
      [probe('db'), 'ai-exchange', machineryMessage('db', 'ai-exchange')],
      [probe('drafts'), 'stats-engine', machineryMessage('drafts', 'stats-engine')],
    ])('refuses %s importing %s', async (file, imported, message) => {
      await expect(layerMessages(file, reExportOf(imported))).resolves.toStrictEqual([message]);
    });

    it.each([
      [probe('drafts'), 'ai-exchange'],
      [MACHINERY_TEST_PROBE, 'stats-engine'],
      [probe('db'), 'time'],
      [probe('db'), 'stats-source'],
      [probe('events'), 'stats-engine'],
      [PORT_TEST_PROBE, 'testing'],
    ])('lets %s import %s', async (file, imported) => {
      await expect(layerMessages(file, reExportOf(imported))).resolves.toStrictEqual([]);
    });
  });

  describe('lot-boundary: nothing below the lot boundary imports Lot 2', () => {
    it.each(LOT_2)('rejects a Lot 1 domain module importing %s', async (imported) => {
      expect(await rulesIn(probe('events'), reExportOf(imported))).toContain(BOUNDARY);
    });

    it.each([
      ['the machinery', 'env'],
      ['the machinery', 'db'],
      ['a Lot 1 port', 'stats-source'],
      ['the pure core', 'stats-engine'],
    ])('rejects %s, here %s, importing a Lot 2 port', async (_layer, importer) => {
      expect(await rulesIn(probe(importer), reExportOf('telegram'))).toContain(BOUNDARY);
    });

    it.each([
      [probe('withdrawal'), 'notifications'],
      [probe('todo'), 'detection'],
      [probe('tasks'), 'telegram'],
      [probe('collection'), 'press-feeds'],
      [probe('events'), 'stats-source'],
      [ROUTE_PROBE, 'detection'],
    ])('lets %s import %s', async (file, imported) => {
      const rules = await rulesIn(file, reExportOf(imported));

      expect(rules).not.toContain(BOUNDARY);
      expect(rules).not.toContain(ORDER);
    });
  });
});
