// Keeps every test off the network (module map §5: "tests never call out"). Every
// TCP or TLS connection of Node goes through `Socket.prototype.connect`, and every
// name that the system resolves goes through `dns.lookup` or `dns.promises.lookup`,
// which this setup file wraps before any test runs. A connection to a host other
// than the loopback fails at once, before any name is resolved, with an error that
// names the host. A local server of the test and a local socket path stay allowed.
// A connection to a host name that brings its own `lookup`, which the test answers
// itself, gets that lookup wrapped: an answer outside the loopback fails the
// connection, with an error that names the address. The system resolver refuses at
// once every name but `localhost`, so a lookup that hands the name on to it, as the
// link check's adapter does, fails before any query leaves the machine; an address
// needs no query and stays allowed. Every Vitest project loads it first
// (vitest.config.ts).
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
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
    if (error !== null) {
      // A failed lookup answers no address, as `dns.lookup` does: pass its error on.
      callback(error, address, family);
      return;
    }
    const answers = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
    const outside = answers.find((answer) => !isLoopback(answer));
    if (outside === undefined) {
      callback(error, address, family);
    } else {
      callback(refusal(`the address ${outside} that the lookup of ${hostname} answered`), '');
    }
  };
}

/**
 * The refusal of a connection that would reach the network. Libraries pass every
 * option they know, unset ones as undefined (fetch passes `path: undefined`), so
 * each one counts by its value, never by its presence. Node resolves a host name
 * only, so the lookup that a connection brings is wrapped for a name, and a host
 * written as an address is checked itself.
 */
function connectionRefusal(args: readonly unknown[]): Error | undefined {
  const options = optionsOf(args);
  if (typeof options !== 'object' || options === null) {
    return undefined;
  }
  const [host, path, lookup] = ['host', 'path', 'lookup'].map((key): unknown =>
    Reflect.get(options, key),
  );
  if (typeof path === 'string') {
    return undefined;
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
    return undefined;
  }
  return isLoopback(target) ? undefined : refusal(`the connection to ${target}`);
}

/**
 * The refusal of a name that the system resolver would ask the network about: every
 * name but `localhost`. An address resolves without a query, and an argument that is
 * not text is left to the resolver's own checks.
 */
function lookupRefusal([hostname]: readonly unknown[]): Error | undefined {
  return typeof hostname === 'string' && isIP(hostname) === 0 && !isLoopback(hostname)
    ? refusal(`the lookup of ${hostname}`)
    : undefined;
}

/** The refusal of a call that would reach the network, given its arguments, or nothing. */
type Refusal = (args: readonly unknown[]) => Error | undefined;
/** Calls the method that a guard replaces, on `self`, with `args`. */
type Original = (self: unknown, args: readonly unknown[]) => unknown;
/** A method, as a guard replaces it. */
type Method = (this: unknown, ...args: unknown[]) => unknown;

/** The method of a call that answers by its callback or its events: it fails a refused call at once, by throwing. */
const throwingGuard =
  (refusalOf: Refusal) =>
  (original: Original): Method =>
    function guardedCall(this: unknown, ...args: unknown[]): unknown {
      const refused = refusalOf(args);
      if (refused !== undefined) {
        throw refused;
      }
      return original(this, args);
    };

/** The method of a call that answers by a promise: it fails a refused call at once, by rejecting it. */
const rejectingGuard =
  (refusalOf: Refusal) =>
  (original: Original): Method =>
    async function guardedCall(this: unknown, ...args: unknown[]): Promise<unknown> {
      const refused = refusalOf(args);
      if (refused !== undefined) {
        throw refused;
      }
      const answer: unknown = await original(this, args);
      return answer;
    };

/**
 * Replaces the method `key` of `owner` by the method that `guarded` makes of it, once per
 * process. The new method takes every own property of the original, symbols included,
 * such as the one that makes `util.promisify(dns.lookup)` answer `{ address, family }`.
 */
function guard(owner: object, key: string, guarded: (original: Original) => Method): void {
  const original: unknown = Reflect.get(owner, key);
  if (typeof original !== 'function' || Reflect.has(original, GUARDED)) {
    return;
  }
  const method = guarded((self, args) => {
    const result: unknown = Reflect.apply(original, self, args);
    return result;
  });
  // The descriptors of every own key of the original, a string or a symbol.
  Object.defineProperties(method, Object.getOwnPropertyDescriptors(original));
  Reflect.set(method, GUARDED, true);
  Reflect.set(owner, key, method);
}

guard(Socket.prototype, 'connect', throwingGuard(connectionRefusal));
guard(dns, 'lookup', throwingGuard(lookupRefusal));
guard(dns.promises, 'lookup', rejectingGuard(lookupRefusal));
// The named exports of `node:dns` and `node:dns/promises`, which ES modules import,
// follow the methods just replaced only once they are synced.
syncBuiltinESMExports();
