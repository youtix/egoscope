import { hermeticEnvironment } from './fixtures/hermetic-server';
import { startUntilExit } from './fixtures/server-start';
import { expect, test } from './fixtures/test';

// A connection string that the schema accepts, on a host that no output may name.
const DATABASE_URL = 'postgresql://app@unnamed-host.example.invalid/egoscope?sslmode=verify-full';

/** The line that the server logs as it refuses to start, naming the refusing variables. */
const refusal = (variables: readonly string[]): string =>
  JSON.stringify({
    level: 'error',
    message: 'The fakes switch is refused, so the server does not start.',
    context: { variables },
  });

test.describe('the guard of the hermetic mode', () => {
  test('[TRV-64] refuses to start a server whose fakes switch is set beside DATABASE_URL, and never prints the URL', async () => {
    const exit = await startUntilExit({ ...hermeticEnvironment(1), DATABASE_URL });

    expect(exit.code).toBe(1);
    expect(exit.output).toContain(refusal(['DATABASE_URL', 'EGOSCOPE_FAKES']));
    expect(exit.output).not.toContain('unnamed-host');
  });

  test('refuses to start a server whose fakes switch is set on a production deployment', async () => {
    const exit = await startUntilExit({ ...hermeticEnvironment(1), VERCEL_ENV: 'production' });

    expect(exit.code).toBe(1);
    expect(exit.output).toContain(refusal(['VERCEL_ENV', 'EGOSCOPE_FAKES']));
  });
});
