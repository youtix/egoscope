import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('createPool', () => {
  beforeEach(() => {
    // The logger of ./postgres reads the environment once, when its module
    // loads, so each test loads the module afresh.
    vi.resetModules();
  });

  it('opens no connection until a query needs one', async () => {
    const { createPool } = await import('./postgres');

    const pool = createPool({ connectionString: 'postgresql://app@127.0.0.1:1/egoscope' });

    expect(pool.totalCount).toBe(0);
  });

  it('logs a connection that fails while idle, instead of letting the error crash the server', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { createPool } = await import('./postgres');
    const pool = createPool({});
    const failure = new Error('Connection terminated unexpectedly');

    pool.emit('error', failure);

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        level: 'warn',
        message: 'An idle database connection failed; the next query opens another one.',
        context: {
          error: {
            name: 'Error',
            message: 'Connection terminated unexpectedly',
            stack: failure.stack,
          },
        },
      }),
    );
  });
});
