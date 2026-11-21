import { Secret, SECRET_MASK } from './secret-value';
import { readServerEnv, SECRET_VARIABLES } from './server-env';

// What stands for an object found inside itself, which no copy can hold whole.
const CIRCULAR = '[circular]';

// The characters that a regular expression reads as syntax.
const SYNTAX_CHARACTERS = /[$()*+.?[\\\]^{|}]/gu;

/**
 * A value as `redact` gives it back: its JSON form, an error with its name,
 * message, stack and cause, and every secret of the configuration masked.
 */
export type Redacted =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | readonly Redacted[]
  | { readonly [key: string]: Redacted };

/**
 * Says whether the variable `name` holds a secret of the deployment
 * configuration, which is never logged, displayed or exported (TRV-64): false
 * for every other name, whether or not the schema declares it.
 */
export function isSecret(name: string): boolean {
  return SECRET_VARIABLES.has(name);
}

/** `text` with its percent-encoded characters decoded, or as it is when they encode no text. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The password of the connection string `url`, as the string writes it and
 * decoded, which a database library may print on its own; none when it has none.
 */
function passwordsOf(url: Secret | undefined): readonly string[] {
  // The schema accepts only a URL as a connection string.
  const password = url === undefined ? '' : new URL(url.reveal()).password;
  return password === '' ? [] : [password, decoded(password)];
}

/**
 * One pattern that finds every secret value of the configuration, and the
 * password of each connection string, the longest first, so that a secret that
 * holds another goes whole; none while the configuration holds no secret, or is
 * invalid: nothing then reached a service or the database with one.
 */
function secretsPattern(): RegExp | undefined {
  const env = readServerEnv();
  const values = env.ok
    ? new Set([
        ...Object.values(env.env)
          .filter((value) => value instanceof Secret)
          .map((value) => value.reveal()),
        ...passwordsOf(env.env.DATABASE_URL),
        ...passwordsOf(env.env.DATABASE_URL_UNPOOLED),
      ])
    : new Set<string>();
  if (values.size === 0) {
    return undefined;
  }
  const alternatives = [...values]
    .toSorted((left, right) => right.length - left.length)
    .map((value) => value.replaceAll(SYNTAX_CHARACTERS, String.raw`\$&`));
  return new RegExp(alternatives.join('|'), 'gu');
}

const SECRETS = secretsPattern();

// One pass over `text`, so that no mask is read again as part of a secret.
const maskText = (text: string): string =>
  SECRETS === undefined ? text : text.replaceAll(SECRETS, () => SECRET_MASK);

/** A value that JSON keeps as it is, and that holds no text. */
const isPlainValue = (value: unknown): value is number | boolean | bigint | null | undefined =>
  value === null || ['number', 'boolean', 'bigint', 'undefined'].includes(typeof value);

/** An object that gives its own JSON form, as a date, an address or a `Secret` does. */
const hasJsonForm = (value: object): value is { toJSON: () => unknown } =>
  'toJSON' in value && typeof value.toJSON === 'function';

/** What `redact` keeps of an error: its name, message, stack and cause, then its own fields. */
const errorEntries = (error: Error): readonly (readonly [string, unknown])[] => [
  ['name', error.name],
  ['message', error.message],
  ['stack', error.stack],
  ...('cause' in error ? [['cause', error.cause] as const] : []),
  ...Object.entries(error),
];

/** `value` as JSON reads it: the form that its `toJSON` gives, when it has one. */
const jsonFormOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && hasJsonForm(value) ? value.toJSON() : value;

/** `value` redacted, inside the objects of `ancestors`, which it must not hold again. */
function redactValue(value: unknown, ancestors: ReadonlySet<object>): Redacted {
  const form = jsonFormOf(value);
  if (typeof form === 'string') {
    return maskText(form);
  }
  if (isPlainValue(form)) {
    return form;
  }
  // A symbol or a function, which JSON leaves out.
  if (typeof form !== 'object') {
    return undefined;
  }
  if (ancestors.has(form)) {
    return CIRCULAR;
  }
  const inside = new Set([...ancestors, form]);
  if (Array.isArray(form)) {
    return form.map((item: unknown) => redactValue(item, inside));
  }
  const entries = form instanceof Error ? errorEntries(form) : Object.entries(form);
  return Object.fromEntries(
    entries.map(([key, field]) => [maskText(key), redactValue(field, inside)]),
  );
}

/**
 * `value` without any secret value of the deployment configuration (TRV-64):
 * a text with each secret replaced by "[secret]", and so is the password of a
 * connection string, as written and decoded, found alone; any other value in its JSON
 * form, with every text at any depth masked the same way, keys included, an
 * error with its name, message, stack, cause and own fields, and an object
 * found inside itself replaced by "[circular]". Call it on every text, error or
 * answer of a service that may carry a secret, such as an address that holds
 * the Telegram bot token, before it is logged, journaled or shown. Masks
 * nothing while the configuration is invalid, since no secret then reached a
 * service.
 */
export function redact(value: string): string;
export function redact(value: unknown): Redacted;
export function redact(value: unknown): Redacted {
  return redactValue(value, new Set());
}
