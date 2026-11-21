import { describe, expect, it } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

import { createFakeLinkCheck } from './fake';

const TIMEOUT_MS = 1000;

const open = () => ({
  deadline: toEpochMs(now() + TIMEOUT_MS),
  signal: new AbortController().signal,
});

describe('createFakeLinkCheck', () => {
  it('[IMP-17] finds an address never scripted, so that the hermetic mode finds every link', async () => {
    const fake = createFakeLinkCheck();

    await expect(
      fake.probe(open(), { url: 'https://news.test/any', timeoutMs: TIMEOUT_MS }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { verdict: 'reachable', status: 200 },
      call: { httpRequests: 1 },
    });
  });

  it('[CL-IMP-25] scripts an address however it is written, and forgets it on reset', async () => {
    const fake = createFakeLinkCheck();
    fake.answer('https://NEWS.test', { status: 404 });
    const verdict = async () =>
      fake.probe(open(), { url: 'https://news.test/', timeoutMs: TIMEOUT_MS });

    await expect(verdict()).resolves.toMatchObject({
      value: { verdict: 'not_found', status: 404 },
    });
    fake.reset();
    await expect(verdict()).resolves.toMatchObject({
      value: { verdict: 'reachable', status: 200 },
    });
  });

  it('[CL-IMP-25] follows a scripted redirect to another site', async () => {
    const fake = createFakeLinkCheck();
    fake.answer('https://short.test/a1', { redirectTo: 'https://news.test/moved' });
    fake.answer('https://news.test/moved', { status: 410 });

    await expect(
      fake.probe(open(), { url: 'https://short.test/a1', timeoutMs: TIMEOUT_MS }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { verdict: 'not_found', status: 410 },
      call: { httpRequests: 2 },
    });
  });
});
