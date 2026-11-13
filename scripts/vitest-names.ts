/**
 * The names that the start of an expression of a test file goes by, so that the
 * `no-skipped-tests` rule of eslint-plugin.ts knows a Vitest function by any of
 * them: its own (`it.concurrent`), the name it is imported under
 * (`import { it as check }`), a member of the vitest namespace (`vitest.it`), or
 * the name of a variable that holds it (`const databaseTest = it.extend({…})`).
 */
import { AST_NODE_TYPES, ASTUtils, TSESLint } from '@typescript-eslint/utils';

import type { TSESTree } from '@typescript-eslint/utils';

const VITEST = 'vitest';

/**
 * The node that `node`, a link of a chain of members and calls, reads from, or
 * `undefined` when `node` is no link. A type assertion and an optional chain
 * keep the value they wrap.
 */
function linkTarget(node: TSESTree.Node): TSESTree.Node | undefined {
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    return node.object;
  }
  if (node.type === AST_NODE_TYPES.CallExpression) {
    return node.callee;
  }
  return node.type === AST_NODE_TYPES.ChainExpression ||
    node.type === AST_NODE_TYPES.TSAsExpression ||
    node.type === AST_NODE_TYPES.TSNonNullExpression ||
    node.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node.type === AST_NODE_TYPES.TSTypeAssertion
    ? node.expression
    : undefined;
}

/**
 * The node a chain of members and calls starts with: `it` in
 * `it.concurrent(…).skip`, and also in `(it.extend({}) as typeof it).skip`.
 */
function chainStart(node: TSESTree.Node): TSESTree.Node {
  const target = linkTarget(node);
  return target === undefined ? node : chainStart(target);
}

/** The member that a chain reads from `start`: `it` in `vitest.it.skipIf`. */
function memberRead(start: TSESTree.Identifier): string | undefined {
  const { parent } = start;
  return parent.type === AST_NODE_TYPES.MemberExpression &&
    parent.property.type === AST_NODE_TYPES.Identifier
    ? parent.property.name
    : undefined;
}

/**
 * The export of vitest that `start` stands for, if `definition` imports it from
 * vitest: `it` for `check` after `import { it as check }`, and for `vitest.it`
 * after `import * as vitest`.
 */
function vitestExport(
  definition: TSESLint.Scope.Definition,
  start: TSESTree.Identifier,
): string | undefined {
  const { node, parent } = definition;
  if (parent?.type !== AST_NODE_TYPES.ImportDeclaration || parent.source.value !== VITEST) {
    return undefined;
  }
  if (node.type === AST_NODE_TYPES.ImportSpecifier) {
    const { imported } = node;
    return imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value;
  }
  return node.type === AST_NODE_TYPES.ImportNamespaceSpecifier ? memberRead(start) : undefined;
}

/**
 * Every name that the start of the chain of members and calls `node` goes by,
 * from where it is used back to where it is declared: `check` and `it` for
 * `check.fails` after `import { it as check } from 'vitest'` or
 * `const check = it.extend({…})`. The name used always counts, also where the
 * declarations lead nowhere further, such as to a helper that builds a test.
 * `scope` is the scope of the whole file, so that each name is looked up where
 * it is used.
 */
export function vitestNames(node: TSESTree.Node, scope: TSESLint.Scope.Scope): readonly string[] {
  const names = new Set<string>();
  // The variables followed so far, so that a cycle of declarations ends.
  const followed = new Set<TSESLint.Scope.Variable>();
  let start = chainStart(node);
  while (start.type === AST_NODE_TYPES.Identifier) {
    names.add(start.name);
    const variable = ASTUtils.findVariable(scope, start);
    const definition = variable?.defs[0];
    if (variable === null || definition === undefined || followed.has(variable)) {
      break;
    }
    if (
      definition.type !== TSESLint.Scope.DefinitionType.Variable ||
      definition.node.init === null
    ) {
      // No value to follow: an import from vitest also goes by the name it exports.
      names.add(vitestExport(definition, start) ?? start.name);
      break;
    }
    followed.add(variable);
    start = chainStart(definition.node.init);
  }
  return [...names];
}
