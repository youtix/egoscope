import { describe, expect, it, vi } from 'vitest';

/** `absoluteUrl` on a server whose deployment sets APP_BASE_URL to `base`, or none. */
async function withBase(base: string) {
  vi.stubEnv('APP_BASE_URL', base);
  vi.resetModules();
  const { absoluteUrl } = await import('./absolute-url');
  return absoluteUrl;
}

describe('absoluteUrl', () => {
  it('[IHM-17] writes the full address of a screen, for a link that leaves the app', async () => {
    const absoluteUrl = await withBase('https://egoscope.example');

    expect(absoluteUrl('/alerts/40')).toStrictEqual({
      ok: true,
      value: 'https://egoscope.example/alerts/40',
    });
  });

  it('[IHM-17] keeps the path of the base address, without doubling its slash', async () => {
    const absoluteUrl = await withBase('https://example.test/egoscope/');

    expect(absoluteUrl('/journal?entry=8')).toStrictEqual({
      ok: true,
      value: 'https://example.test/egoscope/journal?entry=8',
    });
  });

  it('[IHM-17] says so when the deployment does not set APP_BASE_URL', async () => {
    const absoluteUrl = await withBase('');

    expect(absoluteUrl('/')).toStrictEqual({
      ok: false,
      error: { kind: 'app-base-url-missing' },
    });
  });

  it('[IHM-17] writes no address from a configuration that the server refuses, such as plain HTTP', async () => {
    const absoluteUrl = await withBase('http://egoscope.example');

    expect(absoluteUrl('/')).toStrictEqual({
      ok: false,
      error: { kind: 'app-base-url-missing' },
    });
  });
});
