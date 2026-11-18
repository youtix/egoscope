import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exports what a developer's shell may: LOG_LEVEL=error, one of the levels that
 * .env.example documents, under which the logger drops the warning that a test
 * here expects. CI exports no LOG_LEVEL, so every test here starts as if the
 * shell did, and a test that read it would fail.
 */
function exportShellVariables(): void {
  vi.stubEnv('LOG_LEVEL', 'error');
}

describe('createPool', () => {
  beforeEach(() => {
    // The logger of ./postgres reads the environment once, when its module
    // loads, so each test loads the module afresh.
    vi.resetModules();
    exportShellVariables();
    // Whatever the shell exports, each test starts from every variable of the
    // server environment pinned: at the default log level, info, outside Vercel
    // with no database configured, and with NODE_ENV as Vitest sets it.
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
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
