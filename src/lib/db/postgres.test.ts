import { describe, expect, it, vi } from 'vitest';

import { createPool } from './postgres';

describe('createPool', () => {
  it('opens no connection until a query needs one', () => {
    const pool = createPool({ connectionString: 'postgresql://app@127.0.0.1:1/egoscope' });

    expect(pool.totalCount).toBe(0);
  });

  it('logs a connection that fails while idle, instead of letting the error crash the server', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
