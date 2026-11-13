import 'server-only';

import { z } from 'zod';

// Every variable the server reads, and its rules. Secrets join this schema,
// and only this schema, as the features that need them land (TRV-37, TRV-64).
const serverEnvSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
