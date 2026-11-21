import { render, screen } from '@testing-library/react';
import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// What `notFound()` throws, which Next.js answers with a 404 before any byte is sent.
const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

describe('/dev/ui', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one,
    // from every variable of the server environment pinned: no fakes, outside Vercel
    // with no database, at the default log level, as Vitest runs it.
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

  // React's own runtime reads NODE_ENV as it loads, so these tests keep it to what
  // React may run under here; gallery-access.test.ts covers production.
  it.each([
    ['under the unit tests', {}],
    ['with some fakes only', { EGOSCOPE_FAKES: 'telegram' }],
    ['with an invalid environment under next dev', { NODE_ENV: 'development', LOG_LEVEL: 'INFO' }],
  ])(
    'answers not found outside development and the hermetic mode: %s',
    async (_case, variables) => {
      stubVariables(variables);
      const { default: ComponentGalleryPage } = await import('./page');

      await expect(ComponentGalleryPage()).rejects.toMatchObject(NOT_FOUND);
    },
  );

  it.each([
    ['under next dev', { NODE_ENV: 'development' }],
    ['in the hermetic mode of the end-to-end tests', { EGOSCOPE_FAKES: 'all' }],
  ])('shows the gallery %s', async (_case, variables) => {
    stubVariables(variables);
    const { default: ComponentGalleryPage } = await import('./page');

    render(await ComponentGalleryPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
  });

  it('decides at request time, never with the environment of the build', async () => {
    stubVariables({ NODE_ENV: 'development' });
    const { default: ComponentGalleryPage } = await import('./page');

    await ComponentGalleryPage();

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });
});
