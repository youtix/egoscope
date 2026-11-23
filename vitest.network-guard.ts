// Keeps every test off the network (module map §5: "tests never call out"). Every
// TCP or TLS connection of Node goes through `Socket.prototype.connect`, which this
// setup file wraps before any test runs: a connection to a host other than the
// loopback fails at once, before any name is resolved, with an error that names the
// host. A local server of the test and a local socket path stay allowed. A
// connection to a host name that brings its own `lookup`, which the test answers
// itself, gets that lookup wrapped: an answer outside the loopback fails the
// connection, with an error that names the address. Every Vitest project loads it
// first (vitest.config.ts).
import { isIP, Socket } from 'node:net';

import type { LookupFunction } from 'node:net';

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

const refusal = (what: string): Error =>
  new Error(`Tests never reach the network: ${what} was refused (vitest.network-guard.ts).`);

type LookupCallback = Parameters<LookupFunction>[2];

/** The callback of a test's lookup of `hostname`, failing the connection on an answer outside the loopback. */
function loopbackAnswers(hostname: string, callback: LookupCallback): LookupCallback {
  return (error, address, family) => {
    const answers = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
    const outside = answers.find((answer) => !isLoopback(answer));
    if (error === null && outside !== undefined) {
      callback(refusal(`the address ${outside} that the lookup of ${hostname} answered`), '');
    } else {
      callback(error, address, family);
    }
  };
}

/**
 * Refuses a connection that would reach the network. Libraries pass every option
 * they know, unset ones as undefined (fetch passes `path: undefined`), so each one
 * counts by its value, never by its presence. Node resolves a host name only, so the
 * lookup that a connection brings is wrapped for a name, and a host written as an
 * address is checked itself.
 */
function refuseNetwork(options: unknown): void {
  if (typeof options !== 'object' || options === null) {
    return;
  }
  const [host, path, lookup] = ['host', 'path', 'lookup'].map((key): unknown =>
    Reflect.get(options, key),
  );
  if (typeof path === 'string') {
    return;
  }
  const target = typeof host === 'string' ? host : 'localhost';
  if (typeof lookup === 'function' && isIP(target) === 0) {
    const checked: LookupFunction = (hostname, lookupOptions, callback) => {
      Reflect.apply(lookup, undefined, [
        hostname,
        lookupOptions,
        loopbackAnswers(hostname, callback),
      ]);
    };
    Reflect.set(options, 'lookup', checked);
  } else if (!isLoopback(target)) {
    throw refusal(`the connection to ${target}`);
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
