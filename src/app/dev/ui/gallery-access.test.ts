import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

describe('isGalleryOpen', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one,
    // from every variable of the server environment pinned.
    vi.resetModules();
    stubVariables({
      EGOSCOPE_FAKES: '',
      DATABASE_URL: '',
      DATABASE_URL_UNPOOLED: '',
      VERCEL_ENV: '',
      LOG_LEVEL: '',
      NODE_ENV: 'test',
    });
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
