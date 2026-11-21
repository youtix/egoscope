import { createServer } from 'node:http';

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

const OK = 200;
const TIMEOUT_MS = 5000;

/** The accessor of a server whose configuration holds `variables`, loaded afresh. */
async function serverWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./port');
}

/** The address of a local page that answers 200. */
async function localPage(): Promise<string> {
  const server = createServer((_request, response) => response.writeHead(OK).end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  return `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/article`;
}

const open = () => ({
  deadline: toEpochMs(now() + TIMEOUT_MS),
  signal: new AbortController().signal,
});

describe('linkCheck', () => {
  it('serves the fake that the whole process shares when EGOSCOPE_FAKES names the link check', async () => {
    const { linkCheck, fakeLinkCheck } = await serverWith({ EGOSCOPE_FAKES: 'link-check' });
    fakeLinkCheck().answer('https://news.test/gone', { status: 410 });

    expect(linkCheck()).toBe(fakeLinkCheck());
    await expect(
      linkCheck().probe(open(), { url: 'https://news.test/gone', timeoutMs: TIMEOUT_MS }),
    ).resolves.toMatchObject({
      value: { verdict: 'not_found', status: 410 },
    });
    fakeLinkCheck().reset();
  });

  it('[IMP-17] serves the HTTP adapter otherwise, which opens the page itself', async () => {
    const { linkCheck } = await serverWith({});
    const url = await localPage();

    await expect(linkCheck().probe(open(), { url, timeoutMs: TIMEOUT_MS })).resolves.toStrictEqual({
      ok: true,
      value: { verdict: 'reachable', status: OK },
      call: { httpRequests: 1 },
    });
  });
});
