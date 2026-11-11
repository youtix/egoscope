import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('logger', () => {
  beforeEach(() => {
    // The logger reads its level once, when its module loads.
    vi.resetModules();
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
