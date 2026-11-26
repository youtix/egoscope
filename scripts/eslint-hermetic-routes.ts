/**
 * The `hermetic-test-routes` rule of the `egoscope` plugin, registered by eslint-plugin.ts
 * and probed in eslint-hermetic-routes.test.ts. A route under src/app/api/test/ controls the
 * running app from the end-to-end specs, in the hermetic mode only (CLAUDE.md, "End-to-end
 * tests"), so eslint.config.ts applies the rule to those route.ts files alone. Each value
 * that such a file exports is a handler, an async function declaration that starts as
 * /api/test/ping does: its first statement is `await connection();`, and its second tests
 * `isHermetic()`, as `return isHermetic() ? … : …;` or as `if (!isHermetic()) { return …; }`,
 * with `connection` imported from next/server and `isHermetic` from @/lib/env. What the
 * route answers outside the hermetic mode, a 404, each route's own test proves.
 */
import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-hermetic-routes.ts#${name}`,
);

/** A function that a handler calls first: its name, and the module that exports it. */
type Guard = Readonly<{ name: string; source: string }>;

const CONNECTION: Guard = { name: 'connection', source: 'next/server' };
const HERMETIC_MODE: Guard = { name: 'isHermetic', source: '@/lib/env' };

/** The name and the module of the import that `identifier` refers to, when it is one. */
function importOf(identifier: TSESTree.Identifier, scope: TSESLint.Scope.Scope): Guard | undefined {
  const definition = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (definition === undefined) {
    return undefined;
  }
  const { node: specifier, parent } = definition;
  if (
    specifier.type !== AST_NODE_TYPES.ImportSpecifier ||
    parent?.type !== AST_NODE_TYPES.ImportDeclaration
  ) {
    return undefined;
  }
  const { imported } = specifier;
  const name = imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value;
  return { name, source: parent.source.value };
}

/** Says whether `node` calls `guard`, imported from its module, without arguments. */
function isGuardCall(node: TSESTree.Node, guard: Guard, scope: TSESLint.Scope.Scope): boolean {
  if (
    node.type !== AST_NODE_TYPES.CallExpression ||
    node.callee.type !== AST_NODE_TYPES.Identifier ||
    node.arguments.length > 0
  ) {
    return false;
  }
  const origin = importOf(node.callee, scope);
  return origin?.name === guard.name && origin.source === guard.source;
}

/** Says whether `node` is `await connection();`. */
const isWait = (node: TSESTree.Statement | undefined, scope: TSESLint.Scope.Scope): boolean =>
  node?.type === AST_NODE_TYPES.ExpressionStatement &&
  node.expression.type === AST_NODE_TYPES.AwaitExpression &&
  isGuardCall(node.expression.argument, CONNECTION, scope);

/** Says whether `node` is a block that only returns, or a lone return. */
const isReturnOnly = (node: TSESTree.Statement): boolean =>
  node.type === AST_NODE_TYPES.BlockStatement
    ? node.body.length === 1 && node.body[0]?.type === AST_NODE_TYPES.ReturnStatement
    : node.type === AST_NODE_TYPES.ReturnStatement;

/** Says whether `node` is `return isHermetic() ? … : …;`. */
const isTernaryTest = (node: TSESTree.Statement, scope: TSESLint.Scope.Scope): boolean =>
  node.type === AST_NODE_TYPES.ReturnStatement &&
  node.argument?.type === AST_NODE_TYPES.ConditionalExpression &&
  isGuardCall(node.argument.test, HERMETIC_MODE, scope);

/** Says whether `node` is `if (!isHermetic()) { return …; }`. */
const isIfTest = (node: TSESTree.Statement, scope: TSESLint.Scope.Scope): boolean =>
  node.type === AST_NODE_TYPES.IfStatement &&
  node.alternate === null &&
  node.test.type === AST_NODE_TYPES.UnaryExpression &&
  node.test.operator === '!' &&
  isGuardCall(node.test.argument, HERMETIC_MODE, scope) &&
  isReturnOnly(node.consequent);

/** Says whether `handler` starts with `await connection();`, then tests `isHermetic()`. */
function isGuarded(handler: TSESTree.FunctionDeclaration, scope: TSESLint.Scope.Scope): boolean {
  const [wait, test] = handler.body.body;
  return (
    isWait(wait, scope) &&
    test !== undefined &&
    (isTernaryTest(test, scope) || isIfTest(test, scope))
  );
}

/** Says whether `node`, an export list such as `export { GET }`, exports a value. */
const hasValueSpecifier = (node: TSESTree.ExportNamedDeclaration): boolean =>
  node.exportKind === 'value' && node.specifiers.some(({ exportKind }) => exportKind === 'value');

/** Says whether `node`, an exported declaration, declares a type, and no value. */
const isTypeOnly = (node: TSESTree.NamedExportDeclarations): boolean =>
  node.type === AST_NODE_TYPES.TSTypeAliasDeclaration ||
  node.type === AST_NODE_TYPES.TSInterfaceDeclaration;

/** Requires every route under /api/test/ to start as /api/test/ping does. */
export const hermeticTestRoutes = createRule({
  name: 'hermetic-test-routes',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every handler of a route under /api/test/ to wait for the request, then answer only in the hermetic mode.',
    },
    messages: {
      start:
        'A handler under /api/test/ starts as /api/test/ping does: `await connection();` (from next/server), then `return isHermetic() ? … : …;` or `if (!isHermetic()) { return …; }` (from @/lib/env), so that it answers 404 on any server but a hermetic one (CLAUDE.md, "End-to-end tests").',
      export:
        'A route under /api/test/ exports only its handlers, each an async function declaration that starts as /api/test/ping does (CLAUDE.md, "End-to-end tests").',
    },
    schema: [],
  },
  create(context) {
    return {
      ExportNamedDeclaration(node): void {
        const { declaration } = node;
        if (declaration === null) {
          if (hasValueSpecifier(node)) {
            context.report({ node, messageId: 'export' });
          }
          return;
        }
        if (isTypeOnly(declaration)) {
          return;
        }
        if (declaration.type !== AST_NODE_TYPES.FunctionDeclaration || !declaration.async) {
          context.report({ node: declaration, messageId: 'export' });
          return;
        }
        if (!isGuarded(declaration, context.sourceCode.getScope(declaration))) {
          context.report({ node: declaration.id, messageId: 'start' });
        }
      },
      'ExportDefaultDeclaration, ExportAllDeclaration'(
        node: TSESTree.ExportDefaultDeclaration | TSESTree.ExportAllDeclaration,
      ): void {
        if (node.exportKind === 'value') {
          context.report({ node, messageId: 'export' });
        }
      },
    };
  },
});
