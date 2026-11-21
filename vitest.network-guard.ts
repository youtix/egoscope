// Keeps every test off the network (module map §5: "tests never call out"). Every
// TCP or TLS connection of Node goes through `Socket.prototype.connect`, which this
// setup file wraps before any test runs: a connection to a host other than the
// loopback fails at once, before any name is resolved, with an error that names the
// host. A local server of the test, a local socket path and a connection that brings
// its own `lookup`, which the test then answers itself, stay allowed. Every Vitest
// project loads it first (vitest.config.ts).
import { isIP, Socket } from 'node:net';

const GUARDED = Symbol.for('egoscope.network-guard');
const IPV4 = 4;
const LOOPBACK_IPV4 = '127.';
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost', '::1']);
const DIGITS = /^\d+$/u;

/** Says whether `host` is this machine, never the network. */
function isLoopback(host: string): boolean {
  const ipv4 = host.replace(/^::ffff:/u, '');
  return LOOPBACK_NAMES.has(host) || (isIP(ipv4) === IPV4 && ipv4.startsWith(LOOPBACK_IPV4));
}

/** The options of a call of `connect`, in whichever of its forms Node or a library uses. */
function optionsOf([first, second]: readonly unknown[]): unknown {
  if (Array.isArray(first)) {
    // The form that `net.connect` passes on: [options, listener].
    return first.at(0);
  }
  if (typeof first === 'number' || (typeof first === 'string' && DIGITS.test(first))) {
    return { host: typeof second === 'string' ? second : 'localhost' };
  }
  return typeof first === 'string' ? { path: first } : first;
}

/**
 * Refuses a connection that would reach the network. Libraries pass every option
 * they know, unset ones as undefined (fetch passes `path: undefined`), so each one
 * counts by its value, never by its presence.
 */
function refuseNetwork(options: unknown): void {
  if (typeof options !== 'object' || options === null) {
    return;
  }
  const [host, path, lookup] = ['host', 'path', 'lookup'].map((key): unknown =>
    Reflect.get(options, key),
  );
  if (typeof path === 'string' || typeof lookup === 'function') {
    return;
  }
  const target = typeof host === 'string' ? host : 'localhost';
  if (!isLoopback(target)) {
    throw new Error(
      `Tests never reach the network: the connection to ${target} was refused (vitest.network-guard.ts).`,
    );
  }
}

const connect: unknown = Reflect.get(Socket.prototype, 'connect');
if (typeof connect === 'function' && !Reflect.has(Socket.prototype, GUARDED)) {
  Reflect.set(
    Socket.prototype,
    'connect',
    function guardedConnect(this: Socket, ...args: unknown[]): unknown {
      refuseNetwork(optionsOf(args));
      const socket: unknown = Reflect.apply(connect, this, args);
      return socket;
    },
  );
  Reflect.set(Socket.prototype, GUARDED, true);
}
