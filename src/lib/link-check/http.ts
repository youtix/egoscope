// The plain HTTP adapter of the link check (module map §2.3): Node's own HTTP
// client, one connection per request, no cookie kept or sent, and a generic user
// agent that says nothing about the owner or the app (CL-IMP-25, TRV-66). The body
// of an answer is never read: its status and redirect target are enough.
//
// It connects to public addresses only (./address-rules), on the first request as
// on each redirect. An address written in the link is checked as the URL parser
// gives it, before any request. A host name is resolved once for each request, with
// all its addresses, inside the lookup of the connection itself: one address that
// is not public refuses the request, and otherwise the connection goes to the
// addresses just checked, never resolved again. The Host header and the TLS server
// name stay the link's host, against which the certificate is checked.
import { lookup as systemLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { logger } from '@/lib/log';

import { addressKind } from './address-rules';
import { probeThrough } from './follow';

import type { AddressKind, RefusedKind } from './address-rules';
import type { HopAnswer } from './follow';
import type { LinkCheck } from './port';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

/** How the adapter resolves host names, and which addresses a test allows. */
type HttpLinkCheckOptions = Readonly<{
  /** The system's resolver unless a test gives its own. */
  lookup?: LookupFunction;
  /**
   * For tests only, never set by `linkCheck()`: addresses allowed although they are
   * not public, such as the loopback of a test's own server.
   */
  allowedAddresses?: readonly string[];
}>;

/** How the adapter of one `createHttpLinkCheck` resolves names and judges addresses. */
type Settings = Readonly<{
  lookup: LookupFunction;
  kindOf: (address: string) => AddressKind;
}>;

/** The user agent of every probe: a browser's generic form, naming no one. */
export const GENERIC_USER_AGENT = 'Mozilla/5.0 (compatible; LinkCheck/1.0)';

const HEADERS = { 'user-agent': GENERIC_USER_AGENT, accept: '*/*' } as const;
const UNRESOLVED: HopAnswer = { kind: 'unresolved' };
const FAILED: HopAnswer = { kind: 'failed' };
const REFUSED: HopAnswer = { kind: 'refused' };
const BRACKETS = /^\[(?<address>.*)\]$/u;

/** Says whether a request failed because its host name does not resolve. */
const isUnresolved = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOTFOUND';

/** The IP address written as the host of `address`, without its brackets, or nothing for a name. */
function literalAddress(address: URL): string | undefined {
  const host = address.hostname.replace(BRACKETS, '$<address>');
  return isIP(host) === 0 ? undefined : host;
}

/** Ends a hop to an address that is not public, once per probe, saying only its host and kind. */
function refuse(address: URL, kind: RefusedKind): HopAnswer {
  logger.warn('The link check refused an address that is not public.', {
    host: address.hostname,
    kind,
  });
  return REFUSED;
}

/**
 * The lookup of one connection: resolves the name once, with all its addresses,
 * and answers them only when every one is public; otherwise reports the kind of the
 * first refused one through `onRefused` and fails the connection.
 */
function checkedLookup(settings: Settings, onRefused: (kind: RefusedKind) => void): LookupFunction {
  return (hostname, options, callback) => {
    settings.lookup(hostname, { ...options, all: true }, (error, answer, family) => {
      if (error !== null) {
        callback(error, answer, family);
        return;
      }
      const addresses: LookupAddress[] = Array.isArray(answer)
        ? answer
        : [{ address: answer, family: isIP(answer) }];
      const refused = addresses
        .map(({ address }) => settings.kindOf(address))
        .find((kind): kind is RefusedKind => kind !== 'public');
      const [first] = addresses;
      if (refused !== undefined || first === undefined) {
        // A name that answers no address has none that could be checked.
        onRefused(refused ?? 'unreadable');
        callback(new Error(`The link check refuses the addresses of ${hostname}.`), '');
      } else if (options.all === true) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}

/** Sends one GET of `address`, whose host the lookup of its connection checks. */
async function send(address: URL, signal: AbortSignal, settings: Settings): Promise<HopAnswer> {
  const request = address.protocol === 'https:' ? httpsRequest : httpRequest;
  let refused: RefusedKind | undefined;
  const lookup = checkedLookup(settings, (kind) => {
    refused = kind;
  });
  return new Promise((resolve) => {
    const outgoing = request(
      address,
      { method: 'GET', headers: HEADERS, signal, agent: false, lookup },
      (response) => {
        resolve({
          kind: 'answered',
          status: Number(response.statusCode),
          location: response.headers.location ?? null,
        });
        response.destroy();
      },
    );
    outgoing.on('error', (error) => {
      if (refused === undefined) {
        resolve(isUnresolved(error) ? UNRESOLVED : FAILED);
      } else {
        resolve(refuse(address, refused));
      }
    });
    outgoing.end();
  });
}

/** One hop of a probe: refused at once for an address written in the link that is not public, sent otherwise. */
async function hop(address: URL, signal: AbortSignal, settings: Settings): Promise<HopAnswer> {
  const literal = literalAddress(address);
  const kind = literal === undefined ? 'public' : settings.kindOf(literal);
  return kind === 'public' ? send(address, signal, settings) : refuse(address, kind);
}

/**
 * The HTTP link check (IMP-17, CL-IMP-25), which connects to public addresses only,
 * redirects included (TRV-66).
 */
export function createHttpLinkCheck(options: HttpLinkCheckOptions = {}): LinkCheck {
  const allowed = new Set(options.allowedAddresses);
  const settings: Settings = {
    lookup: options.lookup ?? systemLookup,
    kindOf: (address) => (allowed.has(address) ? 'public' : addressKind(address)),
  };
  return {
    probe: async (ctx, request) =>
      probeThrough(async (address, signal) => hop(address, signal, settings), ctx, request),
  };
}
