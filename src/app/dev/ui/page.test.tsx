import { render, screen } from '@testing-library/react';
import { connection } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// What `notFound()` throws, which Next.js answers with the not-found page.
const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

/** Makes `connection()` wait forever, as it does while a build prerenders the page. */
function prerender(): void {
  vi.mocked(connection).mockReturnValue(Promise.withResolvers<undefined>().promise);
}

// The environments that close the gallery. React's own runtime reads NODE_ENV as
// it loads, so these keep it to what React may run under here;
// gallery-access.test.ts covers production.
const CLOSED = [
  ['under the unit tests', {}],
  ['with some fakes only', { EGOSCOPE_FAKES: 'telegram' }],
  ['with an invalid environment under next dev', { NODE_ENV: 'development', LOG_LEVEL: 'INFO' }],
] as const;

const OPEN = [
  ['under next dev', { NODE_ENV: 'development' }],
  ['in the hermetic mode of the end-to-end tests', { EGOSCOPE_FAKES: 'all' }],
] as const;

describe('/dev/ui', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    // A request has come, unless the test prerenders.
    vi.mocked(connection).mockReset();
  });

  it.each(CLOSED)(
    'answers not found outside development and the hermetic mode, before any request comes, so that a build there prerenders it: %s',
    async (_case, variables) => {
      stubVariables(variables);
      prerender();
      const { default: ComponentGalleryPage } = await import('./page');

      await expect(ComponentGalleryPage()).rejects.toMatchObject(NOT_FOUND);
    },
  );

  it.each(CLOSED)(
    'gives no title outside development and the hermetic mode: %s',
    async (_case, variables) => {
      stubVariables(variables);
      prerender();
      const { generateMetadata } = await import('./page');

      await expect(generateMetadata()).resolves.toStrictEqual({});
    },
  );

  it.each(OPEN)('shows the gallery, titled, %s', async (_case, variables) => {
    stubVariables(variables);
    const { default: ComponentGalleryPage, generateMetadata } = await import('./page');

    render(await ComponentGalleryPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
    await expect(generateMetadata()).resolves.toStrictEqual({ title: 'Component gallery' });
  });

  it('waits for the request before it shows the gallery, so that the server decides with its own environment', async () => {
    stubVariables({ NODE_ENV: 'development' });
    const { default: ComponentGalleryPage } = await import('./page');

    await ComponentGalleryPage();

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });
});
