import { beforeEach, describe, expect, it, vi } from 'vitest';

// A connection string that the schema accepts, on a host that no log line may name.
const DATABASE_URL = 'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full';

/**
 * Exports what a developer's shell may: the fakes switch of .env.example, and a
 * connection string and a log level that the schema refuses. The environment is
 * valid or invalid as one whole, so every test here starts as if the shell did,
 * and fails if it reads them.
 */
function exportShellVariables(): void {
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
  vi.stubEnv('DATABASE_URL', 'postgresql://app@db.example.invalid/egoscope?sslmode=require');
  vi.stubEnv('LOG_LEVEL', 'INFO');
}

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

/** Replaces the end of the process with an error that names its exit code. */
const stopProcessExit = () =>
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${String(code)})`);
  });

describe('register', () => {
  beforeEach(() => {
    // Each test plays a fresh server instance: its modules load again, reading the environment.
    vi.resetModules();
    exportShellVariables();
    // Whatever the shell exports, each test starts from every variable of the
    // server environment pinned: no fakes, outside Vercel with no database, at
    // the default log level, with NODE_ENV as Vitest sets it.
    vi.stubEnv('EGOSCOPE_FAKES', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it.each([
    ['in the hermetic mode', { EGOSCOPE_FAKES: 'all' }],
    ['with a database and no fakes', { DATABASE_URL }],
    [
      'in an environment invalid for another reason, which the health route reports',
      { LOG_LEVEL: 'INFO' },
    ],
  ])('lets the server start %s', async (_case, variables) => {
    stubVariables(variables);
    const exit = stopProcessExit();
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation');

    register();

    expect(exit).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('[TRV-64] refuses to start a server whose fakes switch is set beside DATABASE_URL, logging the variables without their values', async () => {
    vi.stubEnv('EGOSCOPE_FAKES', 'all');
    vi.stubEnv('DATABASE_URL', DATABASE_URL);
    const exit = stopProcessExit();
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation');

    expect(() => {
      register();
    }).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '{"level":"error","message":"The fakes switch is refused, so the server does not start.","context":{"variables":["DATABASE_URL","EGOSCOPE_FAKES"]}}',
    );
  });

  it('refuses to start a server whose fakes switch is set on a production deployment', async () => {
    vi.stubEnv('EGOSCOPE_FAKES', 'all');
    vi.stubEnv('VERCEL_ENV', 'production');
    const exit = stopProcessExit();
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation');

    expect(() => {
      register();
    }).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '{"level":"error","message":"The fakes switch is refused, so the server does not start.","context":{"variables":["VERCEL_ENV","EGOSCOPE_FAKES"]}}',
    );
  });
});
