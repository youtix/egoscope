import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TLSSocket } from 'node:tls';

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { Socket } from 'node:net';

type FakeServer = Readonly<{ url: string; firstPackets: readonly Buffer[] }>;

/** A server's key and certificate, in PEM, and the file that holds the certificate. */
type Certificate = Readonly<{ key: string; cert: string; file: string }>;

// What pg sends before anything else when TLS is required: a length of 8 bytes
// and the code 80877103, which asks the server to start TLS.
const TLS_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);
// The protocol version 3.0, which follows the length of a startup message.
const STARTUP_PROTOCOL = 196_608;
const PING_TIMEOUT_MS = 5000;
const UNREACHABLE = { ok: false, error: { kind: 'database-unreachable' } };

// The ASN.1 DER tags of what a certificate holds.
const DER = {
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  objectIdentifier: 0x06,
  utf8String: 0x0c,
  utcTime: 0x17,
  sequence: 0x30,
  set: 0x31,
  // The explicit version [0] and extensions [3] of a certificate.
  version: 0xa0,
  extensions: 0xa3,
  // Two kinds of subject alternative name: a DNS name [2] and an IP address [7].
  dnsName: 0x82,
  ipAddress: 0x87,
} as const;
// One byte below 128; above, 0x80 plus the count of the bytes that follow.
const SHORT_LENGTH_LIMIT = 0x80;
// The values of a byte.
const BYTE = 256;

/** A DER value: its tag, the length of its contents in the shortest form, then the contents. */
function der(tag: number, ...contents: readonly Uint8Array[]): Buffer {
  const body = Buffer.concat(contents);
  const length: number[] = [];
  for (let rest = body.length; rest > 0; rest = Math.floor(rest / BYTE)) {
    length.unshift(rest % BYTE);
  }
  const prefix =
    body.length < SHORT_LENGTH_LIMIT ? [body.length] : [0x80 + length.length, ...length];
  return Buffer.concat([Buffer.from([tag, ...prefix]), body]);
}

// The signature algorithm ecdsa-with-SHA256 (1.2.840.10045.4.3.2), and the object
// identifiers of the common name (2.5.4.3) and of the subject alternative names
// extension (2.5.29.17).
const ECDSA_WITH_SHA256 = der(
  DER.sequence,
  der(DER.objectIdentifier, Buffer.from('2a8648ce3d040302', 'hex')),
);
const COMMON_NAME = der(DER.objectIdentifier, Buffer.from('550403', 'hex'));
const SUBJECT_ALT_NAMES = der(DER.objectIdentifier, Buffer.from('551d11', 'hex'));
// The issuer and the subject: the common name "egoscope test".
const NAME_ATTRIBUTE = der(
  DER.sequence,
  COMMON_NAME,
  der(DER.utf8String, Buffer.from('egoscope test')),
);
const NAME = der(DER.sequence, der(DER.set, NAME_ATTRIBUTE));
// Version 3, which has extensions, and a serial number.
const VERSION_3 = der(DER.version, der(DER.integer, Buffer.from([2])));
const SERIAL_NUMBER = der(DER.integer, Buffer.from([1]));
// From 2000 to 2049, the whole range of a UTCTime.
const VALIDITY = der(
  DER.sequence,
  der(DER.utcTime, Buffer.from('000101000000Z')),
  der(DER.utcTime, Buffer.from('491231235959Z')),
);
const LOOPBACK = der(DER.ipAddress, Buffer.from([127, 0, 0, 1]));
const OTHER_HOST = der(DER.dnsName, Buffer.from('db.example.invalid'));

// Where the shell's connection strings lead in these tests: a port where nothing listens.
const SHELL_DATABASE_URL = 'postgresql://app@127.0.0.1:1/egoscope?sslmode=verify-full';
// Where every copy of the db module keeps the databases that the process opened.
const OPENED_DATABASES = Symbol.for('egoscope.db.opened-databases');

/**
 * Exports what a developer's shell may, for example the production connection
 * strings to run pg_dump. CI exports no database variable, so every test here
 * starts as if the shell did, and a test that read them would fail instead of
 * waking the database they name (TRV-76).
 */
function exportShellVariables(): void {
  vi.stubEnv('DATABASE_URL', SHELL_DATABASE_URL);
  vi.stubEnv('DATABASE_URL_UNPOOLED', SHELL_DATABASE_URL);
  vi.stubEnv('VERCEL_ENV', 'production');
}

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

/**
 * A key, and a version 3 certificate that the key signs itself for the host
 * `altName`, which no authority vouches for. The certificate is also written to
 * a file, which `sslrootcert` can name to make the client trust it.
 */
function selfSignedCertificate(altName: Buffer): Certificate {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  // The one extension, the subject alternative names, in the sequence of extensions.
  const altNames = der(
    DER.sequence,
    SUBJECT_ALT_NAMES,
    der(DER.octetString, der(DER.sequence, altName)),
  );
  const extensions = der(DER.extensions, der(DER.sequence, altNames));
  const tbs = der(
    DER.sequence,
    VERSION_3,
    SERIAL_NUMBER,
    ECDSA_WITH_SHA256,
    NAME,
    VALIDITY,
    NAME,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = der(DER.bitString, Buffer.from([0]), sign('sha256', tbs, privateKey));
  const cert = new X509Certificate(der(DER.sequence, tbs, ECDSA_WITH_SHA256, signature)).toString();
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-tls-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  const file = path.join(folder, 'server.crt');
  writeFileSync(file, cert);
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), cert, file };
}

/**
 * Answers a request for TLS with yes, then speaks TLS with `certificate` and
 * keeps in `received` what the client sends over the encrypted connection.
 */
function encryptWith(certificate: Certificate, received: Buffer[]): (socket: Socket) => void {
  return (socket) => {
    socket.write('S');
    const secure = new TLSSocket(socket, {
      isServer: true,
      key: certificate.key,
      cert: certificate.cert,
    });
    secure.on('data', (packet: Buffer) => {
      received.push(packet);
      secure.end();
    });
    // The client hangs up when it refuses the certificate.
    secure.on('error', () => undefined);
  };
}

/** `url`, with the client told to trust `certificate` as the authority that vouches for the server. */
const trusting = (url: string, certificate: Certificate): string =>
  `${url}&sslrootcert=${encodeURIComponent(certificate.file)}`;

describe('ping', { timeout: 60_000 }, () => {
  beforeEach(() => {
    // Each test is a fresh server process: its modules load again, reading the
    // environment, and it has opened no database yet.
    vi.resetModules();
    vi.stubGlobal(OPENED_DATABASES, undefined);
    exportShellVariables();
    // Whatever the shell exports, each test starts outside Vercel with no
    // database configured, then stubs what it needs.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    vi.stubEnv('VERCEL_ENV', '');
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

  it('[TRV-14] refuses a certificate that no trusted authority signed, and sends nothing over it', async () => {
    const received: Buffer[] = [];
    const server = await fakeServer(encryptWith(selfSignedCertificate(LOOPBACK), received));
    vi.stubEnv('DATABASE_URL', server.url);
    const { ping } = await import('./ping');

    await expect(ping()).resolves.toStrictEqual(UNREACHABLE);
    expect(server.firstPackets).toStrictEqual([TLS_REQUEST]);
    expect(received).toStrictEqual([]);
  });

  it('[TRV-14] refuses a trusted certificate issued to another host, and sends nothing over it', async () => {
    const certificate = selfSignedCertificate(OTHER_HOST);
    const received: Buffer[] = [];
    const server = await fakeServer(encryptWith(certificate, received));
    vi.stubEnv('DATABASE_URL', trusting(server.url, certificate));
    const { ping } = await import('./ping');

    await expect(ping()).resolves.toStrictEqual(UNREACHABLE);
    expect(server.firstPackets).toStrictEqual([TLS_REQUEST]);
    expect(received).toStrictEqual([]);
  });

  it('[TRV-14] starts the session over the encrypted connection once the certificate checks out', async () => {
    const certificate = selfSignedCertificate(LOOPBACK);
    const received: Buffer[] = [];
    const server = await fakeServer(encryptWith(certificate, received));
    vi.stubEnv('DATABASE_URL', trusting(server.url, certificate));
    const { ping } = await import('./ping');

    // The server stops at the startup message, since it is no database.
    await expect(ping()).resolves.toStrictEqual(UNREACHABLE);
    expect(received.map((packet) => packet.readInt32BE(4))).toStrictEqual([STARTUP_PROTOCOL]);
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
