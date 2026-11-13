/**
 * The project's own ESLint rules, loaded by eslint.config.ts as the `egoscope`
 * plugin. eslint-plugin.test.ts proves that each of them bites.
 *
 * - `no-coverage-hints`: hints that tell a coverage tool to skip code would take
 *   that code out of the coverage gate without anyone noticing.
 * - `no-tool-pragmas`: comments that switch another tool of the gate off.
 * - `no-skipped-tests`: tests switched off while the suite runs.
 * - `no-local-time` (needs type information): in the pure core, a date is an
 *   absolute instant. Methods that read or write local time, string conversions
 *   that print it, and constructors that parse strings or take local calendar
 *   fields all depend on the machine's time zone. The UTC methods stay allowed.
 */
import { AST_NODE_TYPES, AST_TOKEN_TYPES, ESLintUtils } from '@typescript-eslint/utils';

import { contextPart, vitestNames } from './vitest-names';

import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import type { ESLint } from 'eslint';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-plugin.ts#${name}`,
);

// The coverage hints of V8 and c8, Istanbul and Node's test runner. (These comments
// name them without spelling a hint, which this very rule would refuse.)
//
// ast-v8-to-istanbul, behind @vitest/coverage-v8, reads them with three expressions:
// the hints with if, else, next or file in comments, and those with start or stop
// on any line of a covered file, strings included. All three begin with this core,
// with no anchor or word boundary in front, so the rule refuses whatever the
// remapper honours; eslint-plugin.test.ts compares it with the remapper's source.
// The rule also ignores case, which the remapper does not.
/** The expression that every coverage hint of ast-v8-to-istanbul begins with. */
export const REMAPPER_HINT = /(?:istanbul|[cv]8|node:coverage)\s+ignore/iu;
// Node's own test runner also reads its disable and enable comments, with the same prefix.
const NODE_RUNNER_HINT = /node:coverage/iu;

const isCoverageHint = (text: string): boolean =>
  REMAPPER_HINT.test(text) || NODE_RUNNER_HINT.test(text);

// Comments that the gate's other tools obey: Prettier skips the next node,
// Stryker stops mutating, and knip never reports an export tagged this way.
const TOOL_PRAGMAS = [
  { pattern: /\bprettier-ignore\b/iu, messageId: 'prettier' },
  { pattern: /\bStryker\s+(?:disable|restore)\b/iu, messageId: 'stryker' },
  { pattern: /(?:^|\s)@(?:public|beta|alias|internal)\b/u, messageId: 'knip' },
] as const;

// The one Stryker comment allowed, where the rule's `equivalentMutants` option is on
// (the non-test files of the pure core): it spares the next line from the named
// mutators, for a mutant that no test can tell from the code, with the reason why.
// Stryker reads mutator names in any letter case, and `all` names every mutator, so
// `All` or `ALL` is refused too.
const EQUIVALENT_MUTANT =
  /^Stryker disable next-line (?<mutators>[A-Z][A-Za-z]*(?:,\s*[A-Z][A-Za-z]*)*): (?<reason>.+)$/u;
const EVERY_MUTATOR = 'all';
const MIN_REASON_LENGTH = 20;

/** Says whether `comment` is the one allowed form for an equivalent mutant. */
function isEquivalentMutant(comment: TSESTree.Comment): boolean {
  const groups = EQUIVALENT_MUTANT.exec(comment.value.trim())?.groups;
  const mutators = (groups?.['mutators'] ?? '').split(',').map((name) => name.trim().toLowerCase());
  const reason = groups?.['reason'] ?? '';
  return (
    comment.type === AST_TOKEN_TYPES.Line &&
    !mutators.includes(EVERY_MUTATOR) &&
    reason.trim().length >= MIN_REASON_LENGTH
  );
}

// Vitest calls that skip a test, run it only under a condition, or turn its
// failure into a pass, on Vitest's own objects and their chains (`it.concurrent.fails`),
// whatever name an object goes by (vitest-names.ts), such as a test made by `it.extend()`.
// The Vitest plugin's own rules refuse the skip, only and to-do modifiers too.
const SKIPPING_CALLS: ReadonlySet<string> = new Set(['skip', 'skipIf', 'runIf', 'fails']);
const VITEST_OBJECTS: ReadonlySet<string> = new Set(['it', 'test', 'describe', 'suite', 'bench']);
// The calls whose callback receives the test context, whose skip() skips the test.
const CONTEXT_OWNERS: ReadonlySet<string> = new Set([...VITEST_OBJECTS, 'beforeEach', 'afterEach']);

const LOCAL_TIME_METHODS: ReadonlySet<string> = new Set([
  'getDate',
  'getDay',
  'getFullYear',
  'getHours',
  'getMilliseconds',
  'getMinutes',
  'getMonth',
  'getSeconds',
  'getTimezoneOffset',
  'getYear',
  'setDate',
  'setFullYear',
  'setHours',
  'setMilliseconds',
  'setMinutes',
  'setMonth',
  'setSeconds',
  'setYear',
  'toDateString',
  'toLocaleDateString',
  'toLocaleString',
  'toLocaleTimeString',
  'toString',
  'toTimeString',
]);

const isNamed = (node: TSESTree.Node, name: string): boolean =>
  node.type === AST_NODE_TYPES.Identifier && node.name === name;

/** Reports each comment whose text `isMatch` accepts, and returns the lines they cover. */
function reportComments(
  sourceCode: Readonly<TSESLint.SourceCode>,
  isMatch: (text: string) => boolean,
  report: (comment: TSESTree.Comment) => void,
): ReadonlySet<number> {
  const lines = new Set<number>();
  for (const comment of sourceCode.getAllComments()) {
    if (!isMatch(comment.value)) {
      continue;
    }
    report(comment);
    for (let line = comment.loc.start.line; line <= comment.loc.end.line; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

/** Reports each line that holds a coverage hint, except the lines in `skipped`. */
function reportHintLines(
  sourceCode: Readonly<TSESLint.SourceCode>,
  skipped: ReadonlySet<number>,
  report: (loc: TSESTree.SourceLocation) => void,
): void {
  for (const [index, text] of sourceCode.lines.entries()) {
    const line = index + 1;
    if (skipped.has(line) || !isCoverageHint(text)) {
      continue;
    }
    report({ start: { line, column: 0 }, end: { line, column: text.length } });
  }
}

const noCoverageHints = createRule<[{ text: boolean }], 'hint' | 'text'>({
  name: 'no-coverage-hints',
  meta: {
    type: 'problem',
    docs: { description: 'Forbid coverage ignore hints, which hide code from the coverage gate.' },
    messages: {
      hint: 'Coverage ignore hints are forbidden: coverage counts every line, so test this code instead.',
      text: 'The coverage remapper reads every line of a covered file, so this text works as a coverage ignore hint: reword it.',
    },
    schema: [
      {
        type: 'object',
        properties: { text: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ text: false }],
  },
  create(context, [{ text }]) {
    return {
      Program(): void {
        const reported = reportComments(context.sourceCode, isCoverageHint, (comment) => {
          context.report({ loc: comment.loc, messageId: 'hint' });
        });
        if (text) {
          reportHintLines(context.sourceCode, reported, (loc) => {
            context.report({ loc, messageId: 'text' });
          });
        }
      },
    };
  },
});

const noToolPragmas = createRule<[{ equivalentMutants: boolean }], 'prettier' | 'stryker' | 'knip'>(
  {
    name: 'no-tool-pragmas',
    meta: {
      type: 'problem',
      docs: { description: 'Forbid comments that switch another tool of the gate off.' },
      messages: {
        prettier:
          '`prettier-ignore` switches Prettier off for the next node: let Prettier format it.',
        stryker:
          'Stryker comments switch mutation testing off: test the code until its mutants die. The one exception, for an equivalent mutant in the non-test files of the pure core, is `// Stryker disable next-line <Mutator>: <reason of 20 characters or more>`, which names each mutator, never `all` (CLAUDE.md).',
        knip: 'knip never reports an export tagged `@public`, `@beta`, `@alias` or `@internal`: use the export, or delete it.',
      },
      schema: [
        {
          type: 'object',
          properties: { equivalentMutants: { type: 'boolean' } },
          additionalProperties: false,
        },
      ],
      defaultOptions: [{ equivalentMutants: false }],
    },
    create(context, [{ equivalentMutants }]) {
      return {
        Program(): void {
          for (const { pattern, messageId } of TOOL_PRAGMAS) {
            const isMatch = (text: string): boolean => pattern.test(text);
            reportComments(context.sourceCode, isMatch, (comment) => {
              const isAllowed =
                messageId === 'stryker' && equivalentMutants && isEquivalentMutant(comment);
              if (!isAllowed) {
                context.report({ loc: comment.loc, messageId });
              }
            });
          }
        },
      };
    },
  },
);

/**
 * Says whether `callee` is skip() from the test context (vitest-names.ts): `context.skip`,
 * where `context` holds the whole context, or a destructured `skip`, but not `cursor.skip`
 * on a fixture.
 */
function isContextSkip(callee: TSESTree.Expression, scope: TSESLint.Scope.Scope): boolean {
  const isMember =
    callee.type === AST_NODE_TYPES.MemberExpression && isNamed(callee.property, 'skip');
  const holder = isMember ? callee.object : callee;
  return (
    holder.type === AST_NODE_TYPES.Identifier &&
    contextPart(holder, scope, CONTEXT_OWNERS) === (isMember ? 'whole' : 'skip')
  );
}

/** The skipping member that `callee` takes from a Vitest object: `skipIf` in `it.skipIf`. */
function vitestSkippingMember(
  callee: TSESTree.Expression,
  scope: TSESLint.Scope.Scope,
): string | undefined {
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    SKIPPING_CALLS.has(callee.property.name) &&
    vitestNames(callee.object, scope).some((name) => VITEST_OBJECTS.has(name))
    ? callee.property.name
    : undefined;
}

/**
 * The skipping call that `callee` makes, if any: a skipping member of a Vitest
 * object (`it.skipIf`), or skip() from the test context.
 */
function skippingCall(
  callee: TSESTree.Expression,
  scope: TSESLint.Scope.Scope,
): string | undefined {
  return isContextSkip(callee, scope) ? 'skip' : vitestSkippingMember(callee, scope);
}

const noSkippedTests = createRule({
  name: 'no-skipped-tests',
  meta: {
    type: 'problem',
    docs: { description: 'Forbid tests that are switched off while the suite runs.' },
    messages: {
      skip: '`{{name}}` switches a test off, or turns its failure into a pass: a test runs and passes, or it is deleted.',
    },
    schema: [],
  },
  create(context) {
    // The scope of the whole file: a lookup from it finds each name where it is used.
    const scope = context.sourceCode.getScope(context.sourceCode.ast);
    return {
      CallExpression(node): void {
        const name = skippingCall(node.callee, scope);
        if (name !== undefined) {
          context.report({ node: node.callee, messageId: 'skip', data: { name } });
        }
      },
    };
  },
});

const noLocalTime = createRule({
  name: 'no-local-time',
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid time-zone-dependent Date operations in the pure core.',
      requiresTypeChecking: true,
    },
    messages: {
      method:
        '`{{method}}` depends on the time zone of the machine: use the UTC methods (getUTC*, setUTC*, toISOString) on absolute instants (module rule 2).',
      fields:
        '`new Date(year, month, …)` reads local calendar fields: build the instant with Date.UTC(…) (module rule 2).',
      parse:
        '`new Date(string)` parses with time-zone rules: take the instant in milliseconds instead (module rule 2).',
    },
    schema: [],
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const isDate = (node: TSESTree.Node): boolean => {
      const type = checker.getNonNullableType(services.getTypeAtLocation(node));
      const parts = type.isUnion() ? type.types : [type];
      return parts.some((part) => part.getSymbol()?.getName() === 'Date');
    };
    const isNumber = (node: TSESTree.Node): boolean =>
      checker.isTypeAssignableTo(services.getTypeAtLocation(node), checker.getNumberType());
    return {
      MemberExpression(node): void {
        const { property } = node;
        if (
          property.type === AST_NODE_TYPES.Identifier &&
          LOCAL_TIME_METHODS.has(property.name) &&
          isDate(node.object)
        ) {
          context.report({ node: property, messageId: 'method', data: { method: property.name } });
        }
      },
      CallExpression(node): void {
        const [argument] = node.arguments;
        if (argument !== undefined && isNamed(node.callee, 'String') && isDate(argument)) {
          context.report({ node, messageId: 'method', data: { method: 'String(date)' } });
        }
      },
      NewExpression(node): void {
        if (!isNamed(node.callee, 'Date')) {
          return;
        }
        const [argument, ...others] = node.arguments;
        if (others.length > 0) {
          context.report({ node, messageId: 'fields' });
        } else if (argument !== undefined && !isNumber(argument) && !isDate(argument)) {
          context.report({ node, messageId: 'parse' });
        }
      },
    };
  },
});

const rules = {
  'no-coverage-hints': noCoverageHints,
  'no-local-time': noLocalTime,
  'no-skipped-tests': noSkippedTests,
  'no-tool-pragmas': noToolPragmas,
};

/** The `egoscope` ESLint plugin. */
export const egoscopePlugin: ESLint.Plugin = {
  meta: { name: 'egoscope' },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- typescript-eslint's RuleModule is an ESLint rule; only the two libraries' context typings differ.
  rules: rules as unknown as ESLint.Plugin['rules'],
};
