/**
 * The three rules of the `egoscope` plugin that keep results independent of the
 * machine's clock, time zone and locale, registered by eslint-plugin.ts and probed
 * in eslint-plugin.test.ts. All three need type information.
 *
 * - `no-local-time`: in the pure core, a date is an absolute instant. Methods that
 *   read or write local time, string conversions that print it, and constructors
 *   that parse strings or take local calendar fields all depend on the machine's
 *   time zone. The UTC methods stay allowed.
 * - `no-ambient-time`: outside src/lib/time, nothing reads the clock or the
 *   machine's time zone, or parses a date, so that tests can fix the time and a
 *   result is the same on the server and on the owner's devices: no Date made from
 *   anything but an instant, no local-time method of a Date, no `Intl.DateTimeFormat`
 *   without a `timeZone`, no instant parsed by Temporal. Client code reads the
 *   device's zone with `deviceTimeZone`, which a server-only module never imports.
 *   UTC methods, `Intl.NumberFormat` and date formats that name their zone stay
 *   allowed.
 * - `no-default-locale`: a result that depends on a locale names it, since the
 *   server and the owner's devices do not share one.
 */
import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from '@typescript-eslint/utils';

import {
  canBeDate,
  hasTimeZone,
  importedName,
  intlConstructor,
  isNamed,
  isNamespaceOf,
  isOfKind,
  isServerOnly,
} from './eslint-time-checks';

import type { Services } from './eslint-time-checks';
import type { TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator<{ requiresTypeChecking?: boolean }>(
  (name) => `scripts/eslint-time-rules.ts#${name}`,
);

// The Date methods that read or write local time, or print it.
const LOCAL_TIME_METHODS: ReadonlySet<string> = new Set([
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
        } else if (
          argument !== undefined &&
          !isOfKind(services, argument, 'number') &&
          !isDate(argument)
        ) {
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
// The Temporal types whose `from` reads an instant from a string, with its offset or zone.
const INSTANT_PARSERS: ReadonlySet<string> = new Set(['Instant', 'ZonedDateTime']);
// The function of @/lib/time that reads the device's zone, which only client code calls,
// and the name under which other modules import it (module rule 4).
const DEVICE_ZONE = 'deviceTimeZone';
const TIME_MODULE = '@/lib/time';

/** What reads the ambient time, as no-ambient-time reports it. */
type AmbientRead = Readonly<{
  messageId: 'clock' | 'parse' | 'fields' | 'zone' | 'format' | 'device';
  shown: string;
}>;

const ZONELESS_FORMAT: AmbientRead = { messageId: 'format', shown: 'Intl.DateTimeFormat' };
const DEVICE_READ: AmbientRead = { messageId: 'device', shown: DEVICE_ZONE };

/** An `Intl.DateTimeFormat` that `node` makes without a `timeZone`, which follows the machine's. */
function zonelessFormat(
  services: Services,
  node: TSESTree.CallExpression | TSESTree.NewExpression,
): AmbientRead | undefined {
  const isFormat = intlConstructor(node.callee) === 'DateTimeFormat';
  return isFormat && !hasTimeZone(services, node.arguments[1]) ? ZONELESS_FORMAT : undefined;
}

/** The Temporal type whose `from` `callee` names: `Instant` in `Temporal.Instant.from`. */
function temporalFrom(callee: TSESTree.Expression): string | undefined {
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

/** The instant that `node` parses with Temporal from a string: `Temporal.Instant.from(string)`. */
function temporalParse(services: Services, node: TSESTree.CallExpression): AmbientRead | undefined {
  const type = temporalFrom(node.callee);
  const [text] = node.arguments;
  if (type === undefined || text === undefined || !INSTANT_PARSERS.has(type)) {
    return undefined;
  }
  const shown = `Temporal.${type}.from(string)`;
  return isOfKind(services, text, 'string') ? { messageId: 'parse', shown } : undefined;
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
    isOfKind(services, argument, 'number') ||
    services.getTypeAtLocation(argument).getSymbol()?.getName() === 'Date';
  return isInstant ? undefined : { messageId: 'parse', shown: 'new Date(string)' };
}

/** What a member reads of the ambient time: the clock, a parse, or the local time of a Date. */
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
  if (property !== null && LOCAL_TIME_METHODS.has(property) && canBeDate(services, node.object)) {
    return { messageId: 'zone', shown: property };
  }
  return undefined;
}

/**
 * Forbids reading the clock or the machine's time zone, and parsing dates,
 * wherever eslint.config.ts applies it.
 */
export const noAmbientTime = createRule({
  name: 'no-ambient-time',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Forbid reading the clock and the machine's time zone, and parsing dates, outside src/lib/time.",
      requiresTypeChecking: true,
    },
    messages: {
      clock:
        '`{{shown}}` reads the ambient time: take the instant from `now()` of `@/lib/time`, whose clock tests can fix (CLAUDE.md, "Time").',
      parse:
        '`{{shown}}` parses a date by rules of its own: read it with `parseTimestamp` or `parseIsoDate` of `@/lib/time` (CLAUDE.md, "Time").',
      fields:
        '`new Date(year, month, …)` reads calendar fields in the time zone of the machine: convert them with `@/lib/time` (CLAUDE.md, "Time").',
      zone: '`{{shown}}` depends on the time zone of the machine, which the server and the owner\'s devices do not share: read the local date and time of an instant with `toZoned` of `@/lib/time`, or show it with `formatInstant`, in the zone the caller passes in (CLAUDE.md, "Time").',
      format:
        '`Intl.DateTimeFormat` without a `timeZone` follows the time zone of the machine: show instants with `formatInstant` of `@/lib/time`, and read the device\'s zone with `deviceTimeZone` (CLAUDE.md, "Time").',
      device:
        '`deviceTimeZone` reads the zone of the machine it runs on, which on the server is not the owner\'s: server code takes the owner\'s zone from the `display.timeZone` setting (CLAUDE.md, "Time").',
    },
    schema: [],
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const isServerModule = isServerOnly(context.sourceCode.ast);
    const report = (node: TSESTree.Node, read: AmbientRead | undefined): void => {
      if (read !== undefined) {
        context.report({ node, messageId: read.messageId, data: { shown: read.shown } });
      }
    };
    return {
      MemberExpression(node): void {
        const scope = context.sourceCode.getScope(node);
        const property = ASTUtils.getPropertyName(node, scope);
        const isDeviceRead =
          isServerModule &&
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
        report(node, isServerModule && isDeviceImport ? DEVICE_READ : undefined);
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
