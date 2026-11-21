// The rules every link-check adapter applies (CL-IMP-25): a GET of the address, up
// to 5 redirects followed, the whole probe lasting the request's timeout at most,
// then the verdict of the final answer. Each adapter only says how it sends one
// request (`Hop`).
import { now } from '@/lib/time';

import type { LinkCheckOutcome } from './port';
import type { CallContext, LinkProbe, ProbeRequest } from './types';

/** An answer to one request, with its status and redirect target. */
type AnsweredHop = Readonly<{ kind: 'answered'; status: number; location: string | null }>;

/** What one request brought: an answer, or none. */
export type HopAnswer =
  | AnsweredHop
  /** The host name does not resolve. */
  | Readonly<{ kind: 'unresolved' }>
  /** No answer: a refused connection, a certificate failure, a timeout or an abort. */
  | Readonly<{ kind: 'failed' }>;

/** Sends one GET of `address`, which `signal` can stop; a fake answers at once. */
type Hop = (address: URL, signal: AbortSignal) => HopAnswer | Promise<HopAnswer>;

/** A probe under way: the signal that stops its requests, and whether its call context cut it short. */
type Run = Readonly<{ signal: AbortSignal; isCut: () => boolean }>;

/** The most redirects a probe follows. */
const MAX_REDIRECTS = 5;

const MOVED_PERMANENTLY = 301;
const FOUND = 302;
const SEE_OTHER = 303;
const TEMPORARY_REDIRECT = 307;
const PERMANENT_REDIRECT = 308;
const NOT_FOUND = 404;
const GONE = 410;
const FIRST_SUCCESS = 200;
const LAST_SUCCESS = 299;
const REDIRECTS: ReadonlySet<number> = new Set([
  MOVED_PERMANENTLY,
  FOUND,
  SEE_OTHER,
  TEMPORARY_REDIRECT,
  PERMANENT_REDIRECT,
]);
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
const NOT_A_WEB_ADDRESS: LinkProbe = { verdict: 'unreachable', status: null };

const verdict = (value: LinkProbe, httpRequests: number): LinkCheckOutcome => ({
  ok: true,
  value,
  call: { httpRequests },
});

const aborted = (httpRequests: number): LinkCheckOutcome => ({
  ok: false,
  error: { kind: 'aborted' },
  call: { httpRequests },
});

/** A web address to open, or nothing for any other text. */
function webAddress(text: string, base?: URL): URL | undefined {
  const address = URL.parse(text, base);
  return address !== null && WEB_PROTOCOLS.has(address.protocol) ? address : undefined;
}

/** The verdict of a final answer: only a 404 or a 410 means the page does not exist (CL-IMP-25). */
function verdictOf(status: number): LinkProbe {
  if (status === NOT_FOUND || status === GONE) {
    return { verdict: 'not_found', status };
  }
  const isSuccess = status >= FIRST_SUCCESS && status <= LAST_SUCCESS;
  return { verdict: isSuccess ? 'reachable' : 'unreachable', status };
}

/** The verdict of a request that brought no answer: only a host name that does not resolve means not found. */
const noAnswerVerdict = (kind: 'unresolved' | 'failed'): LinkProbe => ({
  verdict: kind === 'unresolved' ? 'not_found' : 'unreachable',
  status: null,
});

/** Where an answer leads: the web address a redirect names, or nothing for a final answer. */
function redirectOf(answer: AnsweredHop, address: URL): URL | undefined {
  return answer.location === null || !REDIRECTS.has(answer.status)
    ? undefined
    : webAddress(answer.location, address);
}

/**
 * The signal of a probe, which its call context or its own timeout stops, and
 * whether the call context, rather than that timeout, has cut it short: its signal,
 * or a deadline nearer than the timeout.
 */
function runOf(ctx: CallContext, timeoutMs: number): Run {
  const left = ctx.deadline - now();
  const timeout = AbortSignal.timeout(Math.max(0, Math.min(timeoutMs, left)));
  return {
    signal: AbortSignal.any([ctx.signal, timeout]),
    isCut: () => ctx.signal.aborted || left <= 0 || (timeout.aborted && left < timeoutMs),
  };
}

/** Sends the request of `address`, then follows its redirect, `made` requests having been made before. */
async function follow(
  hop: Hop,
  run: Run,
  at: Readonly<{ address: URL; made: number }>,
): Promise<LinkCheckOutcome> {
  const { address, made } = at;
  if (run.isCut()) {
    return aborted(made);
  }
  const answer = await hop(address, run.signal);
  const requests = made + 1;
  if (answer.kind !== 'answered') {
    return run.isCut() ? aborted(requests) : verdict(noAnswerVerdict(answer.kind), requests);
  }
  const next = made < MAX_REDIRECTS ? redirectOf(answer, address) : undefined;
  return next === undefined
    ? verdict(verdictOf(answer.status), requests)
    : follow(hop, run, { address: next, made: requests });
}

/**
 * Opens `request.url` through `hop` and judges the final answer (IMP-17, CL-IMP-25):
 * `not_found` for a 404, a 410 or a host name that does not resolve, `reachable` for
 * a success, `unreachable` for anything else, a timeout of the request's own
 * included. A probe that its call context stops, by its signal or by a deadline
 * nearer than the request's timeout, answers `aborted` instead.
 */
export async function probeThrough(
  hop: Hop,
  ctx: CallContext,
  request: ProbeRequest,
): Promise<LinkCheckOutcome> {
  const address = webAddress(request.url);
  return address === undefined
    ? verdict(NOT_A_WEB_ADDRESS, 0)
    : follow(hop, runOf(ctx, request.timeoutMs), { address, made: 0 });
}
