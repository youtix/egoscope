/**
 * The project's own ESLint rules, loaded by eslint.config.ts as the `egoscope`
 * plugin. eslint-plugin.test.ts proves that each of them bites.
 *
 * - `no-coverage-hints`: comments that tell a coverage tool to skip code would
 *   take that code out of the coverage gate without anyone noticing.
 * - `no-local-time` (needs type information): in the pure core, a date is an
 *   absolute instant. Methods that read or write local time, string conversions
 *   that print it, and constructors that parse strings or take local calendar
 *   fields all depend on the machine's time zone. The UTC methods stay allowed.
 */
import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';

import type { TSESTree } from '@typescript-eslint/utils';
import type { ESLint } from 'eslint';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-plugin.ts#${name}`,
);

// The ignore hints of V8, c8 and Istanbul, with any spacing or case.
const COVERAGE_HINT = /\b(?:v8|c8|istanbul)\s+ignore\b/iu;

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

const noCoverageHints = createRule({
  name: 'no-coverage-hints',
  meta: {
    type: 'problem',
    docs: { description: 'Forbid comments that hide code from the coverage gate.' },
    messages: {
      hint: 'Coverage ignore hints are forbidden: coverage counts every line, so test this code instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          if (COVERAGE_HINT.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'hint' });
          }
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

const rules = { 'no-coverage-hints': noCoverageHints, 'no-local-time': noLocalTime };

/** The `egoscope` ESLint plugin. */
export const egoscopePlugin: ESLint.Plugin = {
  meta: { name: 'egoscope' },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- typescript-eslint's RuleModule is an ESLint rule; only the two libraries' context typings differ.
  rules: rules as unknown as ESLint.Plugin['rules'],
};
