/**
 * Which Vitest function an expression of a test file starts from, whatever name
 * the function goes by there: its own (`it.concurrent`), the name it is imported
 * under (`import { it as check }`), a member of the vitest namespace (`vitest.it`),
 * or a variable that holds it (`const databaseTest = it.extend({…})`). The
 * `no-skipped-tests` rule of eslint-plugin.ts asks it.
 */
import { AST_NODE_TYPES, ASTUtils, TSESLint } from '@typescript-eslint/utils';

import type { TSESTree } from '@typescript-eslint/utils';

const VITEST = 'vitest';

/** The node a chain of members and calls starts with: `it` in `it.concurrent(…).skip`. */
function chainStart(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.MemberExpression ||
    current.type === AST_NODE_TYPES.CallExpression
  ) {
    current = current.type === AST_NODE_TYPES.MemberExpression ? current.object : current.callee;
  }
  return current;
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
 * The name of the Vitest function that the chain of members and calls `node`
 * starts from: `it` for `it.concurrent.fails`, and also for `check.fails` after
 * `import { it as check } from 'vitest'` or `const check = it.extend({…})`. A
 * name that leads nowhere further is its own answer. `scope` is the scope of the
 * whole file, so that each name is looked up where it is used.
 */
export function vitestFunction(
  node: TSESTree.Node,
  scope: TSESLint.Scope.Scope,
): string | undefined {
  // The variables followed so far, so that a cycle of declarations ends.
  const followed = new Set<TSESLint.Scope.Variable>();
  let start = chainStart(node);
  while (start.type === AST_NODE_TYPES.Identifier) {
    const variable = ASTUtils.findVariable(scope, start);
    const definition = variable?.defs[0];
    if (variable === null || definition === undefined || followed.has(variable)) {
      return start.name;
    }
    if (
      definition.type !== TSESLint.Scope.DefinitionType.Variable ||
      definition.node.init === null
    ) {
      return vitestExport(definition, start) ?? start.name;
    }
    followed.add(variable);
    start = chainStart(definition.node.init);
  }
  return undefined;
}
