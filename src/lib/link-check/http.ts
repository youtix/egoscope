// The plain HTTP adapter of the link check (module map §2.3): Node's own HTTP
// client, one connection per request, no cookie kept or sent, and a generic user
// agent that says nothing about the owner or the app (CL-IMP-25, TRV-66). The body
// of an answer is never read: its status and redirect target are enough.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { probeThrough } from './follow';

import type { HopAnswer } from './follow';
import type { LinkCheck } from './port';
import type { LookupFunction } from 'node:net';

/** How the adapter resolves host names: the system's resolver unless a test gives its own. */
type HttpLinkCheckOptions = Readonly<{ lookup?: LookupFunction }>;

/** The user agent of every probe: a browser's generic form, naming no one. */
export const GENERIC_USER_AGENT = 'Mozilla/5.0 (compatible; LinkCheck/1.0)';

const HEADERS = { 'user-agent': GENERIC_USER_AGENT, accept: '*/*' } as const;
const UNRESOLVED: HopAnswer = { kind: 'unresolved' };
const FAILED: HopAnswer = { kind: 'failed' };

/** Says whether a request failed because its host name does not resolve. */
const isUnresolved = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOTFOUND';

async function hop(
  address: URL,
  signal: AbortSignal,
  options: HttpLinkCheckOptions,
): Promise<HopAnswer> {
  const send = address.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const request = send(
      address,
      { method: 'GET', headers: HEADERS, signal, agent: false, ...options },
      (response) => {
        resolve({
          kind: 'answered',
          status: Number(response.statusCode),
          location: response.headers.location ?? null,
        });
        response.destroy();
      },
    );
    request.on('error', (error) => {
      resolve(isUnresolved(error) ? UNRESOLVED : FAILED);
    });
    request.end();
  });
}

/** The HTTP link check (IMP-17, CL-IMP-25). */
export function createHttpLinkCheck(options: HttpLinkCheckOptions = {}): LinkCheck {
  return {
    probe: async (ctx, request) =>
      probeThrough(async (address, signal) => hop(address, signal, options), ctx, request),
  };
}
