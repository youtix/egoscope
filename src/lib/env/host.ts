import { readServerEnv } from './server-env';

import type { ServerEnvError } from './server-env';

// The system variables that the application reads from Vercel, which provides
// them only while the project setting "Enable access to System Environment
// Variables" stays on (accounts-and-keys sheet).
const HOST_VARIABLES = ['VERCEL_ENV', 'VERCEL_DEPLOYMENT_ID'] as const;

export type HostCheckError =
  | ServerEnvError
  | Readonly<{
      kind: 'missing-host-variables';
      /** The system variables that the host does not provide. */
      variables: readonly (typeof HOST_VARIABLES)[number][];
    }>;

export type HostCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; error: HostCheckError }>;

/**
 * Says whether the host provides its system variables, VERCEL_ENV and
 * VERCEL_DEPLOYMENT_ID, so that the installation check (TRV-47) fails with the
 * missing ones as its cause: the project setting "Enable access to System
 * Environment Variables" is off. While the configuration is invalid, no value
 * can be read from it, and the check fails with that cause instead (TRV-37).
 */
export function hostCheck(): HostCheck {
  const env = readServerEnv();
  if (!env.ok) {
    return { ok: false, error: env.error };
  }
  const variables = HOST_VARIABLES.filter((name) => env.env[name] === undefined);
  return variables.length === 0
    ? { ok: true }
    : { ok: false, error: { kind: 'missing-host-variables', variables } };
}

/**
 * The unique identifier of this deployment, VERCEL_DEPLOYMENT_ID, read from the
 * host and never set (TRV-37): undefined when the host provides none, and while
 * the configuration is invalid.
 */
export function deploymentId(): string | undefined {
  const env = readServerEnv();
  return env.ok ? env.env.VERCEL_DEPLOYMENT_ID : undefined;
}
