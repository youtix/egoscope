import { beforeEach, describe, expect, it, vi } from 'vitest';

// A connection string in the form that Neon's console offers, which a shell may
// export: the schema refuses it, since it asks for no check of the certificate.
const REFUSED_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=require&channel_binding=require';

/**
 * Exports what a developer's shell may and the schema refuses. The environment
 * is valid or invalid as one whole, and the logger logs at info while it is
 * invalid, whatever LOG_LEVEL says. CI exports none of these, so every test here
 * starts as if the shell did, and fails if it reads them.
 */
function exportRefusedVariables(): void {
  vi.stubEnv('DATABASE_URL', REFUSED_URL);
  vi.stubEnv('DATABASE_URL_UNPOOLED', REFUSED_URL);
  vi.stubEnv('VERCEL_ENV', 'staging');
  vi.stubEnv('NODE_ENV', 'debugging');
}

describe('logger', () => {
  beforeEach(() => {
    // The logger reads its level once, when its module loads.
    vi.resetModules();
    exportRefusedVariables();
    // Whatever the shell exports, LOG_LEVEL alone decides the environment here.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EGOSCOPE_FAKES', '');
  });

  it('logs at the level that LOG_LEVEL sets', async () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { logger } = await import('./server-logger');

    logger.info('Hidden');
    logger.warn('Shown');

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith('{"level":"warn","message":"Shown"}');
  });

  it('keeps logging at info while the environment is invalid', async () => {
    vi.stubEnv('LOG_LEVEL', 'verbose');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { logger } = await import('./server-logger');

    logger.debug('Hidden');
    logger.info('Shown');

    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith('{"level":"info","message":"Shown"}');
  });
});
