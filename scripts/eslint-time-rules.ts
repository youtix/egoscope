/**
 * The three rules of the `egoscope` plugin that keep results independent of the
 * machine's clock, time zone and locale, registered by eslint-plugin.ts and probed
 * in eslint-plugin.test.ts and eslint-time-rules.test.ts. All three need type
 * information.
 *
 * - `no-local-time`: in the pure core, a date is an absolute instant. Methods that
 *   read or write local time, string conversions that print it, and constructors
 *   that parse strings or take local calendar fields all depend on the machine's
 *   time zone. The UTC methods stay allowed.
 * - `no-ambient-time`: outside src/lib/time, nothing reads the clock or the
 *   machine's time zone, or parses a date, so that tests can fix the time and a
 *   result is the same on the server and on the owner's devices: no import of
 *   temporal-polyfill, in any of the ways to name a module, no Date made from
 *   anything but an instant, no local-time method of a Date, no
 *   `performance.timeOrigin`, no `Intl.DateTimeFormat` without a `timeZone`, no
 *   locale format of a `Temporal.Instant`, and no date, time of day or instant that
 *   Temporal's `from` reads from a value that may be a string, a global `Temporal`
 *   included, where a runtime has one. Client code reads the device's zone with
 *   `deviceTimeZone`, which no server module imports: one that imports
 *   `server-only`, starts with `'use server'` or is a route handler. Its
 *   `allowTimeOrigin` option lets the lock wrapper's files read
 *   `performance.timeOrigin`. UTC methods, `performance.now()`, `Intl.NumberFormat`,
 *   date formats that name their zone, Temporal values made from fields or from
 *   other Temporal values, and the locale formats of the Temporal values that carry
 *   their own zone or none stay allowed.
 * - `no-default-locale`: a result that depends on a locale names it, since the
 *   server and the owner's devices do not share one.
 */
import path from 'node:path';

import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

import {
  canBeDate,
  canBeInstant,
  canBePerformance,
  canBeString,
  hasTimeZone,
  importedName,
  intlConstructor,
  isNamed,
  isNamespaceOf,
  isNumber,
  isServerModule,
  isTemporalImport,
  LOCAL_TIME_METHODS,
  temporalFrom,
} from './eslint-time-checks';

import type { ModuleReference, Services } from './eslint-time-checks';
import type { TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-time-rules.ts#${name}`,
);

/** Forbids time-zone-dependent Date operations, wherever eslint.config.ts applies it. */
export const noLocalTime = createRule({
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
    const isDate = (node: TSESTree.Node): boolean => canBeDate(services, node);
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
        } else if (argument !== undefined && !isNumber(services, argument) && !isDate(argument)) {
          context.report({ node, messageId: 'parse' });
        }
      },
    };
  },
});

// What reads the ambient time, and what parses a date, through a member: `Date.now`
// and `Temporal.Now` read the clock, `Date.parse` reads a string by rules of its own.
const AMBIENT_MEMBERS = [
  { object: 'Date', property: 'now', messageId: 'clock', shown: 'Date.now()' },
  { object: 'Date', property: 'parse', messageId: 'parse', shown: 'Date.parse()' },
  { object: 'Temporal', property: 'Now', messageId: 'clock', shown: 'Temporal.Now' },
] as const;
// The Temporal types whose `from` parses a string by rules of its own: a date, a time of
// day, a date and time, or an instant with its offset or zone, which @/lib/time reads.
const TEMPORAL_PARSERS: ReadonlySet<string> = new Set([
  'Instant',
  'PlainDate',
  'PlainDateTime',
  'PlainTime',
  'ZonedDateTime',
]);
// The methods that print a value with a locale, which a Temporal.Instant does in the
// time zone of the machine.
const LOCALE_FORMAT = 'toLocale';
// The function of @/lib/time that reads the device's zone, which only client code calls,
// and the name under which other modules import it (module rule 4).
const DEVICE_ZONE = 'deviceTimeZone';
const TIME_MODULE = '@/lib/time';
// The Unix time at which the performance timer of a process starts counting.
const TIME_ORIGIN = 'timeOrigin';
// Every way of naming a module: import, import type, export … from, import(), import
// types, and a call of require().
const MODULE_REFERENCES =
  "ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType, CallExpression[callee.name='require']";

/** What reads the ambient time, as no-ambient-time reports it. */
type AmbientRead = Readonly<{
  messageId: 'clock' | 'parse' | 'fields' | 'zone' | 'format' | 'device' | 'temporal';
  shown: string;
}>;

const ZONELESS_FORMAT: AmbientRead = { messageId: 'format', shown: 'Intl.DateTimeFormat' };
const DEVICE_READ: AmbientRead = { messageId: 'device', shown: DEVICE_ZONE };
const TIME_ORIGIN_READ: AmbientRead = { messageId: 'clock', shown: 'performance.timeOrigin' };
const TEMPORAL_IMPORT: AmbientRead = { messageId: 'temporal', shown: 'temporal-polyfill' };

/** An `Intl.DateTimeFormat` that `node` makes without a `timeZone`, which follows the machine's. */
function zonelessFormat(
  services: Services,
  node: TSESTree.CallExpression | TSESTree.NewExpression,
): AmbientRead | undefined {
  const isFormat = intlConstructor(node.callee) === 'DateTimeFormat';
  return isFormat && !hasTimeZone(services, node.arguments[1]) ? ZONELESS_FORMAT : undefined;
}

/**
 * The value that `node` parses with Temporal from what may be a string:
 * `Temporal.PlainDate.from(string)`, `Temporal.Instant.from(string | Temporal.Instant)`.
 */
function temporalParse(services: Services, node: TSESTree.CallExpression): AmbientRead | undefined {
  const type = temporalFrom(node.callee);
  const [text] = node.arguments;
  if (type === undefined || text === undefined || !TEMPORAL_PARSERS.has(type)) {
    return undefined;
  }
  const shown = `Temporal.${type}.from(string)`;
  return canBeString(services, text) ? { messageId: 'parse', shown } : undefined;
}

/** What a call reads of the ambient time: `Date()`, `String(date)`, a date format or a parse. */
function ambientCall(services: Services, node: TSESTree.CallExpression): AmbientRead | undefined {
  const [argument] = node.arguments;
  if (isNamed(node.callee, 'Date')) {
    return { messageId: 'clock', shown: 'Date()' };
  }
  if (argument !== undefined && isNamed(node.callee, 'String') && canBeDate(services, argument)) {
    return { messageId: 'zone', shown: 'String(date)' };
  }
  return zonelessFormat(services, node) ?? temporalParse(services, node);
}

/** What `new` reads of the ambient time: the current Date, local fields, a string, or a format. */
function ambientNew(services: Services, node: TSESTree.NewExpression): AmbientRead | undefined {
  if (!isNamed(node.callee, 'Date')) {
    return zonelessFormat(services, node);
  }
  const [argument, ...others] = node.arguments;
  if (argument === undefined) {
    return { messageId: 'clock', shown: 'new Date()' };
  }
  if (others.length > 0) {
    return { messageId: 'fields', shown: 'new Date(year, month, …)' };
  }
  const isInstant =
    isNumber(services, argument) ||
    services.getTypeAtLocation(argument).getSymbol()?.getName() === 'Date';
  return isInstant ? undefined : { messageId: 'parse', shown: 'new Date(string)' };
}

/**
 * Says whether `method`, called on the value of `object`, reads or prints local
 * time in the machine's zone.
 */
function isLocalTimeMethod(
  services: Services,
  object: TSESTree.Expression,
  method: string,
): boolean {
  return (
    (LOCAL_TIME_METHODS.has(method) && canBeDate(services, object)) ||
    (method.startsWith(LOCALE_FORMAT) && canBeInstant(services, object))
  );
}

/**
 * What a member reads of the ambient time: the clock, the start of the performance
 * timer, a parse, the local time of a Date, or the locale format of a Temporal.Instant.
 */
function ambientMember(
  services: Services,
  node: TSESTree.MemberExpression,
  property: string | null,
): AmbientRead | undefined {
  const member = AMBIENT_MEMBERS.find(
    (candidate) => isNamed(node.object, candidate.object) && candidate.property === property,
  );
  if (member !== undefined) {
    return member;
  }
  if (property === TIME_ORIGIN && canBePerformance(services, node.object)) {
    return TIME_ORIGIN_READ;
  }
  if (property !== null && isLocalTimeMethod(services, node.object, property)) {
    return { messageId: 'zone', shown: property };
  }
  return undefined;
}

/**
 * Forbids reading the clock or the machine's time zone, parsing dates and importing
 * temporal-polyfill, wherever eslint.config.ts applies it.
 */
export const noAmbientTime = createRule<[{ allowTimeOrigin: boolean }], AmbientRead['messageId']>({
  name: 'no-ambient-time',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Forbid reading the clock and the machine's time zone, parsing dates and importing temporal-polyfill outside src/lib/time.",
      requiresTypeChecking: true,
    },
    messages: {
      temporal:
        '`{{shown}}` is imported only by `@/lib/time`, which reads, parses and converts dates and times for every other module: call its functions, or add the one you need there (CLAUDE.md, "Time").',
      clock:
        '`{{shown}}` reads the ambient time: take the instant from `now()` of `@/lib/time`, whose clock tests can fix (CLAUDE.md, "Time").',
      parse:
        '`{{shown}}` parses a date or a time by rules of its own: read it with `parseIsoDate`, `parseTimeOfDay` or `parseTimestamp` of `@/lib/time` (CLAUDE.md, "Time").',
      fields:
        '`new Date(year, month, …)` reads calendar fields in the time zone of the machine: convert them with `@/lib/time` (CLAUDE.md, "Time").',
      zone: '`{{shown}}` depends on the time zone of the machine, which the server and the owner\'s devices do not share: read the local date and time of an instant with `toZoned` of `@/lib/time`, or show it with `formatInstant`, in the zone the caller passes in (CLAUDE.md, "Time").',
      format:
        '`Intl.DateTimeFormat` without a `timeZone` follows the time zone of the machine: show instants with `formatInstant` of `@/lib/time`, and read the device\'s zone with `deviceTimeZone` (CLAUDE.md, "Time").',
      device:
        '`deviceTimeZone` reads the zone of the machine it runs on, which on the server is not the owner\'s: server code takes the owner\'s zone from the `display.timeZone` setting (CLAUDE.md, "Time").',
    },
    schema: [
      {
        type: 'object',
        properties: { allowTimeOrigin: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowTimeOrigin: false }],
  },
  create(context, [{ allowTimeOrigin }]) {
    const services = ESLintUtils.getParserServices(context);
    const file = path.relative(context.cwd, context.filename);
    const isServerCode = isServerModule(context.sourceCode.ast, file);
    const allowed = allowTimeOrigin ? TIME_ORIGIN_READ : undefined;
    const report = (node: TSESTree.Node, read: AmbientRead | undefined): void => {
      if (read !== undefined && read !== allowed) {
        context.report({ node, messageId: read.messageId, data: { shown: read.shown } });
      }
    };
    return {
      MemberExpression(node): void {
        const scope = context.sourceCode.getScope(node);
        const property = ASTUtils.getPropertyName(node, scope);
        const isDeviceRead =
          isServerCode &&
          property === DEVICE_ZONE &&
          isNamespaceOf(node.object, scope, TIME_MODULE);
        report(node, isDeviceRead ? DEVICE_READ : ambientMember(services, node, property));
      },
      CallExpression(node): void {
        report(node, ambientCall(services, node));
      },
      NewExpression(node): void {
        report(node, ambientNew(services, node));
      },
      ImportSpecifier(node): void {
        const isDeviceImport =
          node.parent.source?.value === TIME_MODULE && importedName(node) === DEVICE_ZONE;
        report(node, isServerCode && isDeviceImport ? DEVICE_READ : undefined);
      },
      [MODULE_REFERENCES](node: ModuleReference): void {
        report(node, isTemporalImport(node) ? TEMPORAL_IMPORT : undefined);
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
