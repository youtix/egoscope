/**
 * The lint policy of the whole repository, in one file.
 *
 * - Every enabled rule is an error: presets that ship warnings are escalated at
 *   the end of this file, and the scripts run ESLint with `--max-warnings 0`.
 * - Each rule switched off from a preset carries its reason on the line above.
 * - The six module rules of CLAUDE.md are enforced in "Module rules" below, for
 *   every way of naming a module (import, import type, export … from, import(),
 *   import types), and eslint.config.test.ts proves that each of them bites.
 *
 * Never weaken a rule to get green: fix the code, or raise the problem in the PR.
 */
import path from 'node:path';

import eslintJs from '@eslint/js';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslintReact from '@eslint-react/eslint-plugin';
import nextPlugin from '@next/eslint-plugin-next';
import vitest from '@vitest/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import checkFile from 'eslint-plugin-check-file';
import importX from 'eslint-plugin-import-x';
import jestDom from 'eslint-plugin-jest-dom';
import jsdoc from 'eslint-plugin-jsdoc';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import promise from 'eslint-plugin-promise';
import reactHooks from 'eslint-plugin-react-hooks';
import regexp from 'eslint-plugin-regexp';
import { configs as sonarjsConfigs } from 'eslint-plugin-sonarjs';
import testingLibrary from 'eslint-plugin-testing-library';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

import { egoscopePlugin } from './scripts/eslint-plugin';
import { GENERATED_FOLDERS } from './scripts/generated-files';
import { IGNORED_FOLDERS } from './scripts/ignored-folders';
import { ROUTE_SHELLS, SHELL_KINDS } from './scripts/route-shells';

import type { Linter } from 'eslint';

// ---------------------------------------------------------------------------
// File sets. Every TypeScript extension is covered; the structure check then
// allows only .ts and .tsx in src/ and scripts/, and only .ts in the pure core.
// ---------------------------------------------------------------------------

const TS = '{ts,tsx,mts,cts}';
const TS_FILES = [`**/*.${TS}`];
const TEST_FILES = [`**/*.test.${TS}`];
const COMPONENT_TEST_FILES = ['**/*.test.tsx'];
const CONFIG_FILES = ['*.config.ts', 'vitest.dom-setup.ts'];
const SCRIPT_FILES = [`scripts/**/*.${TS}`];
// End-to-end specs and their helpers, which live in e2e/, outside src/ (structure check).
const E2E_FILES = [`e2e/**/*.${TS}`, `**/*.spec.${TS}`];
const SRC_FILES = [`src/**/*.${TS}`];
const PURE_CORE_FILES = [`src/lib/{stats-engine,ai-exchange}/**/*.${TS}`];

// Route shells (scripts/route-shells.ts) and the other Next.js files that Next.js
// loads through their default export.
const NEXT_DEFAULT_EXPORT_FILES = [
  ...ROUTE_SHELLS,
  'src/app/**/{opengraph-image,twitter-image,icon,apple-icon,sitemap,robots,manifest}.{ts,tsx}',
];

// A test title is optional requirement tags, then a plain description:
// "[JOU-04] [CA-TRV-12] rejects a 31st active player".
const TEST_TITLE = String.raw`^(?:\[[A-Z]+(?:-[A-Z]+)*-\d+\] )*[^\s[]`;

// ---------------------------------------------------------------------------
// Module rules (CLAUDE.md). ESLint replaces a rule's options instead of merging
// them across config objects, so each area below gets complete, composed lists.
// ---------------------------------------------------------------------------

type ImportPattern = Readonly<{ regex: string; message: string }>;
type SyntaxRestriction = Readonly<{ selector: string; message: string }>;
type PropertyRestriction = Readonly<{ object: string; property: string; message: string }>;

const NO_DEEP_LIB_IMPORT: ImportPattern = {
  regex: '^@/lib/[^/]+/',
  message:
    'Import a module through its public API, `@/lib/<module>`, never a file inside it (module rule 4).',
};
const NO_APP_FROM_LIB: ImportPattern = {
  regex: '^@/app(?:/|$)',
  message: 'src/lib never imports from src/app; pass what it needs as arguments (module rule 1).',
};
const NO_ROUTE_FROM_ROUTE: ImportPattern = {
  regex: '^@/app(?:/|$)',
  message:
    'A route never imports from another route: move shared code to src/lib/<module> (module rule 3).',
};
const NO_RELATIVE_EXIT_FROM_ROUTE: ImportPattern = {
  regex: String.raw`^\.\./`,
  message:
    'Relative imports stay inside the route folder: import shared code from `@/lib/<module>` (module rule 3).',
};
const NO_RELATIVE_ENTRY_INTO_ROUTE: ImportPattern = {
  regex: String.raw`^\./[^/]+/`,
  message:
    'A nested folder is another route: move code that two routes share to src/lib/<module> (module rule 3).',
};
const NO_RELATIVE_EXIT_FROM_MODULE: ImportPattern = {
  regex: String.raw`^\.\./`,
  message:
    'Relative imports stay inside the module: import another module as `@/lib/<module>` (module rule 4).',
};
const NO_RELATIVE_EXIT_FROM_SUBFOLDER: ImportPattern = {
  regex: String.raw`^\.\./\.\./`,
  message: NO_RELATIVE_EXIT_FROM_MODULE.message,
};
const PURE_MESSAGE =
  'The pure core (src/lib/stats-engine, src/lib/ai-exchange) does no I/O and reads no clock, local time, randomness or environment: pass such values in as arguments (module rule 2).';
const NO_IMPORT_OUTSIDE_STATS_ENGINE: ImportPattern = {
  regex: String.raw`^(?!\.\.?/)`,
  message: 'The statistics core imports nothing outside itself (module rule 2).',
};
const NO_IMPORT_OUTSIDE_STATS_ENGINE_TESTS: ImportPattern = {
  regex: String.raw`^(?!\.\.?/|vitest$|fast-check$|@data/)`,
  message:
    'The statistics core imports nothing outside itself; its tests may also import vitest, fast-check and fixtures from @data/ (module rule 2).',
};
// The exchange contracts may use zod; no other package, so that no import can
// bring Node or DOM types (next, react…) into the pure-core type check.
const NO_IMPORT_OUTSIDE_AI_EXCHANGE: ImportPattern = {
  regex: String.raw`^(?!\.\.?/|zod(?:/|$))`,
  message:
    'src/lib/ai-exchange imports nothing outside itself but zod, so that no Node or DOM type reaches the pure core (module rule 2).',
};
const NO_IMPORT_OUTSIDE_AI_EXCHANGE_TESTS: ImportPattern = {
  regex: String.raw`^(?!\.\.?/|zod(?:/|$)|vitest$|fast-check$|@data/)`,
  message:
    'src/lib/ai-exchange imports nothing outside itself but zod; its tests may also import vitest, fast-check and fixtures from @data/ (module rule 2).',
};
const NO_SRC_FROM_AI_EXCHANGE: ImportPattern = {
  regex: '^@/',
  message: 'src/lib/ai-exchange imports nothing from src/ (module rule 2).',
};

const escapeSlashes = (regex: string): string => regex.replaceAll('/', String.raw`\/`);

/** The same import pattern, for `import()` and for import types. */
const otherReferences = (pattern: ImportPattern): SyntaxRestriction[] => [
  {
    selector: `ImportExpression[source.value=/${escapeSlashes(pattern.regex)}/]`,
    message: pattern.message,
  },
  {
    selector: `TSImportType[source.value=/${escapeSlashes(pattern.regex)}/]`,
    message: pattern.message,
  },
];

const EVERYWHERE_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector: 'TSEnumDeclaration',
    message: 'No enums: use an `as const` object or a union of literals (module rule 6).',
  },
  {
    selector: 'ExportAllDeclaration',
    message: 'Re-export names explicitly, so that the public API stays readable (module rule 4).',
  },
  {
    // The React Compiler, and with it the react-hooks rules, skips code under these.
    selector: 'ExpressionStatement[directive=/^use no (?:memo|forget)$/]',
    message:
      "`'use no memo'` switches the React Compiler's checks off: fix what they report instead.",
  },
];
// src/ holds ECMAScript modules only, and every module reference in it is a
// literal that the module rules can check.
const ESM_ONLY_MESSAGE =
  'src/ holds ECMAScript modules only: use `import`, which the module rules check, not `require` or `createRequire` (module rules 1 to 4).';
const NO_NODE_MODULE: ImportPattern = {
  regex: '^(?:node:)?module$',
  message: ESM_ONLY_MESSAGE,
};
const COMMONJS_GLOBALS = ['require', 'module', 'exports', '__dirname', '__filename'].map(
  (name) => ({ name, message: ESM_ONLY_MESSAGE }),
);
const SRC_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector:
      "CallExpression[callee.name='require'], TSImportEqualsDeclaration, MemberExpression[property.name='createRequire']",
    message: ESM_ONLY_MESSAGE,
  },
  {
    selector: "ImportExpression[source.type!='Literal']",
    message:
      'Give `import()` a literal path, so that the module rules can check it (module rules 1 to 4).',
  },
];
const BARREL_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector: 'Program > :not(ExportNamedDeclaration[source])',
    message:
      "A module's index.ts only re-exports its public API: `export { name } from './file'` (module rule 4).",
  },
];
const SHELL_MESSAGE =
  'Route shells stay thin, because coverage leaves them out: move this code to a colocated module or to src/lib/<module>, where it is unit-tested.';
// What a route shell may not hold: loops, switch and try; a top-level function,
// class or helper; an export that Next.js does not read. The size and complexity
// caps of egoscope/route-shells bound the rest.
const SHELL_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector:
      ':matches(ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement, SwitchStatement, TryStatement)',
    message: SHELL_MESSAGE,
  },
  {
    selector:
      'Program > :matches(FunctionDeclaration, ClassDeclaration), Program > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression, ClassExpression)',
    message: SHELL_MESSAGE,
  },
  {
    selector: 'ExportDefaultDeclaration > :not(FunctionDeclaration)',
    message: `A route shell exports its component as \`export default function Name()\`. ${SHELL_MESSAGE}`,
  },
  {
    selector:
      'ExportNamedDeclaration:not([declaration]), ExportNamedDeclaration > :matches(ClassDeclaration, TSTypeAliasDeclaration, TSInterfaceDeclaration, TSModuleDeclaration, TSDeclareFunction)',
    message: `A route shell exports only what Next.js reads from it. ${SHELL_MESSAGE}`,
  },
];
/** Only the named exports that Next.js reads from this kind of route shell. */
function shellExports(names: readonly string[]): SyntaxRestriction[] {
  const allowed = names.length === 0 ? '^$' : `^(?:${names.join('|')})$`;
  const others = names.length === 0 ? '' : ' and '.concat(names.join(', '));
  const message = `This route shell may export only its default component${others}. ${SHELL_MESSAGE}`;
  return [
    { selector: `ExportNamedDeclaration > FunctionDeclaration[id.name!=/${allowed}/]`, message },
    {
      selector: `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name!=/${allowed}/]`,
      message,
    },
  ];
}
// Reading the clock or the time zone, I/O and environment access in the pure core.
// UTC arithmetic stays allowed: Date.UTC(…), new Date(ms) and the getUTC* methods.
const PURE_SYNTAX: readonly SyntaxRestriction[] = [
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: PURE_MESSAGE },
  { selector: "CallExpression[callee.name='Date']", message: PURE_MESSAGE },
  { selector: "MetaProperty[meta.name='import']", message: PURE_MESSAGE },
];
// The statistics core is also synchronous and loads nothing at run time.
const STATS_ENGINE_SYNTAX: readonly SyntaxRestriction[] = [
  ...PURE_SYNTAX,
  { selector: 'ImportExpression', message: PURE_MESSAGE },
  { selector: ':function[async=true], AwaitExpression', message: PURE_MESSAGE },
];

const NO_PROCESS_ENV: PropertyRestriction = {
  object: 'process',
  property: 'env',
  message: 'Read configuration through `@/lib/env`, which validates it once (secrets rule).',
};
const PURE_PROPERTIES: readonly PropertyRestriction[] = [
  { object: 'Date', property: 'now', message: PURE_MESSAGE },
  { object: 'Date', property: 'parse', message: PURE_MESSAGE },
  { object: 'Math', property: 'random', message: PURE_MESSAGE },
  { object: 'Temporal', property: 'Now', message: PURE_MESSAGE },
];
const PURE_GLOBALS = [
  'Buffer',
  'EventSource',
  'Intl',
  'WebSocket',
  'Worker',
  'XMLHttpRequest',
  '__dirname',
  '__filename',
  'caches',
  'clearImmediate',
  'clearInterval',
  'clearTimeout',
  'console',
  'crypto',
  'document',
  'exports',
  'fetch',
  'global',
  'globalThis',
  'history',
  'indexedDB',
  'localStorage',
  'location',
  'module',
  'navigator',
  'performance',
  'process',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
  'require',
  'self',
  'sessionStorage',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'window',
].map((name) => ({ name, message: PURE_MESSAGE }));

/**
 * The layer zones of module rules 1 and 2, resolved against `basePath`. Exported
 * so that eslint.config.test.ts can lint its probes in a temporary project.
 */
export function layerZones(basePath: string): Linter.RuleEntry {
  return [
    'error',
    {
      basePath,
      zones: [
        { target: './src/lib', from: './src/app', message: NO_APP_FROM_LIB.message },
        {
          target: './src/lib/stats-engine',
          from: './src',
          except: ['./lib/stats-engine'],
          message: NO_IMPORT_OUTSIDE_STATS_ENGINE.message,
        },
        {
          target: './src/lib/ai-exchange',
          from: './src',
          except: ['./lib/ai-exchange'],
          message: NO_SRC_FROM_AI_EXCHANGE.message,
        },
      ],
    },
  ];
}

type Area = Readonly<{
  name: string;
  files: readonly string[];
  imports: readonly ImportPattern[];
  syntax?: readonly SyntaxRestriction[];
}>;

/** The import and syntax restrictions of one area of src/, composed in full. */
function moduleArea(area: Area): Linter.Config {
  const imports = [...area.imports, NO_NODE_MODULE];
  return {
    name: `egoscope/module-rules/${area.name}`,
    files: [...area.files],
    rules: {
      'no-restricted-imports': ['error', { patterns: imports }],
      'no-restricted-syntax': [
        'error',
        ...EVERYWHERE_SYNTAX,
        ...SRC_SYNTAX,
        ...imports.flatMap((pattern) => otherReferences(pattern)),
        ...(area.syntax ?? []),
      ],
    },
  };
}

const APP_IMPORTS = [
  NO_DEEP_LIB_IMPORT,
  NO_ROUTE_FROM_ROUTE,
  NO_RELATIVE_EXIT_FROM_ROUTE,
  NO_RELATIVE_ENTRY_INTO_ROUTE,
];
const LIB_ROOT_IMPORTS = [NO_DEEP_LIB_IMPORT, NO_APP_FROM_LIB, NO_RELATIVE_EXIT_FROM_MODULE];
const LIB_SUBFOLDER_IMPORTS = [
  NO_DEEP_LIB_IMPORT,
  NO_APP_FROM_LIB,
  NO_RELATIVE_EXIT_FROM_SUBFOLDER,
];

// Later areas override earlier ones on the files they share.
const MODULE_AREAS: readonly Area[] = [
  { name: 'app', files: [`src/app/**/*.${TS}`], imports: APP_IMPORTS },
  ...SHELL_KINDS.map((kind, index) => ({
    name: `route-shells-${String(index + 1)}`,
    files: [kind.glob],
    imports: APP_IMPORTS,
    syntax: [...SHELL_SYNTAX, ...shellExports(kind.exports)],
  })),
  { name: 'lib-module-root', files: [`src/lib/*/*.${TS}`], imports: LIB_ROOT_IMPORTS },
  { name: 'lib-module-subfolder', files: [`src/lib/*/*/*.${TS}`], imports: LIB_SUBFOLDER_IMPORTS },
  {
    name: 'barrels',
    files: [`src/lib/*/index.${TS}`],
    imports: LIB_ROOT_IMPORTS,
    syntax: BARREL_SYNTAX,
  },
  {
    name: 'ai-exchange',
    files: [`src/lib/ai-exchange/*.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_AI_EXCHANGE, NO_RELATIVE_EXIT_FROM_MODULE],
    syntax: PURE_SYNTAX,
  },
  {
    name: 'ai-exchange-subfolder',
    files: [`src/lib/ai-exchange/*/*.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_AI_EXCHANGE, NO_RELATIVE_EXIT_FROM_SUBFOLDER],
    syntax: PURE_SYNTAX,
  },
  {
    name: 'ai-exchange-tests',
    files: [`src/lib/ai-exchange/*.test.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_AI_EXCHANGE_TESTS, NO_RELATIVE_EXIT_FROM_MODULE],
    syntax: PURE_SYNTAX,
  },
  {
    name: 'ai-exchange-subfolder-tests',
    files: [`src/lib/ai-exchange/*/*.test.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_AI_EXCHANGE_TESTS, NO_RELATIVE_EXIT_FROM_SUBFOLDER],
    syntax: PURE_SYNTAX,
  },
  {
    name: 'ai-exchange-index',
    files: [`src/lib/ai-exchange/index.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_AI_EXCHANGE, NO_RELATIVE_EXIT_FROM_MODULE],
    syntax: [...BARREL_SYNTAX, ...PURE_SYNTAX],
  },
  {
    name: 'stats-engine',
    files: [`src/lib/stats-engine/*.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_STATS_ENGINE, NO_RELATIVE_EXIT_FROM_MODULE],
    syntax: STATS_ENGINE_SYNTAX,
  },
  {
    name: 'stats-engine-subfolder',
    files: [`src/lib/stats-engine/*/*.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_STATS_ENGINE, NO_RELATIVE_EXIT_FROM_SUBFOLDER],
    syntax: STATS_ENGINE_SYNTAX,
  },
  {
    name: 'stats-engine-tests',
    files: [`src/lib/stats-engine/*.test.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_STATS_ENGINE_TESTS, NO_RELATIVE_EXIT_FROM_MODULE],
    syntax: STATS_ENGINE_SYNTAX,
  },
  {
    name: 'stats-engine-subfolder-tests',
    files: [`src/lib/stats-engine/*/*.test.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_STATS_ENGINE_TESTS, NO_RELATIVE_EXIT_FROM_SUBFOLDER],
    syntax: STATS_ENGINE_SYNTAX,
  },
  {
    name: 'stats-engine-index',
    files: [`src/lib/stats-engine/index.${TS}`],
    imports: [NO_IMPORT_OUTSIDE_STATS_ENGINE, NO_RELATIVE_EXIT_FROM_MODULE],
    syntax: [...BARREL_SYNTAX, ...STATS_ENGINE_SYNTAX],
  },
];

// Rules that no inline comment may switch off, not even through a chain of
// disable comments: change this file in a reviewed PR instead.
const UNDISABLEABLE_RULES = [
  '@eslint-community/eslint-comments/*',
  '@typescript-eslint/ban-ts-comment',
  '@typescript-eslint/max-params',
  'check-file/*',
  'complexity',
  'egoscope/*',
  'import-x/no-cycle',
  'import-x/no-default-export',
  'import-x/no-restricted-paths',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-statements',
  'no-console',
  'no-restricted-globals',
  'no-restricted-imports',
  'no-restricted-properties',
  'no-restricted-syntax',
  'sonarjs/cognitive-complexity',
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const composed = defineConfig(
  globalIgnores([
    ...IGNORED_FOLDERS,
    // Generated files are never edited by hand: their generator answers for them.
    ...GENERATED_FOLDERS,
    '.next/',
    '.vitest/',
    'coverage/',
    'out/',
    'reports/',
    'next-env.d.ts',
  ]),

  {
    name: 'egoscope/linter-options',
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },

  {
    name: 'egoscope/javascript',
    extends: [eslintJs.configs.recommended],
  },

  {
    name: 'egoscope/typescript',
    files: TS_FILES,
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      importX.flatConfigs.recommended,
      sonarjsConfigs.recommended,
      unicorn.configs.recommended,
      regexp.configs['flat/recommended'],
      promise.configs['flat/recommended'],
      eslintComments.recommended,
    ],
    plugins: { 'check-file': checkFile, egoscope: egoscopePlugin },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs'],
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.mts', '.cts'] },
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: path.join(import.meta.dirname, 'tsconfig.json'),
        }),
      ],
    },
    rules: {
      // --- Correctness and clarity ---------------------------------------
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-implicit-coercion': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-restricted-syntax': ['error', ...EVERYWHERE_SYNTAX],
      'no-useless-rename': 'error',
      'no-void': ['error', { allowAsStatement: true }],
      'object-shorthand': ['error', 'always'],
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true }],

      // --- Comments that switch a check off ------------------------------------
      // The one ESLint comment allowed disables the next line, with a reason, and
      // TypeScript's expect-error directive is allowed in tests only (egoscope/tests).
      'egoscope/no-coverage-hints': 'error',
      'egoscope/no-tool-pragmas': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-check': false, 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true },
      ],
      // A `lib` or `types` reference would let DOM or Node types into the pure core.
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { lib: 'never', path: 'never', types: 'never' },
      ],

      // --- Size and complexity limits --------------------------------------
      complexity: ['error', { max: 10 }],
      'max-depth': ['error', { max: 3 }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-nested-callbacks': ['error', { max: 3 }],
      'max-statements': ['error', { max: 15 }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'sonarjs/cognitive-complexity': ['error', 10],

      // --- TypeScript ------------------------------------------------------
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // `onClick={() => setOpen(true)}` reads better than a braced one-statement body.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Interface merging with a single `extends` is how libraries are augmented.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          detectObjects: true,
          enforceConst: true,
        },
      ],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'forbid',
          trailingUnderscore: 'forbid',
        },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
        // React components are PascalCase functions.
        { selector: 'variable', types: ['function'], format: ['camelCase', 'PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        // Route handlers are named after their HTTP method.
        {
          selector: 'function',
          filter: { regex: '^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$', match: true },
          format: ['UPPER_CASE'],
        },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        // Environment variable names are UPPER_CASE.
        { selector: 'typeProperty', format: ['camelCase', 'UPPER_CASE'] },
        // Object keys also mirror outside vocabularies: tool options, AST node types, headers.
        {
          selector: 'objectLiteralProperty',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        },
        // ESLint rule visitors are named after AST node types.
        { selector: 'objectLiteralMethod', format: ['camelCase', 'PascalCase'] },
        // Header names, globs and the like need quotes and keep their own spelling.
        {
          selector: ['objectLiteralProperty', 'objectLiteralMethod', 'typeProperty', 'typeMethod'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
      ],

      // --- Imports ---------------------------------------------------------
      'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'import-x/no-default-export': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [...TEST_FILES, ...CONFIG_FILES, ...SCRIPT_FILES, ...E2E_FILES],
          optionalDependencies: false,
          peerDependencies: false,
        },
      ],
      'import-x/no-mutable-exports': 'error',
      'import-x/no-relative-packages': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-unassigned-import': ['error', { allow: ['**/*.css', 'server-only'] }],
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // --- Naming of files and folders (module rule 6) ----------------------
      'check-file/filename-naming-convention': [
        'error',
        { [`**/*.${TS}`]: 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'src/app/**/': 'NEXT_JS_APP_ROUTER_CASE', '{src/lib,scripts,data}/**/': 'KEBAB_CASE' },
      ],
      // check-file/* and the structure check already enforce kebab-case names.
      'unicorn/filename-case': 'off',

      // --- Inline ESLint comments --------------------------------------------
      '@eslint-community/eslint-comments/no-restricted-disable': ['error', ...UNDISABLEABLE_RULES],
      '@eslint-community/eslint-comments/no-use': [
        'error',
        { allow: ['eslint-disable-next-line'] },
      ],
      '@eslint-community/eslint-comments/require-description': 'error',

      // --- Preset rules tuned, each with its reason ---------------------------
      // One-line comments stay on one line: `/** Short description. */`.
      'unicorn/single-line-block-comment-style': ['error', 'single-line'],
      // `() => undefined` is the explicit no-op callback; the bare `() => {}` it
      // would ask for trips @typescript-eslint/no-empty-function.
      'unicorn/no-useless-undefined': ['error', { checkArrowFunctionBody: false }],

      // --- Opt-outs from presets, each with its reason ------------------------
      // TypeScript checks default imports, named imports and namespace members
      // exactly, as import-x's own TypeScript preset says; these were among the
      // costliest rules.
      'import-x/default': 'off',
      'import-x/named': 'off',
      'import-x/namespace': 'off',
      // TypeScript checks default and named imports exactly; these heuristics flag
      // the documented default-import style of typescript-eslint, fast-check and
      // most ESLint plugins.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
      // @typescript-eslint/no-deprecated (strict-type-checked) reports every use
      // of a deprecated API; this duplicate was the second costliest rule.
      'sonarjs/deprecation': 'off',
      // Declared return types already say what a function returns, and union
      // results are this codebase's way of reporting expected failures.
      'sonarjs/function-return-type': 'off',
      // JSDoc's ` * ` line prefixes are the convention that eslint-plugin-jsdoc
      // and every editor expect; this rule wants them removed.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      // Idiomatic names (props, params, env, ref) and box-score abbreviations read
      // better than the forced expansions this rule auto-fixes them into.
      'unicorn/name-replacements': 'off',
      // React components return null and JSON carries null; banning it fights both.
      'unicorn/no-null': 'off',
    },
  },

  {
    name: 'egoscope/react',
    files: [`src/**/*.tsx`],
    extends: [eslintReact.configs['strict-type-checked'], jsxA11y.configs.strict],
    rules: {
      // JSX is markup: components may be longer than plain functions.
      'max-lines-per-function': [
        'error',
        { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  {
    // Custom hooks live in .ts files too.
    name: 'egoscope/react-hooks',
    files: SRC_FILES,
    extends: [reactHooks.configs.flat['recommended-latest']],
  },

  {
    name: 'egoscope/next',
    files: SRC_FILES,
    extends: [nextPlugin.configs['core-web-vitals']],
    rules: {
      // Pages Router rule; this project only has the App Router.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    // Exported functions of src/lib explain what they do and cite the requirement
    // IDs they implement; types already document parameters and return values.
    name: 'egoscope/jsdoc',
    files: [`src/lib/**/*.${TS}`],
    ignores: TEST_FILES,
    extends: [jsdoc.configs['flat/recommended-typescript-error']],
    rules: {
      'jsdoc/informative-docs': 'error',
      'jsdoc/require-description': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true,
          },
        },
      ],
      // The signature's types say what goes in and out; the description says why.
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
    },
  },

  // --- Module rules -----------------------------------------------------------
  {
    name: 'egoscope/module-rules/src',
    files: SRC_FILES,
    rules: {
      // The pure-core block below replaces this list with a longer one.
      'no-restricted-globals': ['error', ...COMMONJS_GLOBALS],
      'no-restricted-properties': ['error', NO_PROCESS_ENV],
      'import-x/no-restricted-paths': layerZones(import.meta.dirname),
    },
  },
  ...MODULE_AREAS.map((area) => moduleArea(area)),
  {
    name: 'egoscope/module-rules/env',
    files: [`src/lib/env/**/*.${TS}`],
    rules: {
      // The env module is the one place that reads process.env.
      'no-restricted-properties': 'off',
    },
  },
  {
    name: 'egoscope/module-rules/log',
    files: ['src/lib/log/console-sink.ts'],
    rules: {
      // The console sink is the one place that writes to the console.
      'no-console': 'off',
    },
  },
  {
    name: 'egoscope/module-rules/pure-core',
    files: PURE_CORE_FILES,
    rules: {
      'no-restricted-globals': ['error', ...PURE_GLOBALS],
      'no-restricted-properties': ['error', NO_PROCESS_ENV, ...PURE_PROPERTIES],
      'egoscope/no-local-time': 'error',
    },
  },
  {
    // The one deliberate exception to the comment bans (CLAUDE.md): mutation testing
    // covers the pure core, where a genuinely equivalent mutant may be spared by the
    // reasoned next-line form of Stryker's comment (scripts/eslint-plugin.ts), whose
    // reason reviewers read.
    name: 'egoscope/equivalent-mutants',
    files: PURE_CORE_FILES,
    ignores: TEST_FILES,
    rules: {
      'egoscope/no-tool-pragmas': ['error', { equivalentMutants: true }],
    },
  },
  {
    // Coverage measures these files, and its remapper reads hints on any line of
    // them, strings included, not only in comments.
    name: 'egoscope/covered-code',
    files: SRC_FILES,
    ignores: TEST_FILES,
    rules: {
      'egoscope/no-coverage-hints': ['error', { text: true }],
    },
  },

  // --- Time (CLAUDE.md, "Time") ---------------------------------------------------
  {
    // Only src/lib/time reads the clock and parses dates. The lock wrapper,
    // scripts/with-lock.ts and its test, still times its waits with Date.now(): it
    // stays out, by name, until a follow-up task moves it to the clock of @/lib/time.
    name: 'egoscope/ambient-time',
    files: [...SRC_FILES, ...SCRIPT_FILES, ...E2E_FILES],
    ignores: ['src/lib/time/**', 'scripts/with-lock.ts', 'scripts/with-lock.test.ts'],
    rules: {
      'egoscope/no-ambient-time': 'error',
    },
  },
  {
    // The server and the owner's devices do not share a default locale.
    name: 'egoscope/default-locale',
    files: [...SRC_FILES, ...SCRIPT_FILES, ...E2E_FILES],
    rules: {
      'egoscope/no-default-locale': 'error',
    },
  },

  {
    // Coverage leaves route shells out (scripts/route-shells.ts), so lint keeps them
    // thin: SHELL_SYNTAX refuses loops, top-level helpers and stray exports, and
    // these caps bound the rest. What fits under them, a few conditionals, an
    // inline callback or a helper inside the component, is tolerated untested.
    name: 'egoscope/route-shells',
    files: [...ROUTE_SHELLS],
    rules: {
      complexity: ['error', { max: 3 }],
      'max-depth': ['error', { max: 1 }],
      'max-lines': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', { max: 2 }],
      'max-statements': ['error', { max: 6 }],
      'sonarjs/cognitive-complexity': ['error', 2],
    },
  },
  {
    name: 'egoscope/next-default-exports',
    files: NEXT_DEFAULT_EXPORT_FILES,
    rules: {
      // Next.js loads these files through their default export.
      'import-x/no-default-export': 'off',
    },
  },

  {
    name: 'egoscope/tests',
    files: TEST_FILES,
    extends: [vitest.configs.recommended, jestDom.configs['flat/recommended']],
    rules: {
      // Literal expected values are the point of a test.
      '@typescript-eslint/no-magic-numbers': 'off',
      // `describe` callbacks hold a whole suite; each `it` stays small instead.
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': ['error', { max: 4 }],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      // Tests feed fake credentials to prove that they never leak.
      'sonarjs/no-hardcoded-passwords': 'off',
      // A test may prove, with its reason, that a call does not type-check. The
      // directive fails the type check as soon as the error it expects is gone.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          minimumDescriptionLength: 10,
        },
      ],
      'egoscope/no-skipped-tests': 'error',
      // Vitest's version understands `expect(mock.method)`.
      '@typescript-eslint/unbound-method': 'off',
      'vitest/unbound-method': 'error',
      'vitest/consistent-test-it': ['error', { fn: 'it', withinDescribe: 'it' }],
      'vitest/consistent-vitest-vi': 'error',
      'vitest/hoisted-apis-on-top': 'error',
      'vitest/max-expects': ['error', { max: 5 }],
      'vitest/max-nested-describe': ['error', { max: 2 }],
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-conditional-tests': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/no-test-prefixes': 'error',
      'vitest/no-test-return-statement': 'error',
      'vitest/prefer-called-once': 'error',
      'vitest/prefer-comparison-matcher': 'error',
      'vitest/prefer-each': 'error',
      'vitest/prefer-equality-matcher': 'error',
      'vitest/prefer-hooks-in-order': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/prefer-import-in-mock': 'error',
      'vitest/prefer-importing-vitest-globals': 'error',
      'vitest/prefer-mock-promise-shorthand': 'error',
      'vitest/prefer-spy-on': 'error',
      'vitest/prefer-strict-boolean-matchers': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-vi-mocked': 'error',
      'vitest/require-awaited-expect-poll': 'error',
      'vitest/require-hook': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/require-top-level-describe': 'error',
      'vitest/valid-title': [
        'error',
        {
          mustMatch: {
            it: [
              TEST_TITLE,
              'Start with [REQ-ID] tags if the test verifies requirements, then describe the behavior.',
            ],
          },
        },
      ],
      'vitest/warn-todo': 'error',
    },
  },
  {
    name: 'egoscope/component-tests',
    files: COMPONENT_TEST_FILES,
    extends: [testingLibrary.configs['flat/react']],
  },

  {
    name: 'egoscope/config-files',
    files: CONFIG_FILES,
    rules: {
      // Tools load their configuration through a default export.
      'import-x/no-default-export': 'off',
      // Configuration values are named by their keys.
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    name: 'egoscope/eslint-config',
    files: ['eslint.config.ts'],
    rules: {
      // The whole lint policy reads top to bottom in one place.
      'max-lines': 'off',
    },
  },
  {
    name: 'egoscope/scripts',
    files: SCRIPT_FILES,
    rules: {
      // Command-line scripts report to the terminal.
      'no-console': 'off',
      // Developer scripts run the developer's own git, found on PATH like any shell command.
      'sonarjs/no-os-command-from-path': 'off',
    },
  },

  // Formatting belongs to Prettier: this switches off every rule it would fight.
  prettierConfig,
  {
    name: 'egoscope/after-prettier',
    files: TS_FILES,
    rules: {
      // Prettier never adds or removes braces, so `curly: all` cannot conflict.
      curly: ['error', 'all'],
    },
  },
);

/** Escalates every warning to an error: this project has no warnings. */
function escalate(entry: Linter.RuleEntry): Linter.RuleEntry {
  if (entry === 'warn' || entry === 1) {
    return 'error';
  }
  if (Array.isArray(entry) && (entry[0] === 'warn' || entry[0] === 1)) {
    const [, ...options]: readonly unknown[] = entry;
    return ['error', ...options];
  }
  return entry;
}

const config: Linter.Config[] = composed.map((block) =>
  block.rules === undefined
    ? block
    : {
        ...block,
        rules: Object.fromEntries(
          Object.entries(block.rules).map(([name, entry]) => [
            name,
            entry === undefined ? entry : escalate(entry),
          ]),
        ),
      },
);

export default config;
