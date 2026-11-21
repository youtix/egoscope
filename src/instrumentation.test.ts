import { beforeEach, describe, expect, it, vi } from 'vitest';

// A connection string that the schema accepts, on a host that no log line may name.
const DATABASE_URL = 'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full';

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
