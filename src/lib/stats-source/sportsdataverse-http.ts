// The requests of the SportsDataverse adapter (sportsdataverse.ts): each file read at
// its documented direct address, never through the REST API, the redirect to the
// asset host followed by hand so that every HTTP request is counted, every read
// conditional on the version stored from the last one, and each body streamed chunk by
// chunk. The answers map to the port's failures as the statistics-source evaluation
// gives them (section 12, "Answers, errors and call metadata"; section 10, rules 1 and 2).
import { now } from '@/lib/time';

import type { StatsSourceError } from './errors';
import type { CallContext, CallMetadata, ConditionalRead, SourceVersion } from './types';

/** A step of a call: its result, or the failure that ends the call. */
export type Step<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: StatsSourceError }>;

/** A file answered with its body, which a reader then streams. */
type Body = Readonly<{
  version: SourceVersion;
  lastModified: string | null;
  body: ReadableStream<Uint8Array>;
}>;

/** What reads the body of a file. */
export type BodyReader<T> = (call: SourceCall, body: Body) => Promise<Step<T>>;

/** What one request answered once its redirects were followed. */
type Fetched =
  | (Body & Readonly<{ kind: 'body' }>)
  | Readonly<{ kind: 'not_modified' }>
  | Readonly<{ kind: 'redirect' }>
  | Readonly<{ kind: 'failed'; error: StatsSourceError }>;

/** An HTTP request: its address and the version it is conditional on. */
type Request = Readonly<{ address: string; knownVersion: SourceVersion | null }>;

// A browser's generic form, naming neither the owner nor the app (TRV-66).
const USER_AGENT = 'Mozilla/5.0 (compatible; StatsFetch/1.0)';
const MAX_REDIRECTS = 3;
const MOVED_PERMANENTLY = 301;
const FOUND = 302;
const SEE_OTHER = 303;
const TEMPORARY_REDIRECT = 307;
const PERMANENT_REDIRECT = 308;
const REDIRECTS: ReadonlySet<number> = new Set([
  MOVED_PERMANENTLY,
  FOUND,
  SEE_OTHER,
  TEMPORARY_REDIRECT,
  PERMANENT_REDIRECT,
]);
const NOT_MODIFIED_STATUS = 304;
const FORBIDDEN_STATUS = 403;
const NOT_FOUND_STATUS = 404;
const TOO_MANY_REQUESTS_STATUS = 429;
const RATE_LIMIT_HEADERS = ['retry-after', 'x-ratelimit-remaining'];
const SECONDS = /^\d+$/u;
const MS_PER_SECOND = 1000;
const ABORTED: StatsSourceError = { kind: 'aborted' };
const UNAVAILABLE: StatsSourceError = { kind: 'unavailable' };
const NOT_MODIFIED: Fetched & ConditionalRead<never> = { kind: 'not_modified' };

/** Fails a call with `error`. */
export const fail = <T>(error: StatsSourceError): Step<T> => ({ ok: false, error });

/** Continues a call with `value`. */
export const succeed = <T>(value: T): Step<T> => ({ ok: true, value });

/** One HTTP request with the generic user agent and the stored version, or nothing when it fails or its call ends. */
async function fetchOnce(
  { address, knownVersion }: Request,
  signal: AbortSignal,
): Promise<Response | undefined> {
  const condition = knownVersion === null ? {} : { 'if-none-match': knownVersion };
  try {
    return await fetch(address, {
      headers: { 'user-agent': USER_AGENT, ...condition },
      redirect: 'manual',
      signal,
    });
  } catch {
    return undefined;
  }
}

/** The next chunk of a body, or nothing when the read fails or its call ends. */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  try {
    return await reader.read();
  } catch {
    return undefined;
  }
}

/** The delay that a `Retry-After` header gives in seconds, or none (STA-39). */
const retryAfterOf = (value: string | null): number | null =>
  value !== null && SECONDS.test(value) ? Number(value) * MS_PER_SECOND : null;

/** The failure of an answer that is neither a file nor a redirect: 404 a season not held, 429 or 403 with rate-limit headers a quota answer (CL-STA-15). */
function errorOf({ status, headers }: Response): StatsSourceError {
  if (status === NOT_FOUND_STATUS) {
    return { kind: 'not_published' };
  }
  const isQuota =
    status === TOO_MANY_REQUESTS_STATUS ||
    (status === FORBIDDEN_STATUS && RATE_LIMIT_HEADERS.some((header) => headers.has(header)));
  return isQuota
    ? { kind: 'rate_limited', retryAfterMs: retryAfterOf(headers.get('retry-after')) }
    : UNAVAILABLE;
}

/** Why a request that gave no file failed: its error, or an outage for redirects that never end. */
const failureOf = (fetched: Exclude<Fetched, { kind: 'body' }>): StatsSourceError =>
  fetched.kind === 'failed' ? fetched.error : UNAVAILABLE;

/**
 * One call to the source (module map §5): the signal that ends it at its deadline or
 * at its abort, its requests and reads, and what they cost — every HTTP request, a
 * redirect included, the bytes received, and one file request per file answered 200
 * or 304, which the daily ceilings count (statistics service sheet, "Limits").
 */
export class SourceCall {
  readonly #ctx: CallContext;
  readonly #signal: AbortSignal;
  #httpRequests = 0;
  #bytesReceived = 0;
  #fileRequests = 0;

  /** A call that ends at the context's deadline or abort. */
  constructor(ctx: CallContext) {
    const timeLeft = AbortSignal.timeout(Math.max(0, ctx.deadline - now()));
    this.#ctx = ctx;
    this.#signal = AbortSignal.any([ctx.signal, timeLeft]);
  }

  /** Requests `request`, following at most `hopsLeft` redirects, each an HTTP request (section 10, rule 1). */
  async #request(request: Request, hopsLeft: number): Promise<Fetched> {
    this.#httpRequests += 1;
    const response = await fetchOnce(request, this.#signal);
    if (response === undefined) {
      return { kind: 'failed', error: this.failure };
    }
    if (!REDIRECTS.has(response.status)) {
      return this.#answerOf(response, request.knownVersion);
    }
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (location === null) {
      return { kind: 'failed', error: UNAVAILABLE };
    }
    const address = new URL(location, request.address).href;
    return hopsLeft === 0
      ? { kind: 'redirect' }
      : this.#request({ ...request, address }, hopsLeft - 1);
  }

  /** A final answer: a file with its version, `not_modified` for the version sent, or a failure. */
  async #answerOf(response: Response, knownVersion: SourceVersion | null): Promise<Fetched> {
    const version = response.headers.get('etag');
    if (knownVersion !== null && response.status === NOT_MODIFIED_STATUS) {
      this.#fileRequests += 1;
      return NOT_MODIFIED;
    }
    if (version !== null && response.ok && response.body !== null) {
      this.#fileRequests += 1;
      const lastModified = response.headers.get('last-modified');
      return { kind: 'body', version, lastModified, body: response.body };
    }
    await response.body?.cancel();
    return { kind: 'failed', error: errorOf(response) };
  }

  /** What the call has cost so far (TRV-03, CL-STA-15). */
  get metadata(): CallMetadata {
    return {
      httpRequests: this.#httpRequests,
      bytesReceived: this.#bytesReceived,
      fileRequests: this.#fileRequests,
    };
  }

  /** Why a request or a read that did not complete failed: the abort, else an outage or the deadline (CL-STA-15). */
  get failure(): StatsSourceError {
    return this.#ctx.signal.aborted ? ABORTED : UNAVAILABLE;
  }

  /** Requests `address` once, without following a redirect, which counts as an answer (TRV-47). */
  async probe(address: string): Promise<Step<null>> {
    const fetched = await this.#request({ address, knownVersion: null }, 0);
    if (fetched.kind === 'body') {
      await fetched.body.cancel();
    }
    return fetched.kind === 'failed' ? fail(fetched.error) : succeed(null);
  }

  /** Reads `address` conditionally on `knownVersion`, its body by `readBody` (section 10, rule 2). */
  async read<T>(request: Request, readBody: BodyReader<T>): Promise<Step<ConditionalRead<T>>> {
    const fetched = await this.#request(request, MAX_REDIRECTS);
    if (fetched.kind === 'not_modified') {
      return succeed(NOT_MODIFIED);
    }
    if (fetched.kind !== 'body') {
      return fail(failureOf(fetched));
    }
    const read = await readBody(this, fetched);
    return read.ok ? succeed({ kind: 'read', version: fetched.version, data: read.value }) : read;
  }

  /** Reads `address` whatever its version, its body by `readBody`. */
  async readFile<T>(address: string, readBody: BodyReader<T>): Promise<Step<T>> {
    const fetched = await this.#request({ address, knownVersion: null }, MAX_REDIRECTS);
    return fetched.kind === 'body' ? readBody(this, fetched) : fail(failureOf(fetched));
  }

  /** Streams `body` into `canTake` chunk by chunk, counting its bytes; false once `canTake` refuses a chunk. */
  async drain(
    body: ReadableStream<Uint8Array>,
    canTake: (text: string) => boolean,
  ): Promise<Step<boolean>> {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let isTaken = true;
    let chunk = await readChunk(reader);
    while (isTaken && chunk?.done === false) {
      this.#bytesReceived += chunk.value.byteLength;
      isTaken = canTake(decoder.decode(chunk.value, { stream: true }));
      chunk = isTaken ? await readChunk(reader) : chunk;
    }
    if (!isTaken) {
      await reader.cancel();
      return succeed(false);
    }
    return chunk === undefined ? fail(this.failure) : succeed(canTake(decoder.decode()));
  }
}
