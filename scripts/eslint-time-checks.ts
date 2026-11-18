/**
 * The checks on nodes and on their types that the time rules of eslint-time-rules.ts
 * use: names and imports, server modules, Temporal's `from` and `Intl`
 * constructors, dates, instants, strings, numbers and the zone of a date format.
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
// A route handler of the App Router, by its path from the project's root: its code
// runs on the server only.
const ROUTE_HANDLER = /^src\/app\/(?:.+\/)?route\.tsx?$/u;
// The instant of Temporal, by the full name of its type: `Temporal.Instant`, in the
// module of temporal-polyfill's types or in a global declaration.
const TEMPORAL_INSTANT = /(?:^|\.)Temporal\.Instant$/u;

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

/** Says whether `statement` is `import 'server-only'` or the `'use server'` directive. */
const isServerMarker = (statement: TSESTree.ProgramStatement): boolean =>
  (statement.type === AST_NODE_TYPES.ImportDeclaration &&
    statement.source.value === 'server-only') ||
  (statement.type === AST_NODE_TYPES.ExpressionStatement && statement.directive === 'use server');

/**
 * Says whether `program`, at `file` from the project's root, is server code: it
 * imports `server-only`, starts with the `'use server'` directive, or is a route
 * handler, `route.ts` under src/app. The parser marks a directive only at the top
 * of a module, so a `'use server'` string further down does not count.
 */
export const isServerModule = (program: TSESTree.Program, file: string): boolean =>
  ROUTE_HANDLER.test(file) || program.body.some((statement) => isServerMarker(statement));

/** The Temporal type whose `from` `callee` names: `Instant` in `Temporal.Instant.from`. */
export function temporalFrom(callee: TSESTree.Expression): string | undefined {
  if (callee.type !== AST_NODE_TYPES.MemberExpression || !isNamed(callee.property, 'from')) {
    return undefined;
  }
  const type = callee.object;
  return type.type === AST_NODE_TYPES.MemberExpression &&
    isNamed(type.object, 'Temporal') &&
    type.property.type === AST_NODE_TYPES.Identifier
    ? type.property.name
    : undefined;
}

/** The `Intl` constructor that `callee` names, such as `DateTimeFormat`, if it names one. */
export function intlConstructor(callee: TSESTree.Expression): string | undefined {
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    isNamed(callee.object, 'Intl') &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    INTL_CONSTRUCTOR.test(callee.property.name)
    ? callee.property.name
    : undefined;
}

/** The types that the value of `node` may have, null and undefined aside: each one of its union. */
function possibleTypes(services: Services, node: TSESTree.Node): readonly ts.Type[] {
  const checker = services.program.getTypeChecker();
  const type = checker.getNonNullableType(services.getTypeAtLocation(node));
  return type.isUnion() ? type.types : [type];
}

/** Says whether the value of `node` may be a Date, alone or among other types. */
export function canBeDate(services: Services, node: TSESTree.Node): boolean {
  return possibleTypes(services, node).some((part) => part.getSymbol()?.getName() === 'Date');
}

/** Says whether the value of `node` may be a `Temporal.Instant`, alone or among other types. */
export function canBeInstant(services: Services, node: TSESTree.Node): boolean {
  const checker = services.program.getTypeChecker();
  return possibleTypes(services, node).some((part) => {
    const symbol = part.getSymbol();
    return symbol !== undefined && TEMPORAL_INSTANT.test(checker.getFullyQualifiedName(symbol));
  });
}

/**
 * Says whether the value of `node` may be a string, alone or among other types:
 * `string`, a literal, a branded string, `string | Temporal.Instant`, or `any`.
 */
export function canBeString(services: Services, node: TSESTree.Node): boolean {
  const checker = services.program.getTypeChecker();
  return possibleTypes(services, node).some((part) =>
    checker.isTypeAssignableTo(part, checker.getStringType()),
  );
}

/** Says whether the value of `node` is a number, such as an instant in milliseconds. */
export function isNumber(services: Services, node: TSESTree.Node): boolean {
  const checker = services.program.getTypeChecker();
  return checker.isTypeAssignableTo(services.getTypeAtLocation(node), checker.getNumberType());
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
