/**
 * The `no-ad-hoc-format` rule of the `egoscope` plugin, registered by eslint-plugin.ts
 * and probed in eslint-format-rule.test.ts. People read numbers and dates in the
 * formats of record 0010 (IHM-13, CL-IHM-03, CL-IHM-04), which only the formatters of
 * `@/lib/wording` and `@/lib/time` write, so eslint.config.ts applies the rule to src/
 * outside those two modules. It refuses, whatever value they are read from and in
 * whatever way a property is named (`value.toFixed`, `value['toFixed']`, a destructured
 * `{ toFixed }`), the methods that write a number or a date by themselves — `toFixed`,
 * `toPrecision`, `toExponential`, `toLocaleString`, `toLocaleDateString`,
 * `toLocaleTimeString` — and the number and date formats of `Intl`, `Intl.NumberFormat`
 * and `Intl.DateTimeFormat`, also read through `globalThis`. It needs no type
 * information: no other value has these names.
 */
import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

import { isNamed } from './eslint-time-checks';

import type { TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-format-rule.ts#${name}`,
);

// The methods that write a number or a date by themselves.
const FORMAT_METHODS: ReadonlySet<string> = new Set([
  'toExponential',
  'toFixed',
  'toLocaleDateString',
  'toLocaleString',
  'toLocaleTimeString',
  'toPrecision',
]);
// The number and date formats of Intl.
const INTL_FORMATS: ReadonlySet<string> = new Set(['DateTimeFormat', 'NumberFormat']);

/** Says whether `node` reads `Intl`: `Intl` itself, or `globalThis.Intl` and the like. */
const isIntl = (node: TSESTree.Node): boolean =>
  isNamed(node, 'Intl') ||
  (node.type === AST_NODE_TYPES.MemberExpression && isNamed(node.property, 'Intl'));

/** Forbids writing numbers and dates outside the formatters, wherever eslint.config.ts applies it. */
export const noAdHocFormat = createRule({
  name: 'no-ad-hoc-format',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid writing numbers and dates outside the formatters of @/lib/wording and @/lib/time.',
    },
    messages: {
      format:
        '`{{shown}}` writes a number or a date by itself: write numbers with formatGap, formatIndex, formatCount or formatShare of `@/lib/wording`, and dates with formatInstant, formatDate or formatGameTime of `@/lib/time`, which follow the formats of record 0010 (IHM-13).',
    },
    schema: [],
  },
  create(context) {
    const report = (node: TSESTree.Node, shown: string): void => {
      context.report({ node, messageId: 'format', data: { shown } });
    };
    return {
      MemberExpression(node): void {
        const name = ASTUtils.getPropertyName(node, context.sourceCode.getScope(node));
        if (name !== null && FORMAT_METHODS.has(name)) {
          report(node, name);
        } else if (name !== null && INTL_FORMATS.has(name) && isIntl(node.object)) {
          report(node, `Intl.${name}`);
        }
      },
      // `const { toFixed } = Number.prototype` and `const { NumberFormat } = Intl`.
      'ObjectPattern > Property'(node: TSESTree.Property): void {
        const name = ASTUtils.getPropertyName(node, context.sourceCode.getScope(node));
        if (name !== null && (FORMAT_METHODS.has(name) || INTL_FORMATS.has(name))) {
          report(node, name);
        }
      },
    };
  },
});
