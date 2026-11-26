// The HTTP layer of the GitHub backup adapter (github-releases.ts): plain `fetch`
// with the headers of the backup storage sheet ("How it is called"), the token only in
// the Authorization header of GitHub's own hosts (TRV-64), every redirect left to the
// caller so that each HTTP request is counted, and GitHub's answers mapped to the
// port's failures. Each answer's `x-ratelimit-reset` gives the instant the hourly
// window of REST requests resets (CL-TRV-12).
import { z } from 'zod';

import { now, toEpochMs } from '@/lib/time';

import type { BackupStorageError } from './errors';
import type { BackupStorageOutcome, CallContext, CallMetadata } from './types';
import type { Secret } from '@/lib/env';
import type { EpochMs } from '@/lib/time';

/** A step of a call: its result, or the failure that ends the call. */
export type Step<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: BackupStorageError }>;

/** A request: its address, its method, the media type it wants and its body. */
export type GithubRequest = Readonly<{
  url: string;
  method?: 'GET' | 'POST' | 'DELETE';
  accept?: string;
  body?: Readonly<{ bytes: Uint8Array<ArrayBuffer>; type: string }>;
}>;

/** An answer read whole: its status, its headers and its text. */
type Answer = Readonly<{ status: number; headers: Headers; text: string }>;

/** GitHub's REST API, the only host besides the uploads one that receives the token. */
export const API = 'https://api.github.com';
/** The host that takes the files of release assets. */
export const UPLOADS = 'https://uploads.github.com';
/** The media type of a file's bytes. */
export const OCTET_STREAM = 'application/octet-stream';
const OK = 200;
export const CREATED = 201;
export const NO_CONTENT = 204;
export const FOUND = 302;
export const UNPROCESSABLE = 422;

const API_VERSION = '2026-03-10';
const GITHUB_JSON = 'application/vnd.github+json';
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND_STATUS = 404;
const TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;
// Epoch seconds, short enough to stay an instant.
const RESET_SECONDS = /^\d{1,12}$/u;
const NEXT = 'rel="next"';
const TOKEN_REJECTED: BackupStorageError = { kind: 'unauthorized', cause: 'token_rejected' };
const NOT_FOUND: BackupStorageError = { kind: 'not_found' };
const RATE_LIMITED: BackupStorageError = { kind: 'rate_limited' };
// The words of the message of a 403 from the primary and the secondary rate limit alike.
const RATE_LIMIT_MESSAGE = /rate limit/iu;
const ERROR_BODY = z.object({ message: z.string() });

/** The failure of a service that cannot be reached, fails, or answers in another shape. */
export const UNAVAILABLE: BackupStorageError = { kind: 'unavailable' };

/** Fails a call with `error`. */
export const fail = <T>(error: BackupStorageError): Step<T> => ({ ok: false, error });

/** Continues a call with `value`. */
export const succeed = <T>(value: T): Step<T> => ({ ok: true, value });

/** The value of `text` read as JSON by `schema`; unavailable for an answer of another shape. */
export function parsedJson<T>(schema: z.ZodType<T>, text: string): Step<T> {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? succeed(parsed.data) : fail(UNAVAILABLE);
  } catch {
    return fail(UNAVAILABLE);
  }
}

/** Whether the JSON body `text` of an answer has a message that names a rate limit. */
function isRateLimitMessage(text: string): boolean {
  const body = parsedJson(ERROR_BODY, text);
  return RATE_LIMIT_MESSAGE.test(body.ok ? body.value.message : text);
}

/**
 * The failure an answer stands for (TRV-47): 429 is the rate limit, and so is a 403 with no
 * request left, with a `retry-after` header or with a JSON message that says "rate limit" in
 * any letter case, as the primary and the secondary limit write it; another 401 or 403 is a
 * rejected token, whatever its body, which is never thrown on.
 */
export function errorOf(status: number, headers: Headers, text: string): BackupStorageError {
  const isRateLimit =
    status === TOO_MANY_REQUESTS ||
    (status === FORBIDDEN &&
      (headers.get('x-ratelimit-remaining') === '0' ||
        headers.has('retry-after') ||
        isRateLimitMessage(text)));
  if (isRateLimit) {
    return RATE_LIMITED;
  }
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    return TOKEN_REJECTED;
  }
  return status === NOT_FOUND_STATUS ? NOT_FOUND : UNAVAILABLE;
}

/** The next page that a `Link` header gives, when it stays on the API's host. */
function nextPage(link: string | null): string | null {
  const next = link?.split(',').find((part) => part.includes(NEXT));
  const address = next?.slice(next.indexOf('<') + 1, next.indexOf('>'));
  return address?.startsWith(`${API}/`) === true ? address : null;
}

/** One call to GitHub inside its context, with what its requests cost (TRV-03, CL-TRV-12). */
export class GithubCall {
  readonly #fetch: typeof fetch;
  readonly #token: Secret;
  readonly #signal: AbortSignal;
  #httpRequests = 0;
  #bytesSent = 0;
  #bytesReceived = 0;
  #resetsAt: EpochMs | null = null;

  /** A call that ends at the context's deadline or abort. */
  constructor(fetcher: typeof fetch, token: Secret, ctx: CallContext) {
    const timeLeft = AbortSignal.timeout(Math.max(0, ctx.deadline - now()));
    this.#fetch = fetcher;
    this.#token = token;
    this.#signal = AbortSignal.any([ctx.signal, timeLeft]);
  }

  #noteReset(headers: Headers): void {
    const reset = headers.get('x-ratelimit-reset');
    if (reset !== null && RESET_SECONDS.test(reset)) {
      this.#resetsAt = toEpochMs(Number(reset) * MS_PER_SECOND);
    }
  }

  async #textOf(response: Response): Promise<string | undefined> {
    try {
      const body = new Uint8Array(await response.arrayBuffer());
      this.#bytesReceived += body.byteLength;
      return new TextDecoder().decode(body);
    } catch {
      return undefined;
    }
  }

  /** The headers of `request`: the token and the API version to GitHub's own hosts alone. */
  #headersOf(request: GithubRequest, isGithub: boolean): Readonly<Record<string, string>> {
    const credentials = isGithub
      ? { authorization: `Bearer ${this.#token.reveal()}`, 'x-github-api-version': API_VERSION }
      : {};
    const type = request.body === undefined ? {} : { 'content-type': request.body.type };
    return { accept: request.accept ?? GITHUB_JSON, ...credentials, ...type };
  }

  /** Sends `request`, with the token to GitHub's own hosts alone; nothing when it fails or the call ends. */
  async send(request: GithubRequest, isGithub = true): Promise<Response | undefined> {
    this.#httpRequests += 1;
    this.#bytesSent += request.body?.bytes.byteLength ?? 0;
    // Called on its own, as the global `fetch` expects, never as a method of this call.
    const send = this.#fetch;
    try {
      const response = await send(request.url, {
        method: request.method ?? 'GET',
        headers: this.#headersOf(request, isGithub),
        body: request.body?.bytes ?? null,
        redirect: 'manual',
        signal: this.#signal,
      });
      this.#noteReset(response.headers);
      return response;
    } catch {
      return undefined;
    }
  }

  /** Sends `request` and reads its answer whole, which must have one of the `expected` statuses. */
  async read(request: GithubRequest, expected: readonly number[] = [OK]): Promise<Step<Answer>> {
    const response = await this.send(request);
    const text = response === undefined ? undefined : await this.#textOf(response);
    if (response === undefined || text === undefined) {
      return fail(UNAVAILABLE);
    }
    const { status, headers } = response;
    return expected.includes(status)
      ? succeed({ status, headers, text })
      : fail(errorOf(status, headers, text));
  }

  /** Every item of the pages from `url` on, each `Link` to the next followed (sheet, step 3). */
  async pages<T>(
    url: string,
    item: z.ZodType<T>,
    before: readonly T[] = [],
  ): Promise<Step<readonly T[]>> {
    const answer = await this.read({ url });
    if (!answer.ok) {
      return answer;
    }
    const page = parsedJson(item.array(), answer.value.text);
    if (!page.ok) {
      return page;
    }
    const items = [...before, ...page.value];
    const next = nextPage(answer.value.headers.get('link'));
    return next === null ? succeed(items) : this.pages(next, item, items);
  }

  /** The body of a file's answer, its declared length counted; else the failure that `errorFor` gives. */
  async stream(
    response: Response | undefined,
    errorFor: (status: number, headers: Headers, text: string) => BackupStorageError,
  ): Promise<Step<ReadableStream<Uint8Array>>> {
    if (response === undefined) {
      return fail(UNAVAILABLE);
    }
    if (response.status === OK && response.body !== null) {
      const length = Number(response.headers.get('content-length'));
      this.#bytesReceived += Number.isSafeInteger(length) ? length : 0;
      return succeed(response.body);
    }
    const text = await this.#textOf(response);
    return fail(errorFor(response.status, response.headers, text ?? ''));
  }

  /** The outcome of the call, with what it cost. */
  outcome<T>(step: Step<T>): BackupStorageOutcome<T> {
    const call: CallMetadata = {
      httpRequests: this.#httpRequests,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
      rateLimitResetsAt: this.#resetsAt,
    };
    return step.ok ? { ok: true, value: step.value, call } : { ok: false, error: step.error, call };
  }
}
