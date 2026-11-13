/**
 * The two rules of the `egoscope` plugin that keep results independent of where
 * the code runs, registered by eslint-plugin.ts and probed in
 * eslint-plugin.test.ts. Both need type information.
 *
 * - `no-ambient-time`: outside src/lib/time, nothing reads the clock or makes a
 *   Date from anything but an instant, so that tests can fix the time and no
 *   date is parsed by rules of its own.
 * - `no-default-locale`: a result that depends on a locale names it, since the
 *   server and the owner's devices do not share one.
 */
import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

import type { TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-time-rules.ts#${name}`,
);

const isNamed = (node: TSESTree.Node, name: string): boolean =>
  node.type === AST_NODE_TYPES.Identifier && node.name === name;

// What reads the ambient time, and what parses a date, through a member: `Date.now`
// and `Temporal.Now` read the clock, `Date.parse` reads a string by rules of its own.
const AMBIENT_MEMBERS = [
  { object: 'Date', property: 'now', messageId: 'clock', shown: 'Date.now()' },
  { object: 'Date', property: 'parse', messageId: 'parse', shown: 'Date.parse()' },
  { object: 'Temporal', property: 'Now', messageId: 'clock', shown: 'Temporal.Now' },
] as const;

/** Forbids reading the clock and parsing dates, wherever eslint.config.ts applies it. */
export const noAmbientTime = createRule({
  name: 'no-ambient-time',
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid reading the clock and parsing dates outside src/lib/time.',
      requiresTypeChecking: true,
    },
    messages: {
      clock:
        '`{{shown}}` reads the ambient time: take the instant from `now()` of `@/lib/time`, whose clock tests can fix (CLAUDE.md, "Time").',
      parse:
        '`{{shown}}` parses a date by rules of its own: read it with `parseTimestamp` or `parseIsoDate` of `@/lib/time` (CLAUDE.md, "Time").',
      fields:
        '`new Date(year, month, …)` reads calendar fields in the time zone of the machine: convert them with `@/lib/time` (CLAUDE.md, "Time").',
    },
    schema: [],
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    // An instant: epoch milliseconds, or another Date.
    const isInstant = (node: TSESTree.Node): boolean => {
      const type = services.getTypeAtLocation(node);
      return (
        checker.isTypeAssignableTo(type, checker.getNumberType()) ||
        type.getSymbol()?.getName() === 'Date'
      );
    };
    return {
      MemberExpression(node): void {
        const property = ASTUtils.getPropertyName(node, context.sourceCode.getScope(node));
        const member = AMBIENT_MEMBERS.find(
          (candidate) => isNamed(node.object, candidate.object) && candidate.property === property,
        );
        if (member !== undefined) {
          context.report({ node, messageId: member.messageId, data: { shown: member.shown } });
        }
      },
      CallExpression(node): void {
        if (isNamed(node.callee, 'Date')) {
          context.report({ node, messageId: 'clock', data: { shown: 'Date()' } });
        }
      },
      NewExpression(node): void {
        if (!isNamed(node.callee, 'Date')) {
          return;
        }
        const [argument, ...others] = node.arguments;
        if (argument === undefined) {
          context.report({ node, messageId: 'clock', data: { shown: 'new Date()' } });
        } else if (others.length > 0) {
          context.report({ node, messageId: 'fields' });
        } else if (!isInstant(argument)) {
          context.report({ node, messageId: 'parse', data: { shown: 'new Date(string)' } });
        }
      },
    };
  },
});

// The methods whose result depends on a locale, with the position of their locale
// argument; every `Intl` constructor takes its locale first.
const LOCALE_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ['localeCompare', 1],
  ['toLocaleDateString', 0],
  ['toLocaleLowerCase', 0],
  ['toLocaleString', 0],
  ['toLocaleTimeString', 0],
  ['toLocaleUpperCase', 0],
]);
const INTL_CONSTRUCTOR = /^[A-Z]/u;

/** The `Intl` constructor that `callee` names, such as `DateTimeFormat`, if it names one. */
function intlConstructor(callee: TSESTree.Expression): string | undefined {
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    isNamed(callee.object, 'Intl') &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    INTL_CONSTRUCTOR.test(callee.property.name)
    ? callee.property.name
    : undefined;
}

/** Requires an explicit locale wherever a result depends on one. */
export const noDefaultLocale = createRule({
  name: 'no-default-locale',
  meta: {
    type: 'problem',
    docs: {
      description: 'Require an explicit locale wherever a result depends on one.',
      requiresTypeChecking: true,
    },
    messages: {
      method:
        "`{{name}}` without a locale follows the machine it runs on, and the server and the owner's devices differ: pass the locale, such as 'en-US' (CLAUDE.md, \"Time\").",
      intl: "`Intl.{{name}}` without a locale follows the machine it runs on, and the server and the owner's devices differ: pass the locale, such as 'en-US' (CLAUDE.md, \"Time\").",
    },
    schema: [],
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    // A locale argument that names a locale: not left out, spread or an empty list,
    // and never undefined (`undefined` itself included).
    const isExplicitLocale = (argument: TSESTree.CallExpressionArgument | undefined): boolean =>
      argument !== undefined &&
      argument.type !== AST_NODE_TYPES.SpreadElement &&
      !(argument.type === AST_NODE_TYPES.ArrayExpression && argument.elements.length === 0) &&
      !checker.isTypeAssignableTo(checker.getUndefinedType(), services.getTypeAtLocation(argument));
    const checkIntl = (node: TSESTree.CallExpression | TSESTree.NewExpression): void => {
      const name = intlConstructor(node.callee);
      if (name !== undefined && !isExplicitLocale(node.arguments[0])) {
        context.report({ node: node.callee, messageId: 'intl', data: { name } });
      }
    };
    return {
      CallExpression(node): void {
        checkIntl(node);
        const { callee } = node;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        const name = ASTUtils.getPropertyName(callee, context.sourceCode.getScope(node)) ?? '';
        const position = LOCALE_ARGUMENT.get(name);
        if (position !== undefined && !isExplicitLocale(node.arguments[position])) {
          context.report({ node: callee.property, messageId: 'method', data: { name } });
        }
      },
      NewExpression: checkIntl,
    };
  },
});
