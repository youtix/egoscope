import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

import { createHttpLinkCheck, GENERIC_USER_AGENT } from './http';

import type { CallContext } from './types';
import type { IncomingHttpHeaders, OutgoingHttpHeaders, Server } from 'node:http';

const FOUND = 302;
const OK = 200;
const DEADLINE_MS = 5000;
const TIMEOUT_MS = 5000;

const open = (deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal: new AbortController().signal,
});

// The answers of the local server, by path: a status and its headers.
const ANSWERS: ReadonlyMap<
  string,
  Readonly<{ status: number; headers: OutgoingHttpHeaders }>
> = new Map([
  [
    '/sets-a-cookie',
    { status: FOUND, headers: { location: '/echo', 'set-cookie': 'session=made-up; Path=/' } },
  ],
  ['/echo', { status: OK, headers: {} }],
  ['/to-a-file', { status: FOUND, headers: { location: 'ftp://archive.test/report' } }],
  ['/nowhere', { status: FOUND, headers: {} }],
]);

/**
 * A local server that records the headers of each request in `received` and answers
 * as `ANSWERS` says; a path it does not list stays silent, a page that never answers.
 */
function localServer(received: Map<string, IncomingHttpHeaders>): Server {
  return createServer((request, response) => {
    const path = request.url ?? '';
    received.set(path, request.headers);
    const answer = ANSWERS.get(path);
    if (answer !== undefined) {
      response.writeHead(answer.status, answer.headers).end();
    }
  });
}

describe('createHttpLinkCheck', () => {
  // What the local server received, by path.
  const received = new Map<string, IncomingHttpHeaders>();
  const server = localServer(received);
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('[TRV-66] [CL-IMP-25] sends a generic user agent and no cookie, not even one that a redirect sets', async () => {
    const outcome = await createHttpLinkCheck().probe(open(), {
      url: `${base}/sets-a-cookie`,
      timeoutMs: TIMEOUT_MS,
    });

    expect(outcome).toStrictEqual({
      ok: true,
      value: { verdict: 'reachable', status: OK },
      call: { httpRequests: 2 },
    });
    expect(received.get('/sets-a-cookie')).toMatchObject({ 'user-agent': GENERIC_USER_AGENT });
    expect(received.get('/echo')).toMatchObject({
      'user-agent': 'Mozilla/5.0 (compatible; LinkCheck/1.0)',
    });
    expect(received.get('/echo')).not.toHaveProperty('cookie');
  });

  it.each(['/to-a-file', '/nowhere'])(
    '[CL-IMP-25] reports unreachable, with its status, a redirect that leads to no web address (%s)',
    async (path) => {
      const outcome = await createHttpLinkCheck().probe(open(), {
        url: `${base}${path}`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual({
        ok: true,
        value: { verdict: 'unreachable', status: FOUND },
        call: { httpRequests: 1 },
      });
    },
  );

  it('[IMP-17] reports an address that is not a web address unreachable, without a request', async () => {
    const outcome = await createHttpLinkCheck().probe(open(), {
      url: 'ftp://archive.test/report',
      timeoutMs: TIMEOUT_MS,
    });

    expect(outcome).toStrictEqual({
      ok: true,
      value: { verdict: 'unreachable', status: null },
      call: { httpRequests: 0 },
    });
  });

  it('[CL-IMP-25] answers aborted when the call deadline, nearer than the timeout, cuts a page short', async () => {
    const outcome = await createHttpLinkCheck().probe(open(50), {
      url: `${base}/silent`,
      timeoutMs: TIMEOUT_MS,
    });

    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'aborted' },
      call: { httpRequests: 1 },
    });
  });

  it('[CL-IMP-25] answers aborted, without a request, when the call deadline has passed', async () => {
    const outcome = await createHttpLinkCheck().probe(open(-1), {
      url: `${base}/echo`,
      timeoutMs: TIMEOUT_MS,
    });

    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'aborted' },
      call: { httpRequests: 0 },
    });
  });
});
