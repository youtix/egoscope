/**
 * The `module-order`, `layer-imports` and `lot-boundary` rules of the `egoscope` plugin,
 * registered by eslint-plugin.ts and probed in eslint-module-order.test.ts.
 * eslint.config.ts applies them to src/lib, where a module reaches another only as
 * `@/lib/<module>`:
 *
 * - `module-order` (module map, section 1.2, rule 3): a module imports only the modules
 *   before it in the allowed order of section 1.3. Its tests may also import the shared
 *   test support, `testing`, which the order puts last and no production code imports
 *   (section 1.1).
 * - `layer-imports` (section 1.1): a port imports only `env`, `log`, `time` and `result`,
 *   narrower than the order, and the machinery never imports the pure core outside its
 *   tests, but for `drafts`, which checks the size of a pasted text with `ai-exchange`
 *   (its row in section 2). `module-order` keeps `testing` to the tests of a port.
 * - `lot-boundary` (section 1.2, rule 9; ADR 0001): the machinery, the pure core, the Lot 1
 *   ports and the Lot 1 domain modules never import a Lot 2 domain module or a Lot 2 port;
 *   the composition modules and the routes may.
 *
 * All three read every module reference of a file: imports, re-exports, `import()` and import
 * types, deep ones included, which module rule 4 refuses on its own. A module that the
 * order does not list is left alone; the test of this file checks that every folder of
 * src/lib has its place in the order.
 */
import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';

import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-module-order.ts#${name}`,
);

// The layers of the allowed order (module map, section 1.3), each in its order.
const MACHINERY_WITHOUT_DATABASE = ['env', 'log', 'result', 'time', 'wording', 'ui'];
const LOT_1_PORTS = ['stats-source', 'link-check', 'backup-storage', 'runtime-cache'];
const LOT_2_PORTS = ['language-model', 'press-feeds', 'telegram'];
const PURE_CORE = ['stats-engine', 'ai-exchange'];
const MACHINERY = [
  'wake-plan',
  'db',
  'journal',
  'params',
  'outbox',
  'incidents',
  'quotas',
  'scheduler',
  'auth',
  'device-drafts',
  'drafts',
  'offline',
  'navigation',
  'backups',
];
const LOT_1_DOMAIN = [
  'events',
  'players',
  'games',
  'sensitivity',
  'calendar-events',
  'taxonomy',
  'backtests',
  'imports',
];
const LOT_2_DOMAIN = ['collection', 'alerts', 'tracking', 'detection', 'notifications'];
const COMPOSITION = ['withdrawal', 'todo', 'tasks'];
const TEST_SUPPORT = 'testing';

/** The modules of src/lib in the allowed order of the module map, section 1.3. */
export const MODULE_ORDER: readonly string[] = [
  ...MACHINERY_WITHOUT_DATABASE,
  ...LOT_1_PORTS,
  ...LOT_2_PORTS,
  ...PURE_CORE,
  ...MACHINERY,
  ...LOT_1_DOMAIN,
  ...LOT_2_DOMAIN,
  ...COMPOSITION,
  TEST_SUPPORT,
];

// Rule 9: the Lot 2 modules, and the modules that never import them.
const LOT_2_MODULES: ReadonlySet<string> = new Set([...LOT_2_PORTS, ...LOT_2_DOMAIN]);
const BELOW_LOT_BOUNDARY: ReadonlySet<string> = new Set([
  ...MACHINERY_WITHOUT_DATABASE,
  ...LOT_1_PORTS,
  ...PURE_CORE,
  ...MACHINERY,
  ...LOT_1_DOMAIN,
]);

// Section 1.1: the ports and what they import, `testing` left to module-order; the machinery
// and the pure core, which only the tests of the machinery import, and `drafts` for the size
// of a pasted text (its row in section 2).
const PORTS: ReadonlySet<string> = new Set([...LOT_1_PORTS, ...LOT_2_PORTS]);
const PORT_IMPORTS: ReadonlySet<string> = new Set(['env', 'log', 'time', 'result', TEST_SUPPORT]);
const MACHINERY_MODULES: ReadonlySet<string> = new Set(MACHINERY);
const PURE_CORE_MODULES: ReadonlySet<string> = new Set(PURE_CORE);
const PURE_CORE_OF_MACHINERY: ReadonlyMap<string, string> = new Map([['drafts', 'ai-exchange']]);
const TEST_FILE = /\.test\.[cm]?tsx?$/u;

// A file of a module, at most two folder levels below src/lib, wherever the project lies.
const MODULE_FILE = /(?:^|\/)src\/lib\/(?<module>[^/]+)\/(?:[^/]+\/)?[^/]+$/u;
const MODULE_REFERENCE = /^@\/lib\/(?<module>[^/]+)/u;

type Reference = (imported: string, node: TSESTree.Node) => void;

/** The module of src/lib that the file `filename` belongs to, or '' when it belongs to none. */
const moduleOfFile = (filename: string): string =>
  MODULE_FILE.exec(filename.replaceAll('\\', '/'))?.groups?.['module'] ?? '';

/** Calls `onReference` with each other module of src/lib that the file references, and where. */
function moduleReferences(importer: string, onReference: Reference): TSESLint.RuleListener {
  type ModuleSource =
    | TSESTree.ExportAllDeclaration
    | TSESTree.ExportNamedDeclaration
    | TSESTree.ImportDeclaration
    | TSESTree.ImportExpression
    | TSESTree.TSImportType;
  const visit = ({ source }: ModuleSource): void => {
    if (source?.type !== AST_NODE_TYPES.Literal || typeof source.value !== 'string') {
      return;
    }
    const imported = MODULE_REFERENCE.exec(source.value)?.groups?.['module'];
    if (imported !== undefined && imported !== importer) {
      onReference(imported, source);
    }
  };
  return {
    ExportAllDeclaration: visit,
    ExportNamedDeclaration: visit,
    ImportDeclaration: visit,
    ImportExpression: visit,
    TSImportType: visit,
  };
}

/** The rule `module-order`. */
export const moduleOrder = createRule<[{ allowTestSupport: boolean }], 'order' | 'testSupport'>({
  name: 'module-order',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Allow a module to import only the modules before it in the allowed order of the module map.',
    },
    messages: {
      order:
        '`{{importer}}` imports only the modules before it in the allowed order of the module map (section 1.3), and `{{imported}}` comes after it: compose the two in a module that comes after both, or pass what is needed as an argument (section 1.2, rule 3).',
      testSupport:
        'Only tests import `testing`, the shared test support (module map, section 1.1).',
    },
    schema: [
      {
        type: 'object',
        properties: { allowTestSupport: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowTestSupport: false }],
  },
  create(context, [{ allowTestSupport }]) {
    const importer = moduleOfFile(context.filename);
    const rank = MODULE_ORDER.indexOf(importer);
    if (rank === -1) {
      return {};
    }
    return moduleReferences(importer, (imported, node) => {
      if (MODULE_ORDER.indexOf(imported) <= rank) {
        return;
      }
      if (imported !== TEST_SUPPORT) {
        context.report({ node, messageId: 'order', data: { importer, imported } });
      } else if (!allowTestSupport) {
        context.report({ node, messageId: 'testSupport' });
      }
    });
  },
});

/**
 * What `imported` breaks of the layer of `importer` (section 1.1), if anything: `port` for a
 * module that a port does not import, `machinery` for the pure core in a file of the
 * machinery that is no test.
 */
function layerBreach(
  importer: string,
  imported: string,
  isTest: boolean,
): 'port' | 'machinery' | undefined {
  if (PORTS.has(importer)) {
    return PORT_IMPORTS.has(imported) ? undefined : 'port';
  }
  return !isTest &&
    MACHINERY_MODULES.has(importer) &&
    PURE_CORE_MODULES.has(imported) &&
    PURE_CORE_OF_MACHINERY.get(importer) !== imported
    ? 'machinery'
    : undefined;
}

/** The rule `layer-imports`. */
export const layerImports = createRule({
  name: 'layer-imports',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Allow a port and the machinery only the imports that their layer of the module map allows.',
    },
    messages: {
      port: '`{{importer}}` is a port, which imports only `env`, `log`, `time` and `result` (module map, section 1.1), and `{{imported}}` is none of them: pass what the port needs as an argument, or move the code that needs `{{imported}}` into a module that calls the port.',
      machinery:
        '`{{importer}}` belongs to the machinery, which imports only earlier machinery and the ports (module map, section 1.1), and `{{imported}}` is the pure core: only the tests of the machinery import it, and `drafts` imports `ai-exchange` for the size of a pasted text (section 2).',
    },
    schema: [],
  },
  create(context) {
    const importer = moduleOfFile(context.filename);
    const isTest = TEST_FILE.test(context.filename);
    return moduleReferences(importer, (imported, node) => {
      const messageId = layerBreach(importer, imported, isTest);
      if (messageId !== undefined) {
        context.report({ node, messageId, data: { importer, imported } });
      }
    });
  },
});

/** The rule `lot-boundary`. */
export const lotBoundary = createRule({
  name: 'lot-boundary',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep the machinery, the pure core and the Lot 1 ports and domain modules from importing Lot 2.',
    },
    messages: {
      lot2: '`{{importer}}` never imports the Lot 2 module `{{imported}}` (module map, section 1.2, rule 9; ADR 0001): Lot 2 reacts to Lot 1 work through the reaction lists of the composition layer (section 1.10) and the routes.',
    },
    schema: [],
  },
  create(context) {
    const importer = moduleOfFile(context.filename);
    if (!BELOW_LOT_BOUNDARY.has(importer)) {
      return {};
    }
    return moduleReferences(importer, (imported, node) => {
      if (LOT_2_MODULES.has(imported)) {
        context.report({ node, messageId: 'lot2', data: { importer, imported } });
      }
    });
  },
});
