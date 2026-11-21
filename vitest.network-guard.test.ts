// Proves that the network guard, which vitest.config.ts loads before every test,
// refuses any connection that would leave the machine, and lets local ones through.
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

/** Resolves every host name to the loopback, as a test that answers its own lookups does. */
const toLoopback: LookupFunction = (_hostname, _options, callback) => {
  callback(null, [{ address: '127.0.0.1', family: 4 }]);
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

/** Connects with `connect`, and says whether the connection was made. */
async function canConnect(connect: (socket: Socket) => void): Promise<boolean> {
  const socket = new Socket();
  onTestFinished(() => {
    socket.destroy();
  });
  return new Promise((resolve) => {
    socket.once('connect', () => {
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
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

    await expect(canConnect(connectTo(port))).resolves.toBe(true);
  });

  it('lets a connection that brings its own lookup through to the address the test gives', async () => {
    const port = await localServer();

    await expect(
      canConnect((socket) => socket.connect({ host: 'news.test', port, lookup: toLoopback })),
    ).resolves.toBe(true);
  });
});
