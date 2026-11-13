import { createServer } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { Socket } from 'node:net';

type FakeServer = Readonly<{ url: string; firstPackets: readonly Buffer[] }>;

// What pg sends before anything else when TLS is required: a length of 8 bytes
// and the code 80877103, which asks the server to start TLS.
const TLS_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);
const PING_TIMEOUT_MS = 5000;
const UNREACHABLE = { ok: false, error: { kind: 'database-unreachable' } };

/**
 * A local server in the place of Postgres: it keeps the first packet of each
 * connection, then lets `answer` reply.
 */
async function fakeServer(answer: (socket: Socket) => void): Promise<FakeServer> {
  const firstPackets: Buffer[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.once('data', (packet) => {
      firstPackets.push(packet);
      answer(socket);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `postgresql://app@127.0.0.1:${String(port)}/egoscope?sslmode=verify-full`,
    firstPackets,
  };
}

describe('ping', { timeout: 60_000 }, () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers ok once the database has run its query', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { ping } = await import('./ping');

    await expect(ping()).resolves.toStrictEqual({ ok: true });
  });

  it('reports the database not configured on Vercel without a URL', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { ping } = await import('./ping');

    await expect(ping()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
  });

  it('[TRV-14] asks for TLS first, and finds a database that offers none unreachable', async () => {
    const server = await fakeServer((socket) => socket.end('N'));
    vi.stubEnv('DATABASE_URL', server.url);
    const { ping } = await import('./ping');

    await expect(ping()).resolves.toStrictEqual(UNREACHABLE);
    expect(server.firstPackets).toStrictEqual([TLS_REQUEST]);
  });

  it('reports the database unreachable when it drops the connection', async () => {
    const server = await fakeServer((socket) => socket.destroy());
    vi.stubEnv('DATABASE_URL', server.url);
    const { ping } = await import('./ping');

    await expect(ping()).resolves.toStrictEqual(UNREACHABLE);
  });

  it('reports the database unreachable when it does not answer within five seconds', async () => {
    const server = await fakeServer(() => undefined);
    vi.stubEnv('DATABASE_URL', server.url);
    const { ping } = await import('./ping');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const result = ping();
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS - 1);
    const beforeTimeout = await Promise.race([result, Promise.resolve('still waiting')]);
    await vi.advanceTimersByTimeAsync(1);

    expect(beforeTimeout).toBe('still waiting');
    await expect(result).resolves.toStrictEqual(UNREACHABLE);
  });
});
