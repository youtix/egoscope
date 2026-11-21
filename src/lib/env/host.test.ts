import { describe, expect, it, vi } from 'vitest';

// Every value that a Lot 1 deployment requires (accounts-and-keys sheet), all made up.
const KEY = 'k'.repeat(43);
const LOT_1_DEPLOYMENT = {
  APP_BASE_URL: 'https://egoscope.example.invalid',
  DATABASE_URL: 'postgresql://app@pooled.example.invalid/egoscope?sslmode=verify-full',
  DATABASE_URL_UNPOOLED: 'postgresql://app@direct.example.invalid/egoscope?sslmode=verify-full',
  CRON_SECRET: KEY,
  INITIAL_PASSWORD: 'p'.repeat(12),
  FINGERPRINT_KEY: KEY,
};

/**
 * The host functions of a server whose configuration holds `variables`: its
 * modules load afresh and read that configuration.
 */
async function serverWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./host');
}

describe('hostCheck', () => {
  it('[TRV-37] passes on a Vercel deployment that provides both system variables', async () => {
    const { hostCheck } = await serverWith({
      ...LOT_1_DEPLOYMENT,
      VERCEL_ENV: 'production',
      VERCEL_DEPLOYMENT_ID: 'dpl_madeUp',
    });

    expect(hostCheck()).toStrictEqual({ ok: true });
  });

  it.each([
    ['both, as when the project setting is off', {}, ['VERCEL_ENV', 'VERCEL_DEPLOYMENT_ID']],
    [
      'the deployment id',
      { ...LOT_1_DEPLOYMENT, VERCEL_ENV: 'production' },
      ['VERCEL_DEPLOYMENT_ID'],
    ],
    ['the deployment kind', { VERCEL_DEPLOYMENT_ID: 'dpl_madeUp' }, ['VERCEL_ENV']],
  ])(
    '[TRV-37] fails with the missing system variables as its cause: %s',
    async (_case, variables, missing) => {
      const { hostCheck } = await serverWith(variables);

      expect(hostCheck()).toStrictEqual({
        ok: false,
        error: { kind: 'missing-host-variables', variables: missing },
      });
    },
  );

  it('fails with the invalid configuration as its cause, since no host value can be read from it', async () => {
    const { hostCheck } = await serverWith({
      VERCEL_ENV: 'production',
      VERCEL_DEPLOYMENT_ID: 'dpl_madeUp',
    });

    expect(hostCheck()).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: Object.keys(LOT_1_DEPLOYMENT) },
    });
  });
});

describe('deploymentId', () => {
  it.each([
    ['the id that the host provides', { VERCEL_DEPLOYMENT_ID: 'dpl_madeUp' }, 'dpl_madeUp'],
    ['undefined when the host provides none', {}, undefined],
    [
      'undefined while the configuration is invalid',
      { VERCEL_DEPLOYMENT_ID: 'dpl_madeUp', LOG_LEVEL: 'INFO' },
      undefined,
    ],
  ])('[TRV-37] is %s', async (_case, variables, id) => {
    const { deploymentId } = await serverWith(variables);

    expect(deploymentId()).toBe(id);
  });
});
