/**
 * The names that the start of an expression of a test file goes by, so that the
 * `no-skipped-tests` rule of eslint-plugin.ts knows a Vitest function by any of
 * them: its own (`it.concurrent`), the name it is imported under
 * (`import { it as check }`), a member of the vitest namespace (`vitest.it`), or
 * the name of a variable that holds it (`const databaseTest = it.extend({…})`).
 * Also what a name holds of the test context, so that the rule knows the context
 * from the fixtures that come with it.
 */
import { AST_NODE_TYPES, ASTUtils, TSESLint } from '@typescript-eslint/utils';

import type { TSESTree } from '@typescript-eslint/utils';

const VITEST = 'vitest';

/** What a name holds of a callback's argument, such as the test context: all of it, or its `skip`. */
type ArgumentPart = 'whole' | 'skip';

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

/** `node`, or the pattern that gives it a default value: `context = {}` around `context`. */
function withDefault(
  node: TSESTree.BindingName,
): TSESTree.AssignmentPattern | TSESTree.BindingName {
  const { parent } = node;
  return parent.type === AST_NODE_TYPES.AssignmentPattern && parent.left === node ? parent : node;
}

/**
 * What `name`, which `definition` binds as a parameter of a callback, holds of the
 * callback's argument, default values aside: the whole of it for the parameter
 * itself (`context`) and for the rest of its object pattern (`{ task, ...context }`),
 * or its `skip` for the name that the pattern's `skip` key binds (`{ skip }`,
 * `{ skip: pass }`). A key that cannot be read without running the code counts by
 * the name it binds (`{ [key]: skip }`). Any other name holds neither, such as a
 * fixture of a test made by `it.extend()` (`{ cursor }`) or a name in a nested pattern.
 */
function argumentPart(
  definition: TSESLint.Scope.Definitions.ParameterDefinition,
  name: string,
): ArgumentPart | undefined {
  const { parent } = withDefault(definition.name);
  if (parent === definition.node) {
    return 'whole';
  }
  const pattern = parent.parent;
  if (
    pattern?.type !== AST_NODE_TYPES.ObjectPattern ||
    withDefault(pattern).parent !== definition.node
  ) {
    return undefined;
  }
  // The entries of an object pattern are its properties and, last, its rest element.
  if (parent.type !== AST_NODE_TYPES.Property) {
    return 'whole';
  }
  return (ASTUtils.getPropertyName(parent) ?? name) === 'skip' ? 'skip' : undefined;
}

/**
 * What `node`, where it is used, holds of the test context (`argumentPart`), if a
 * parameter binds it of a callback passed to one of `owners`, known by any name it
 * goes by (`vitestNames`): `context` in `it('…', (context) => …)`. `scope` is the
 * scope of the whole file.
 */
export function contextPart(
  node: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
  owners: ReadonlySet<string>,
): ArgumentPart | undefined {
  const definition = ASTUtils.findVariable(scope, node)?.defs[0];
  const owner = definition?.node.parent;
  return definition?.type === TSESLint.Scope.DefinitionType.Parameter &&
    owner?.type === AST_NODE_TYPES.CallExpression &&
    vitestNames(owner.callee, scope).some((name) => owners.has(name))
    ? argumentPart(definition, node.name)
    : undefined;
}
