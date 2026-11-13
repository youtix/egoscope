import 'server-only';

import { z } from 'zod';

import { Secret } from './secret';

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

// Every variable the server reads, and its rules. Secrets join this schema,
// and only this schema, as the features that need them land (TRV-37, TRV-64).
const serverEnvSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Set by Next.js and Vitest, never by hand: `next dev` keeps its database on disk.
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  // Set by Vercel on each of its deployments, and absent everywhere else.
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  // Neon's pooled connection string, for the application, and its direct one,
  // for migrations and long reads. Both are optional: previews carry neither.
  DATABASE_URL: databaseUrl.optional(),
  DATABASE_URL_UNPOOLED: databaseUrl.optional(),
});

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
 * Validates a server environment (TRV-64). An empty value counts as unset. The
 * error names the invalid variables but never echoes a value, so it is safe to
 * log.
 */
export function parseServerEnv(source: EnvSource): ServerEnvResult {
  const definedEntries = Object.entries(source).filter(
    ([, value]) => value !== undefined && value !== '',
  );
  const parsed = serverEnvSchema.safeParse(Object.fromEntries(definedEntries));
  if (parsed.success) {
    return { ok: true, env: parsed.data };
  }
  // Zod reports issues in schema order; one variable can fail several checks.
  const names = new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.')));
  return { ok: false, error: { kind: 'invalid-server-env', variables: [...names] } };
}

const processEnvResult = parseServerEnv(process.env);

/**
 * Returns the validation of `process.env`, done once when the server loads
 * this module (TRV-64).
 */
export function readServerEnv(): ServerEnvResult {
  return processEnvResult;
}
