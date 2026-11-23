import { createServer } from 'node:http';
import { getDefaultAutoSelectFamily, isIP, setDefaultAutoSelectFamily } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';

import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

import { createHttpLinkCheck, GENERIC_USER_AGENT } from './http';

import type { AddressKind } from './address-rules';
import type { CallContext } from './types';
import type { IncomingHttpHeaders, OutgoingHttpHeaders, Server } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import type { MockInstance } from 'vitest';

const FOUND = 302;
const OK = 200;
const DEADLINE_MS = 5000;
const TIMEOUT_MS = 5000;
// The loopback of the local servers, which only the tests that allow it reach.
const LOOPBACK = '127.0.0.1';
// A private and a public address that a test's lookup answers: neither is ever contacted.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private address of the tests, refused and never contacted
const PRIVATE = '10.0.0.1';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a public address of the tests, never contacted
const PUBLIC = '11.0.0.1';

const open = (deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal: new AbortController().signal,
});

const portOf = (server: Readonly<{ address: () => AddressInfo | string | null }>): string => {
  const address = server.address();
  return String(typeof address === 'object' && address !== null ? address.port : 0);
};

/** The warning that a refusal writes: the host and the kind of address, nothing else of the link. */
const refusal = (host: string, kind: AddressKind): string =>
  JSON.stringify({
    level: 'warn',
    message: 'The link check refused an address that is not public.',
    context: { host, kind },
  });

/** What a probe answers that ends with no answer after `httpRequests` requests, a refused address's included. */
const unreachable = (httpRequests: number) => ({
  ok: true,
  value: { verdict: 'unreachable', status: null },
  call: { httpRequests },
});

/**
 * A lookup that answers every name with the next list of `turns`, the last one again
 * once they run out, and the names it was asked, one per call.
 */
function lookupAnswering(...turns: readonly (readonly string[])[]) {
  const asked: string[] = [];
  const lookup: LookupFunction = (hostname, _options, callback) => {
    const addresses = turns[Math.min(asked.length, turns.length - 1)] ?? [];
    asked.push(hostname);
    callback(
      null,
      addresses.map((address) => ({ address, family: isIP(address) })),
    );
  };
  return { lookup, asked };
}

/** The adapter of a test that reaches its local server, resolving names as `options` says. */
const local = (options: Readonly<{ lookup?: LookupFunction }> = {}) =>
  createHttpLinkCheck({ allowedAddresses: [LOOPBACK], ...options });

/** A lookup that answers every name with one private address, instead of the list asked. */
const toOnePrivateAddress: LookupFunction = (_hostname, _options, callback) => {
  callback(null, PRIVATE, 4);
};

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
  ['/to-a-private-address', { status: FOUND, headers: { location: `http://${PRIVATE}/admin` } }],
  ['/to-an-intranet', { status: FOUND, headers: { location: 'http://intranet.test/admin' } }],
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

/**
 * The port of a local TLS server that records the server name of each handshake in
 * `names`; it holds no certificate, so that every handshake fails once named.
 */
async function tlsServer(names: string[]): Promise<string> {
  const server = createTlsServer({
    SNICallback: (servername, done) => {
      names.push(servername);
      done(new Error('This test server holds no certificate.'));
    },
  });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  onTestFinished(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  return portOf(server);
}

describe('createHttpLinkCheck', () => {
  // What the local server received, by path.
  const received = new Map<string, IncomingHttpHeaders>();
  const server = localServer(received);
  let port: string;
  let base: string;
  let warn: MockInstance<typeof console.warn>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
    port = portOf(server);
    base = `http://${LOOPBACK}:${port}`;
  });

  beforeEach(() => {
    received.clear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('[TRV-66] [CL-IMP-25] sends a generic user agent and no cookie, not even one that a redirect sets', async () => {
    const outcome = await local().probe(open(), {
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
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['/to-a-file', '/nowhere'])(
    '[CL-IMP-25] reports unreachable, with its status, a redirect that leads to no web address (%s)',
    async (path) => {
      const outcome = await local().probe(open(), {
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
    const outcome = await local().probe(open(), {
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
    const outcome = await local().probe(open(50), {
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
    const outcome = await local().probe(open(-1), {
      url: `${base}/echo`,
      timeoutMs: TIMEOUT_MS,
    });

    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'aborted' },
      call: { httpRequests: 0 },
    });
  });

  describe('the addresses it connects to', () => {
    it.each([
      ['http://127.0.0.1/', LOOPBACK, 'loopback'],
      ['http://[::1]/', '[::1]', 'loopback'],
      ['http://2130706433/', LOOPBACK, 'loopback'],
      ['http://0x7f.0.0.1/', LOOPBACK, 'loopback'],
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- a link that is refused before any request, whatever its protocol
      ['http://[::ffff:10.0.0.1]/', '[::ffff:a00:1]', 'private-use'],
      // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the metadata address of a cloud host, refused and never contacted
      ['http://169.254.169.254/latest/meta-data/', '169.254.169.254', 'link-local'],
    ] as const)(
      '[TRV-66] refuses %s, an address that is not public, with no request sent',
      async (url, host, kind) => {
        const outcome = await createHttpLinkCheck().probe(open(), { url, timeoutMs: TIMEOUT_MS });

        expect(outcome).toStrictEqual(unreachable(0));
        expect(warn).toHaveBeenCalledExactlyOnceWith(refusal(host, kind));
      },
    );

    it('[TRV-66] refuses the loopback of a page that a test does not allow, which receives nothing', async () => {
      const outcome = await createHttpLinkCheck().probe(open(), {
        url: `${base}/echo`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual(unreachable(0));
      expect(received.size).toBe(0);
    });

    it('[TRV-66] logs the host of a refused address, never its credentials, path, query or fragment', async () => {
      await createHttpLinkCheck().probe(open(), {
        url: `https://reader:made-up@${PRIVATE}:8443/private/path?token=made-up#part`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(warn).toHaveBeenCalledExactlyOnceWith(refusal(PRIVATE, 'private-use'));
    });

    it.each([
      ['a private address', [PRIVATE]],
      ['one public and one private address', [PUBLIC, PRIVATE]],
    ])(
      '[TRV-66] refuses a name that resolves to %s, with no request sent',
      async (_addresses, answer) => {
        const { lookup, asked } = lookupAnswering(answer);

        const outcome = await createHttpLinkCheck({ lookup }).probe(open(), {
          url: 'http://intranet.test/',
          timeoutMs: TIMEOUT_MS,
        });

        expect(outcome).toStrictEqual(unreachable(0));
        expect(asked).toStrictEqual(['intranet.test']);
        expect(warn).toHaveBeenCalledExactlyOnceWith(refusal('intranet.test', 'private-use'));
      },
    );

    it('[TRV-66] ends the probe unreachable after one request at a redirect to a private address', async () => {
      const outcome = await local().probe(open(), {
        url: `${base}/to-a-private-address`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual(unreachable(1));
      expect(warn).toHaveBeenCalledExactlyOnceWith(refusal(PRIVATE, 'private-use'));
    });

    it('[TRV-66] ends the probe unreachable after one request at a redirect to a name that resolves to a private address', async () => {
      const { lookup, asked } = lookupAnswering([PRIVATE]);

      const outcome = await local({ lookup }).probe(open(), {
        url: `${base}/to-an-intranet`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual(unreachable(1));
      expect(asked).toStrictEqual(['intranet.test']);
      expect(warn).toHaveBeenCalledExactlyOnceWith(refusal('intranet.test', 'private-use'));
    });

    it('[TRV-66] resolves a name once for the request, connects to the address it checked, and sends the Host of the link', async () => {
      const { lookup, asked } = lookupAnswering([LOOPBACK], [PRIVATE]);

      const outcome = await local({ lookup }).probe(open(), {
        url: `http://news.test:${port}/echo`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual({
        ok: true,
        value: { verdict: 'reachable', status: OK },
        call: { httpRequests: 1 },
      });
      expect(asked).toStrictEqual(['news.test']);
      expect(received.get('/echo')).toMatchObject({ host: `news.test:${port}` });
      expect(warn).not.toHaveBeenCalled();
    });

    it('[TRV-66] resolves the name again for a redirect, and refuses it when it now answers a private address', async () => {
      const { lookup, asked } = lookupAnswering([LOOPBACK], [PRIVATE]);

      const outcome = await local({ lookup }).probe(open(), {
        url: `http://news.test:${port}/sets-a-cookie`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual(unreachable(1));
      expect(asked).toStrictEqual(['news.test', 'news.test']);
      expect(received.has('/sets-a-cookie')).toBe(true);
      expect(received.has('/echo')).toBe(false);
      expect(warn).toHaveBeenCalledExactlyOnceWith(refusal('news.test', 'private-use'));
    });

    it('[TRV-66] names the link host, not the address it connects to, as the TLS server name', async () => {
      const names: string[] = [];
      const tlsPort = await tlsServer(names);
      const { lookup } = lookupAnswering([LOOPBACK]);

      const outcome = await local({ lookup }).probe(open(), {
        url: `https://news.test:${tlsPort}/article`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(names).toStrictEqual(['news.test']);
      expect(outcome).toStrictEqual(unreachable(1));
      expect(warn).not.toHaveBeenCalled();
    });

    it('[TRV-66] connects to the address it checked when the connection asks for one address only', async () => {
      const wasAutoSelecting = getDefaultAutoSelectFamily();
      setDefaultAutoSelectFamily(false);
      onTestFinished(() => {
        setDefaultAutoSelectFamily(wasAutoSelecting);
      });
      const { lookup } = lookupAnswering([LOOPBACK]);

      const outcome = await local({ lookup }).probe(open(), {
        url: `http://news.test:${port}/echo`,
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toMatchObject({ value: { verdict: 'reachable', status: OK } });
      expect(received.get('/echo')).toMatchObject({ host: `news.test:${port}` });
    });

    it('[TRV-66] checks the address of a lookup that answers one address instead of a list', async () => {
      const outcome = await createHttpLinkCheck({ lookup: toOnePrivateAddress }).probe(open(), {
        url: 'http://intranet.test/',
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual(unreachable(0));
      expect(warn).toHaveBeenCalledExactlyOnceWith(refusal('intranet.test', 'private-use'));
    });

    it('[TRV-66] refuses a name whose lookup answers no address, since none could be checked', async () => {
      const { lookup } = lookupAnswering([]);

      const outcome = await createHttpLinkCheck({ lookup }).probe(open(), {
        url: 'http://intranet.test/',
        timeoutMs: TIMEOUT_MS,
      });

      expect(outcome).toStrictEqual(unreachable(0));
      expect(warn).toHaveBeenCalledExactlyOnceWith(refusal('intranet.test', 'unreadable'));
    });
  });
});
