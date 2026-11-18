/**
 * The checks on nodes and on their types that the time rules of eslint-time-rules.ts
 * use: names and imports, server-only modules, `Intl` constructors, dates,
 * primitives and the zone of a date format.
 */
import { AST_NODE_TYPES, ASTUtils } from '@typescript-eslint/utils';
import ts from 'typescript';

import type {
  ParserServicesWithTypeInformation,
  TSESLint,
  TSESTree,
} from '@typescript-eslint/utils';

/** The parser services of a rule that needs type information. */
export type Services = ParserServicesWithTypeInformation;

const INTL_CONSTRUCTOR = /^[A-Z]/u;

/** Says whether `node` is the identifier `name`. */
export const isNamed = (node: TSESTree.Node, name: string): boolean =>
  node.type === AST_NODE_TYPES.Identifier && node.name === name;

/** The name that `specifier` imports: `x` of `import { x as y }`. */
export const importedName = (specifier: TSESTree.ImportSpecifier): string =>
  specifier.imported.type === AST_NODE_TYPES.Identifier
    ? specifier.imported.name
    : specifier.imported.value;

/** Says whether `node`, in `scope`, names a namespace import of `source`: `time` of `import * as time`. */
export function isNamespaceOf(
  node: TSESTree.Node,
  scope: TSESLint.Scope.Scope,
  source: string,
): boolean {
  const definition =
    node.type === AST_NODE_TYPES.Identifier
      ? ASTUtils.findVariable(scope, node)?.defs[0]
      : undefined;
  return (
    definition?.node.type === AST_NODE_TYPES.ImportNamespaceSpecifier &&
    definition.node.parent.source.value === source
  );
}

/** Says whether `program` is a server-only module: it imports `server-only`. */
export const isServerOnly = (program: TSESTree.Program): boolean =>
  program.body.some(
    (statement) =>
      statement.type === AST_NODE_TYPES.ImportDeclaration &&
      statement.source.value === 'server-only',
  );

/** The `Intl` constructor that `callee` names, such as `DateTimeFormat`, if it names one. */
export function intlConstructor(callee: TSESTree.Expression): string | undefined {
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    isNamed(callee.object, 'Intl') &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    INTL_CONSTRUCTOR.test(callee.property.name)
    ? callee.property.name
    : undefined;
}

/** Says whether the value of `node` may be a Date, alone or among other types. */
export function canBeDate(services: Services, node: TSESTree.Node): boolean {
  const checker = services.program.getTypeChecker();
  const type = checker.getNonNullableType(services.getTypeAtLocation(node));
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => part.getSymbol()?.getName() === 'Date');
}

/** Says whether the value of `node` is assignable to the primitive `kind`. */
export function isOfKind(
  services: Services,
  node: TSESTree.Node,
  kind: 'number' | 'string',
): boolean {
  const checker = services.program.getTypeChecker();
  const expected = kind === 'number' ? checker.getNumberType() : checker.getStringType();
  return checker.isTypeAssignableTo(services.getTypeAtLocation(node), expected);
}

/**
 * Says whether `options`, given to a date format, always name its time zone: a
 * `timeZone` that is neither optional nor possibly undefined.
 */
export function hasTimeZone(
  services: Services,
  options: TSESTree.CallExpressionArgument | undefined,
): boolean {
  if (options === undefined) {
    return false;
  }
  const checker = services.program.getTypeChecker();
  const zone = services.getTypeAtLocation(options).getProperty('timeZone');
  return (
    zone !== undefined &&
    (zone.flags & ts.SymbolFlags.Optional) === 0 &&
    !checker.isTypeAssignableTo(checker.getUndefinedType(), checker.getTypeOfSymbol(zone))
  );
}
