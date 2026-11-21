import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

describe('isGalleryOpen', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
  });

  it.each([
    ['under next dev', { NODE_ENV: 'development' }, true],
    ['in the hermetic mode', { NODE_ENV: 'production', EGOSCOPE_FAKES: 'all' }, true],
    ['in production', { NODE_ENV: 'production' }, false],
    ['on a production deployment', { NODE_ENV: 'production', VERCEL_ENV: 'production' }, false],
    ['under the unit tests', {}, false],
    ['with an invalid environment', { NODE_ENV: 'development', LOG_LEVEL: 'INFO' }, false],
  ])('says whether the gallery is open %s', async (_case, variables, isOpen) => {
    stubVariables(variables);
    const { isGalleryOpen } = await import('./gallery-access');

    expect(isGalleryOpen()).toBe(isOpen);
  });
});

describe('isGalleryShown', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(connection).mockReset();
  });

  it('says no at once in production, with no request to wait for, as a build prerenders it', async () => {
    stubVariables({ NODE_ENV: 'production' });
    vi.mocked(connection).mockReturnValue(Promise.withResolvers<undefined>().promise);
    const { isGalleryShown } = await import('./gallery-access');

    await expect(isGalleryShown()).resolves.toBe(false);
    expect(vi.mocked(connection)).not.toHaveBeenCalled();
  });

  it('says yes in the hermetic mode once the request has come, and not before', async () => {
    stubVariables({ NODE_ENV: 'production', EGOSCOPE_FAKES: 'all' });
    const request = Promise.withResolvers<undefined>();
    vi.mocked(connection).mockReturnValue(request.promise);
    const { isGalleryShown } = await import('./gallery-access');

    const answer = isGalleryShown();
    await expect(Promise.race([answer, Promise.resolve('still waiting')])).resolves.toBe(
      'still waiting',
    );
    request.resolve(undefined);

    await expect(answer).resolves.toBe(true);
  });
});
