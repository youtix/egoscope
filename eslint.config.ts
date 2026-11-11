/**
 * The lint policy of the whole repository, in one file.
 *
 * - Every enabled rule is an error: presets that ship warnings are escalated at
 *   the end of this file, and the scripts run ESLint with `--max-warnings 0`.
 * - Each rule switched off from a preset carries its reason on the line above.
 * - The six module rules of CLAUDE.md are enforced in "Module rules" below, and
 *   eslint.config.test.ts proves that each of them rejects a violation.
 *
 * Never weaken a rule to get green: fix the code, or raise the problem in the PR.
 */
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

import type { Linter } from 'eslint';

// ---------------------------------------------------------------------------
// File sets
// ---------------------------------------------------------------------------

const TS_FILES = ['**/*.{ts,tsx,mts}'];
const TEST_FILES = ['**/*.test.{ts,tsx}'];
const COMPONENT_TEST_FILES = ['**/*.test.tsx'];
const CONFIG_FILES = ['*.config.ts', 'vitest.dom-setup.ts'];
const SCRIPT_FILES = ['scripts/**/*.ts'];

// Next.js special files under src/app.
const ROUTE_SHELLS = [
  'src/app/**/{page,layout,template,loading,error,global-error,not-found,forbidden,unauthorized,default}.tsx',
];
const NEXT_DEFAULT_EXPORT_FILES = [
  ...ROUTE_SHELLS,
  'src/app/**/{opengraph-image,twitter-image,icon,apple-icon,sitemap,robots,manifest}.{ts,tsx}',
];

// A test title is optional requirement tags, then a plain description:
// "[JOU-04] [CA-TRV-12] rejects a 31st active player".
const TEST_TITLE = String.raw`^(?:\[[A-Z]+(?:-[A-Z]+)*-\d+\] )*[^\s[]`;

// ---------------------------------------------------------------------------
// Module rules (CLAUDE.md). Each list is composed per area below, because ESLint
// replaces a rule's options instead of merging them across config objects.
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
const PURE_CORE_MESSAGE =
  'The statistics core is pure: it imports nothing outside itself, does no I/O and reads no clock, randomness or environment; pass such values in as arguments (module rule 2).';
const NO_IMPORT_OUTSIDE_PURE_CORE: ImportPattern = {
  regex: String.raw`^(?!\.\.?/)`,
  message: PURE_CORE_MESSAGE,
};
const NO_IMPORT_OUTSIDE_PURE_CORE_TESTS: ImportPattern = {
  regex: String.raw`^(?!\.\.?/|vitest$|fast-check$|@data/)`,
  message: `${PURE_CORE_MESSAGE} Its tests may also import vitest, fast-check and fixtures from @data/.`,
};

const restrictImports = (...patterns: readonly ImportPattern[]): Linter.RuleEntry => [
  'error',
  { patterns },
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
];
const BARREL_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector: 'Program > :not(ExportNamedDeclaration[source])',
    message:
      "A module's index.ts only re-exports its public API: `export { name } from './file'` (module rule 4).",
  },
];
const ROUTE_SHELL_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector:
      ':matches(ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement, SwitchStatement, TryStatement)',
    message:
      'Route files stay thin: move logic to a colocated module or to src/lib/<module>, where it is unit-tested.',
  },
  {
    selector:
      'Program > FunctionDeclaration, Program > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
    message:
      'Route files stay thin: move helpers and sub-components to a colocated module, where they are unit-tested.',
  },
];
const PURE_CORE_SYNTAX: readonly SyntaxRestriction[] = [
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: PURE_CORE_MESSAGE },
  { selector: "CallExpression[callee.name='Date']", message: PURE_CORE_MESSAGE },
  { selector: "MetaProperty[meta.name='import']", message: PURE_CORE_MESSAGE },
  { selector: 'ImportExpression', message: PURE_CORE_MESSAGE },
  { selector: ':function[async=true], AwaitExpression', message: PURE_CORE_MESSAGE },
];

const restrictSyntax = (...lists: readonly (readonly SyntaxRestriction[])[]): Linter.RuleEntry => [
  'error',
  ...lists.flat(),
];

const NO_PROCESS_ENV: PropertyRestriction = {
  object: 'process',
  property: 'env',
  message: 'Read configuration through `@/lib/env`, which validates it once (secrets rule).',
};
const PURE_CORE_PROPERTIES: readonly PropertyRestriction[] = [
  { object: 'Date', property: 'now', message: PURE_CORE_MESSAGE },
  { object: 'Math', property: 'random', message: PURE_CORE_MESSAGE },
  { object: 'Temporal', property: 'Now', message: PURE_CORE_MESSAGE },
];
const PURE_CORE_GLOBALS = [
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
].map((name) => ({ name, message: PURE_CORE_MESSAGE }));

// Rules that no inline comment may switch off: change this file in a reviewed PR instead.
const UNDISABLEABLE_RULES = [
  '@typescript-eslint/ban-ts-comment',
  'check-file/*',
  'complexity',
  'import-x/no-cycle',
  'import-x/no-default-export',
  'import-x/no-restricted-paths',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-statements',
  '@typescript-eslint/max-params',
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
  globalIgnores(['.next/', '.vitest/', 'coverage/', 'out/', 'reports/', 'next-env.d.ts']),

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
    plugins: { 'check-file': checkFile },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.mts', '.js', '.mjs'],
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.mts'] },
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ alwaysTryTypes: true, project: 'tsconfig.json' }),
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
      'no-restricted-syntax': restrictSyntax(EVERYWHERE_SYNTAX),
      'no-useless-rename': 'error',
      'no-void': ['error', { allowAsStatement: true }],
      'object-shorthand': ['error', 'always'],
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true }],

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
          devDependencies: [...TEST_FILES, ...CONFIG_FILES, ...SCRIPT_FILES],
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
        { '**/*.{ts,tsx,mts}': 'KEBAB_CASE' },
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
      // TypeScript checks default and named imports exactly; these heuristics flag
      // the documented default-import style of typescript-eslint, fast-check and
      // most ESLint plugins.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
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
    files: ['src/**/*.tsx'],
    extends: [
      eslintReact.configs['strict-type-checked'],
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.configs.strict,
    ],
    rules: {
      // JSX is markup: components may be longer than plain functions.
      'max-lines-per-function': [
        'error',
        { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  {
    name: 'egoscope/next',
    files: ['src/**/*.{ts,tsx}'],
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
    files: ['src/lib/**/*.{ts,tsx}'],
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
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', NO_PROCESS_ENV],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: [
            { target: './src/lib', from: './src/app', message: NO_APP_FROM_LIB.message },
            {
              target: './src/lib/stats-engine',
              from: './src',
              except: ['./lib/stats-engine'],
              message: PURE_CORE_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    name: 'egoscope/module-rules/app',
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(
        NO_DEEP_LIB_IMPORT,
        NO_ROUTE_FROM_ROUTE,
        NO_RELATIVE_EXIT_FROM_ROUTE,
        NO_RELATIVE_ENTRY_INTO_ROUTE,
      ),
    },
  },
  {
    name: 'egoscope/module-rules/lib-module-root',
    files: ['src/lib/*/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(
        NO_DEEP_LIB_IMPORT,
        NO_APP_FROM_LIB,
        NO_RELATIVE_EXIT_FROM_MODULE,
      ),
    },
  },
  {
    name: 'egoscope/module-rules/lib-module-subfolder',
    files: ['src/lib/*/*/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(
        NO_DEEP_LIB_IMPORT,
        NO_APP_FROM_LIB,
        NO_RELATIVE_EXIT_FROM_SUBFOLDER,
      ),
    },
  },
  {
    name: 'egoscope/module-rules/barrels',
    files: ['src/lib/*/index.ts'],
    rules: {
      'no-restricted-syntax': restrictSyntax(EVERYWHERE_SYNTAX, BARREL_SYNTAX),
    },
  },
  {
    name: 'egoscope/module-rules/env',
    files: ['src/lib/env/**/*.ts'],
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
    name: 'egoscope/module-rules/stats-engine',
    files: ['src/lib/stats-engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...PURE_CORE_GLOBALS],
      'no-restricted-properties': ['error', NO_PROCESS_ENV, ...PURE_CORE_PROPERTIES],
      'no-restricted-syntax': restrictSyntax(EVERYWHERE_SYNTAX, PURE_CORE_SYNTAX),
    },
  },
  {
    name: 'egoscope/module-rules/stats-engine-module-root',
    files: ['src/lib/stats-engine/*.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        NO_IMPORT_OUTSIDE_PURE_CORE,
        NO_RELATIVE_EXIT_FROM_MODULE,
      ),
    },
  },
  {
    name: 'egoscope/module-rules/stats-engine-subfolder',
    files: ['src/lib/stats-engine/*/*.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        NO_IMPORT_OUTSIDE_PURE_CORE,
        NO_RELATIVE_EXIT_FROM_SUBFOLDER,
      ),
    },
  },
  {
    name: 'egoscope/module-rules/stats-engine-tests',
    files: ['src/lib/stats-engine/*.test.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        NO_IMPORT_OUTSIDE_PURE_CORE_TESTS,
        NO_RELATIVE_EXIT_FROM_MODULE,
      ),
    },
  },
  {
    name: 'egoscope/module-rules/stats-engine-index',
    files: ['src/lib/stats-engine/index.ts'],
    rules: {
      'no-restricted-syntax': restrictSyntax(EVERYWHERE_SYNTAX, BARREL_SYNTAX, PURE_CORE_SYNTAX),
    },
  },

  {
    // Route shells are excluded from unit coverage (vitest.config.ts), so these
    // caps keep them thin enough that no logic can hide in them.
    name: 'egoscope/route-shells',
    files: ROUTE_SHELLS,
    rules: {
      complexity: ['error', { max: 3 }],
      'max-depth': ['error', { max: 1 }],
      'max-lines': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', { max: 6 }],
      'no-restricted-syntax': restrictSyntax(EVERYWHERE_SYNTAX, ROUTE_SHELL_SYNTAX),
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
      // Repeated literals keep each test readable on its own.
      'sonarjs/no-duplicate-string': 'off',
      // Tests feed fake credentials to prove that they never leak.
      'sonarjs/no-hardcoded-passwords': 'off',
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
