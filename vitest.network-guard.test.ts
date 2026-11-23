// Proves that the network guard, which vitest.config.ts loads before every test,
// refuses any connection that would leave the machine, and lets local ones through,
// whatever the lookup that a connection brings answers, and that the system resolver
// refuses every name that it would ask the network about.
import { promises as dnsPromises, lookup as systemLookup } from 'node:dns';
import { lookup as promisedLookup } from 'node:dns/promises';
import { createServer, Socket } from 'node:net';

import { describe, expect, it, onTestFinished } from 'vitest';

import type { LookupFunction } from 'node:net';

const REFUSED = 'Tests never reach the network';
// An address of the documentation range (RFC 5737), which no test may reach.
const OUTSIDE = '192.0.2.10';
const HTTP_PORT = 80;
// The loopback that a test's own server listens on, written as an IPv4-mapped IPv6 address.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the machine's own loopback, which the guard must let through
const LOOPBACK_AS_IPV6 = '::ffff:127.0.0.1';
// A public address, which a test's lookup never gets to answer.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the public address that the guard must refuse
const PUBLIC = '11.0.0.1';

/** Resolves every host name to the loopback, as a test that answers its own lookups does. */
const toLoopback: LookupFunction = (_hostname, _options, callback) => {
  callback(null, [{ address: '127.0.0.1', family: 4 }]);
};

/** Resolves every host name to a public address, as a list, the form a connection asks by default. */
const toPublicList: LookupFunction = (_hostname, _options, callback) => {
  callback(null, [{ address: PUBLIC, family: 4 }]);
};

/** Resolves every host name to a public address, as one address, the form a connection asks without `autoSelectFamily`. */
const toPublicAddress: LookupFunction = (_hostname, _options, callback) => {
  callback(null, PUBLIC, 4);
};

/** Hands every host name on to the system resolver, as the link check's adapter does when no test gives a lookup. */
const toSystemResolver: LookupFunction = (hostname, options, callback) => {
  systemLookup(hostname, options, callback);
};

/** Fails every lookup with no address, as the system resolver does for a name that does not exist. */
const toNoAddress: LookupFunction = (hostname, _options, callback) => {
  Reflect.apply(callback, undefined, [new Error(`getaddrinfo ENOTFOUND ${hostname}`)]);
};

/** A local server that accepts connections, and its port. */
async function localServer(): Promise<number> {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

/** Connects with `connect`, and says how it went: `connected`, or the message of its error. */
async function connectionOutcome(connect: (socket: Socket) => void): Promise<string> {
  const socket = new Socket();
  onTestFinished(() => {
    socket.destroy();
  });
  return new Promise((resolve) => {
    socket.once('connect', () => {
      resolve('connected');
    });
    socket.once('error', (error) => {
      resolve(error.message);
    });
    connect(socket);
  });
}

describe('the network guard of the tests', () => {
  it.each([
    ['a port and an address', (socket: Socket) => socket.connect(HTTP_PORT, OUTSIDE)],
    [
      'options with an address',
      (socket: Socket) => socket.connect({ host: OUTSIDE, port: HTTP_PORT }),
    ],
    [
      'options with a host name',
      (socket: Socket) => socket.connect({ host: 'example.test', port: HTTP_PORT }),
    ],
    [
      'options with an address and their own lookup, which Node does not call for an address',
      (socket: Socket) => socket.connect({ host: OUTSIDE, port: HTTP_PORT, lookup: toLoopback }),
    ],
    [
      'a port as text and a host name',
      // @ts-expect-error: Node also takes a port written as text, which its types leave out
      (socket: Socket) => socket.connect(String(HTTP_PORT), 'example.test'),
    ],
  ])('refuses at once a connection to the network given by %s', (_form, connect) => {
    expect(() => connect(new Socket())).toThrow(REFUSED);
  });

  it('refuses the requests of fetch to the network', async () => {
    await expect(fetch(`http://${OUTSIDE}/`)).rejects.toHaveProperty(
      ['cause', 'message'],
      `${REFUSED}: the connection to ${OUTSIDE} was refused (vitest.network-guard.ts).`,
    );
  });

  it.each([
    ['its address', (port: number) => (socket: Socket) => socket.connect(port, '127.0.0.1')],
    [
      'localhost',
      (port: number) => (socket: Socket) => socket.connect({ host: 'localhost', port }),
    ],
    [
      'an IPv4 address written as IPv6',
      (port: number) => (socket: Socket) => socket.connect(port, LOOPBACK_AS_IPV6),
    ],
    ['its port alone', (port: number) => (socket: Socket) => socket.connect(port)],
  ])('lets a test reach its own server on the loopback by %s', async (_form, connectTo) => {
    const port = await localServer();

    await expect(connectionOutcome(connectTo(port))).resolves.toBe('connected');
  });

  it.each([
    ['a list', {}, toPublicList],
    ['one address', { autoSelectFamily: false }, toPublicAddress],
  ])(
    'refuses a connection whose own lookup answers an address outside the loopback, as %s',
    async (_form, options, lookup) => {
      await expect(
        connectionOutcome((socket) =>
          socket.connect({ host: 'news.test', port: HTTP_PORT, lookup, ...options }),
        ),
      ).resolves.toBe(
        `${REFUSED}: the address ${PUBLIC} that the lookup of news.test answered was refused (vitest.network-guard.ts).`,
      );
    },
  );

  it('refuses at once a connection whose own lookup asks the system resolver, as the link check does', async () => {
    await expect(
      connectionOutcome((socket) =>
        socket.connect({ host: 'news.test', port: HTTP_PORT, lookup: toSystemResolver }),
      ),
    ).rejects.toThrow(`${REFUSED}: the lookup of news.test was refused (vitest.network-guard.ts).`);
  });

  it('passes on the error of a connection whose own lookup fails with no address, as the system resolver does', async () => {
    await expect(
      connectionOutcome((socket) =>
        socket.connect({ host: 'news.test', port: HTTP_PORT, lookup: toNoAddress }),
      ),
    ).resolves.toBe('getaddrinfo ENOTFOUND news.test');
  });

  it('refuses at once to resolve a host name through dns.lookup', () => {
    expect(() => {
      systemLookup('news.test', () => undefined);
    }).toThrow(`${REFUSED}: the lookup of news.test was refused (vitest.network-guard.ts).`);
  });

  it.each([
    ['dns.promises.lookup', async () => dnsPromises.lookup('news.test')],
    ['the lookup of node:dns/promises', async () => promisedLookup('news.test')],
  ])('refuses at once to resolve a host name through %s', async (_form, resolve) => {
    await expect(resolve()).rejects.toThrow(
      `${REFUSED}: the lookup of news.test was refused (vitest.network-guard.ts).`,
    );
  });

  it.each([
    ['localhost', { address: '127.0.0.1', family: 4 }],
    [OUTSIDE, { address: OUTSIDE, family: 4 }],
  ])(
    'lets the system resolver answer %s, which needs no query to the network',
    async (name, answer) => {
      await expect(promisedLookup(name, { all: true })).resolves.toContainEqual(answer);
    },
  );

  it('lets a connection that brings its own lookup through to the address the test gives', async () => {
    const port = await localServer();

    await expect(
      connectionOutcome((socket) =>
        socket.connect({ host: 'news.test', port, lookup: toLoopback }),
      ),
    ).resolves.toBe('connected');
  });
});
