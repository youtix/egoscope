/**
 * The checks on nodes and on their types that the time rules of eslint-time-rules.ts
 * use: names and imports, server modules, the modules that a file names, Temporal's
 * `from` and `Intl` constructors, the local-time methods of a date, dates, instants,
 * the performance timer, strings, numbers and the zone of a date format.
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

/**
 * A node that names a module: an import, import type or `export … from`, an
 * `import()`, an import type such as `import('x').Y`, or a call of `require`.
 */
export type ModuleReference =
  | TSESTree.CallExpression
  | TSESTree.ExportAllDeclaration
  | TSESTree.ExportNamedDeclaration
  | TSESTree.ImportDeclaration
  | TSESTree.ImportExpression
  | TSESTree.TSImportType;

const INTL_CONSTRUCTOR = /^[A-Z]/u;
// A route handler of the App Router, by its path from the project's root: its code
// runs on the server only.
const ROUTE_HANDLER = /^src\/app\/(?:.+\/)?route\.tsx?$/u;
// The instant of Temporal, by the full name of its type: `Temporal.Instant`, in the
// module of temporal-polyfill's types or in a global declaration.
const TEMPORAL_INSTANT = /(?:^|\.)Temporal\.Instant$/u;
// Temporal's package, under any of its entry points, such as `temporal-polyfill/global`.
const TEMPORAL_PACKAGE = /^temporal-polyfill(?:\/|$)/u;

/** The Date methods that read or write local time, or print it. */
export const LOCAL_TIME_METHODS: ReadonlySet<string> = new Set([
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

/**
 * Says whether `node` names temporal-polyfill, or one of its entry points, by a
 * constant string: `import { Temporal } from 'temporal-polyfill'`,
 * `import('temporal-polyfill')` or `require('temporal-polyfill/global')`.
 */
export function isTemporalImport(node: ModuleReference): boolean {
  const source = node.type === AST_NODE_TYPES.CallExpression ? node.arguments[0] : node.source;
  const name = source ? ASTUtils.getStringIfConstant(source) : null;
  return name !== null && TEMPORAL_PACKAGE.test(name);
}

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

/**
 * The types that the value of `node` may have, null and undefined aside: each one of
 * its union, or of the constraint of its generic type, `string | Date` for a `T`
 * that extends `string | Date`.
 */
function possibleTypes(services: Services, node: TSESTree.Node): readonly ts.Type[] {
  const checker = services.program.getTypeChecker();
  const declared = services.getTypeAtLocation(node);
  const type = checker.getNonNullableType(checker.getBaseConstraintOfType(declared) ?? declared);
  return type.isUnion() ? type.types : [type];
}

/** Says whether the value of `node` may be a Date, alone or among other types. */
export function canBeDate(services: Services, node: TSESTree.Node): boolean {
  return possibleTypes(services, node).some((part) => part.getSymbol()?.getName() === 'Date');
}

/**
 * Says whether the value of `node` may be a `Performance`, the timer of the global
 * `performance` and of `node:perf_hooks`, whatever the name it goes by.
 */
export function canBePerformance(services: Services, node: TSESTree.Node): boolean {
  return possibleTypes(services, node).some(
    (part) => part.getSymbol()?.getName() === 'Performance',
  );
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
 * `string`, a literal, a branded string, `string | Temporal.Instant`, a generic type
 * that extends one of them, or `any`.
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
