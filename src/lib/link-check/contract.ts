// The behavior every link-check adapter shares (module map §2.3, §5), as a table:
// how an address answers, and what the probe must make of it. The port's own tests
// run each row against the fake and against the HTTP adapter with a local server.
// Never re-exported by index.ts.
import { now, toEpochMs } from '@/lib/time';

import type { LinkCheck } from './port';
import type { LinkProbe } from './types';

/** How the address of a row answers. */
export type LinkAnswer =
  | Readonly<{ kind: 'status'; status: number }>
  /** `redirects` redirects, then `status`. */
  | Readonly<{ kind: 'redirects'; redirects: number; status: number }>
  | Readonly<{ kind: 'unresolved' }>
  /** No answer within the probe's timeout. */
  | Readonly<{ kind: 'slow' }>;

/** An adapter under test, and the address that answers as each row says. */
export type LinkCheckHarness = Readonly<{
  linkCheck: LinkCheck;
  addressOf: (answer: LinkAnswer) => string;
}>;

/** What a probe showed, and the requests it made. */
type LinkObservation = Readonly<{ answer: LinkProbe | 'aborted'; httpRequests: number }>;

/** One row of the contract: how the address answers, and what the probe must show. */
type LinkContractCase = Readonly<{
  title: string;
  answer: LinkAnswer;
  /** Whether the call's signal has aborted before the probe. */
  isAborted: boolean;
  expected: LinkObservation;
}>;

/** The timeout of every probe of the contract, which a slow answer outlasts. */
const CONTRACT_TIMEOUT_MS = 200;

const DEADLINE_MS = 10_000;
const OK = 200;
const FOUND = 302;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const GONE = 410;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const SERVICE_UNAVAILABLE = 503;
// CL-IMP-25 follows up to 5 redirects, so a probe makes 6 requests at most: written
// here as the ruling says, never read from the adapters, so that a wrong cap fails.
const REDIRECTS_FOLLOWED = 5;
const ONE_REDIRECT_TOO_MANY = 6;
const MOST_REQUESTS = 6;

const row = (title: string, answer: LinkAnswer, expected: LinkObservation): LinkContractCase => ({
  title,
  answer,
  isAborted: false,
  expected,
});

const status = (code: number): LinkAnswer => ({ kind: 'status', status: code });

const once = (verdict: LinkProbe['verdict'], code: number | null): LinkObservation => ({
  answer: { verdict, status: code },
  httpRequests: 1,
});

/** Probes the address of `contractCase` through the harness, and says what came of it (IMP-17, CL-IMP-25). */
export async function observeProbe(
  { linkCheck, addressOf }: LinkCheckHarness,
  { answer, isAborted }: LinkContractCase,
): Promise<LinkObservation> {
  const controller = new AbortController();
  if (isAborted) {
    controller.abort();
  }
  const ctx = { deadline: toEpochMs(now() + DEADLINE_MS), signal: controller.signal };
  const outcome = await linkCheck.probe(ctx, {
    url: addressOf(answer),
    timeoutMs: CONTRACT_TIMEOUT_MS,
  });
  return {
    answer: outcome.ok ? outcome.value : 'aborted',
    httpRequests: outcome.call.httpRequests,
  };
}

/** The contract of the link-check port (IMP-17, CL-IMP-25). */
export const LINK_CHECK_CONTRACT: readonly LinkContractCase[] = [
  row('finds a page that answers 200', status(OK), once('reachable', OK)),
  row('marks a page that answers 404 not found', status(NOT_FOUND), once('not_found', NOT_FOUND)),
  row('marks a page that answers 410 not found', status(GONE), once('not_found', GONE)),
  row(
    'marks a host name that does not resolve not found',
    { kind: 'unresolved' },
    once('not_found', null),
  ),
  ...[UNAUTHORIZED, FORBIDDEN, TOO_MANY_REQUESTS, SERVER_ERROR, SERVICE_UNAVAILABLE].map((code) =>
    row(
      `reports a page that answers ${String(code)} unreachable`,
      status(code),
      once('unreachable', code),
    ),
  ),
  row(
    'reports a page that does not answer in time unreachable',
    { kind: 'slow' },
    once('unreachable', null),
  ),
  row(
    'follows 5 redirects to the final page',
    { kind: 'redirects', redirects: REDIRECTS_FOLLOWED, status: OK },
    { answer: { verdict: 'reachable', status: OK }, httpRequests: MOST_REQUESTS },
  ),
  row(
    'stops at a sixth redirect and reports the page unreachable',
    { kind: 'redirects', redirects: ONE_REDIRECT_TOO_MANY, status: OK },
    { answer: { verdict: 'unreachable', status: FOUND }, httpRequests: MOST_REQUESTS },
  ),
  {
    title: 'answers aborted, without a request, once the signal has aborted',
    answer: status(OK),
    isAborted: true,
    expected: { answer: 'aborted', httpRequests: 0 },
  },
];
