import { describe, expect, it, vi } from 'vitest';

import { parseServerEnv } from './server-env';

describe('parseServerEnv', () => {
  it('defaults LOG_LEVEL to info when it is unset', () => {
    expect(parseServerEnv({})).toStrictEqual({ ok: true, env: { LOG_LEVEL: 'info' } });
  });

  it('treats an empty value as unset', () => {
    expect(parseServerEnv({ LOG_LEVEL: '' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info' },
    });
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('accepts LOG_LEVEL=%s', (level) => {
    expect(parseServerEnv({ LOG_LEVEL: level })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: level },
    });
  });

  it('ignores variables outside the schema', () => {
    expect(parseServerEnv({ HOME: '/home/someone' })).toStrictEqual({
      ok: true,
      env: { LOG_LEVEL: 'info' },
    });
  });

  it('[TRV-64] names an invalid variable without echoing its value', () => {
    const result = parseServerEnv({ LOG_LEVEL: 'sk-live-not-a-level' });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-server-env', variables: ['LOG_LEVEL'] },
    });
    expect(JSON.stringify(result)).not.toContain('sk-live-not-a-level');
  });
});

describe('readServerEnv', () => {
  it('validates process.env once, when the module loads', async () => {
    vi.resetModules();
    vi.stubEnv('LOG_LEVEL', 'debug');
    const { readServerEnv } = await import('./server-env');

    const first = readServerEnv();
    vi.stubEnv('LOG_LEVEL', 'error');

    expect(first).toStrictEqual({ ok: true, env: { LOG_LEVEL: 'debug' } });
    expect(readServerEnv()).toBe(first);
  });
});
