import 'server-only';

import { z } from 'zod';

import { Secret } from './secrets';

// libpq's sslmode that encrypts the connection and checks the server's
// certificate and host name; pg obeys the last sslmode of a URL, so all of them
// must say it (TRV-14).
const VERIFY_FULL = 'verify-full';

const hasVerifyFull = (value: string): boolean => {
  // Zod runs this check even when the value is no URL at all.
  const modes = URL.parse(value)?.searchParams.getAll('sslmode') ?? [];
  return modes.length > 0 && modes.every((mode) => mode === VERIFY_FULL);
};

// A Postgres connection string, reached over a verified encrypted connection
// (TRV-14), and kept secret (TRV-64).
const databaseUrl = z
  .url({ protocol: /^postgres(?:ql)?$/u })
  .refine(hasVerifyFull)
  .transform((value) => new Secret(value));

// The real credentials: the values that let this server reach the database or an
// outside service. The schema declares each one with this mark, anywhere in its
// declaration, by which alone a new credential joins the fakes rule below: there
// is no list to update.
export const realCredentials = z.registry();

/**
 * The schema that `schema` wraps, if any: the one under `.optional()`,
 * `.default()` and every other wrapper of zod, or the input of a pipe, which
 * `.transform()` and `.pipe()` make.
 */
function wrappedSchema({ _zod: { def } }: z.core.$ZodType): unknown {
  if ('innerType' in def) {
    return def.innerType;
  }
  return 'in' in def ? def.in : undefined;
}

/**
 * Says whether `schema` carries the mark of a real credential, on itself or on a
 * schema that it wraps (TRV-64): zod keeps a mark on the one schema it was
 * registered on, which `.optional()`, `.default()` or `.transform()` called after
 * `.register()` would otherwise hide from the fakes rule.
 */
export function isCredential(schema: z.core.$ZodType): boolean {
  if (realCredentials.has(schema)) {
    return true;
  }
  const wrapped = wrappedSchema(schema);
  return wrapped instanceof z.core.$ZodType && isCredential(wrapped);
}

// The outside services that a fake can replace, one port each (module map §5).
const PORTS = [
  'stats-source',
  'link-check',
  'backup-storage',
  'runtime-cache',
  'language-model',
  'press-feeds',
  'telegram',
] as const;

const ports = z.array(z.enum(PORTS));

// The fakes switch: `all`, the hermetic mode of the end-to-end tests, in which
// every outside service is a fake, or a comma-separated list of ports.
const fakesSwitch = z.union([
  z.literal('all'),
  z
    .string()
    .transform((list) => list.split(',').map((port) => port.trim()))
    .pipe(ports),
]);

// Every variable the server reads, and its rules. Secrets join this schema,
// and only this schema, as the features that need them land (TRV-37, TRV-64).
const serverEnvShape = {
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Set by Next.js and Vitest, never by hand: `next dev` keeps its database on disk.
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  // Set by Vercel on each of its deployments, and absent everywhere else.
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  // Neon's pooled connection string, for the application, and its direct one,
  // for migrations and long reads. Both are optional: previews carry neither.
  DATABASE_URL: databaseUrl.optional().register(realCredentials),
  DATABASE_URL_UNPOOLED: databaseUrl.optional().register(realCredentials),
  // Outside services replaced with fakes, for development and the end-to-end tests only.
  EGOSCOPE_FAKES: fakesSwitch.optional(),
};

const serverEnvSchema = z.object(serverEnvShape);

const VARIABLES = Object.keys(serverEnvShape);
const CREDENTIALS = Object.entries(serverEnvShape)
  .filter(([, schema]) => isCredential(schema))
  .map(([name]) => name);
const FAKES = 'EGOSCOPE_FAKES';

export type ServerEnv = Readonly<z.infer<typeof serverEnvSchema>>;

export type ServerEnvError = Readonly<{
  kind: 'invalid-server-env';
  /** Names of the invalid variables, in schema order. Their values are never reported. */
  variables: readonly string[];
}>;

export type ServerEnvResult =
  Readonly<{ ok: true; env: ServerEnv }> | Readonly<{ ok: false; error: ServerEnvError }>;

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The variables that refuse the fakes switch, then the switch itself: every real
 * credential set beside it, and `VERCEL_ENV` on a production deployment. Fakes
 * never serve where a credential could reach a real service, and a credential
 * refuses them on its own, since the host's system variables exist only while a
 * project setting is on. Read from the values as given, so that the rule holds
 * whatever else is invalid, a malformed connection string included.
 */
function refusedBesideFakes(defined: EnvSource): readonly string[] {
  if (defined[FAKES] === undefined) {
    return [];
  }
  const refusing = [
    ...(defined['VERCEL_ENV'] === 'production' ? ['VERCEL_ENV'] : []),
    ...CREDENTIALS.filter((name) => defined[name] !== undefined),
  ];
  return refusing.length === 0 ? [] : [...refusing, FAKES];
}

/**
 * Validates a server environment (TRV-64). An empty value counts as unset. The
 * fakes switch is refused beside a real credential or on a production
 * deployment. The error names the invalid variables but never echoes a value,
 * so it is safe to log.
 */
export function parseServerEnv(source: EnvSource): ServerEnvResult {
  const defined: EnvSource = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = serverEnvSchema.safeParse(defined);
  // One variable can fail several checks.
  const invalid = new Set([
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.map(String).join('.'))),
    ...refusedBesideFakes(defined),
  ]);
  if (parsed.success && invalid.size === 0) {
    return { ok: true, env: parsed.data };
  }
  const variables = VARIABLES.filter((name) => invalid.has(name));
  return { ok: false, error: { kind: 'invalid-server-env', variables } };
}

const processEnvResult = parseServerEnv(process.env);

/**
 * Returns the validation of `process.env`, done once when the server loads
 * this module (TRV-64).
 */
export function readServerEnv(): ServerEnvResult {
  return processEnvResult;
}
