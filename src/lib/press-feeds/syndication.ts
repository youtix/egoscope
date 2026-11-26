// The syndication adapter of the press feeds (module map §2.3, §5): one anonymous GET
// of a feed's address, conditional on the version stored from the last read, with a
// generic user agent and no cookie, credential or detail about the owner (COL-02,
// TRV-66). It requests the feed alone, never an article's page (COL-26), follows
// redirects by hand so that each request is counted, and names the new address of a
// permanent one without keeping it (CL-COL-19). A feed comes from a stranger: its body
// is read up to a bound, then parsed as syndication-xml.ts says (TRV-17).
import { now } from '@/lib/time';

import { feedIn, webAddress } from './syndication-xml';

import type { PressFeedsError } from './errors';
import type { CallContext, CallMetadata, FeedRead, PressFeeds, PressFeedsOutcome } from './types';

/** The user agent of every read: a browser's generic form, naming neither the owner nor the app (TRV-66). */
export const FEED_USER_AGENT = 'Mozilla/5.0 (compatible; FeedFetch/1.0)';

/** The most bytes read of one answer, 4 MiB: a feed weighs a few hundred kilobytes, and a larger body is not read (TRV-17). */
export const MAX_FEED_BYTES = 4_194_304;

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8';
const MAX_REDIRECTS = 5;
const MOVED_PERMANENTLY = 301;
const FOUND = 302;
const SEE_OTHER = 303;
const NOT_MODIFIED = 304;
const TEMPORARY_REDIRECT = 307;
const PERMANENT_REDIRECT = 308;
const UNAUTHORIZED = 401;
const PAYMENT_REQUIRED = 402;
const REDIRECTS: ReadonlySet<number> = new Set([
  MOVED_PERMANENTLY,
  FOUND,
  SEE_OTHER,
  TEMPORARY_REDIRECT,
  PERMANENT_REDIRECT,
]);
const PERMANENT_REDIRECTS: ReadonlySet<number> = new Set([MOVED_PERMANENTLY, PERMANENT_REDIRECT]);
// An account, a login or a subscription (COL-02).
const IDENTIFICATION_STATUSES: ReadonlySet<number> = new Set([UNAUTHORIZED, PAYMENT_REQUIRED]);
// A stored version is an entity tag when it has an entity tag's form, else a date.
const ENTITY_TAG = /^(?:W\/)?"/u;

const UNREACHABLE: PressFeedsError = { kind: 'unreachable' };
const UNREADABLE: PressFeedsError = { kind: 'unreadable' };
const NO_CALL: CallMetadata = { httpRequests: 0, bytesReceived: 0 };

/** A step of a read: its result, or the failure that ends it. */
type Step<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: PressFeedsError }>;

/** A request still to send: its address, the version it is conditional on, and where its redirects led. */
type Hop = Readonly<{
  address: string;
  knownVersion: string | null;
  hopsLeft: number;
  isMoving: boolean;
  movedTo: string | null;
}>;

/** The final answer of a request, and the address that gave it. */
type Answered = Readonly<{ response: Response; address: string; movedTo: string | null }>;

const fail = <T>(error: PressFeedsError): Step<T> => ({ ok: false, error });
const succeed = <T>(value: T): Step<T> => ({ ok: true, value });

/** The failure of an error status: an account or a subscription asked for, or the status itself (COL-02, COL-41). */
const statusError = (status: number): PressFeedsError =>
  IDENTIFICATION_STATUSES.has(status)
    ? { kind: 'requires_identification' }
    : { kind: 'http_error', status };

/** The headers of a request: the generic agent, and the stored version as an entity tag or as a date. */
function headersFor(knownVersion: string | null): Readonly<Record<string, string>> {
  const headers = { 'user-agent': FEED_USER_AGENT, accept: ACCEPT };
  if (knownVersion === null) {
    return headers;
  }
  const condition = ENTITY_TAG.test(knownVersion) ? 'if-none-match' : 'if-modified-since';
  return { ...headers, [condition]: knownVersion };
}

/** One GET of the hop's address, or nothing when no answer comes. */
async function send(hop: Hop, signal: AbortSignal): Promise<Response | undefined> {
  try {
    return await fetch(hop.address, {
      headers: headersFor(hop.knownVersion),
      redirect: 'manual',
      credentials: 'omit',
      signal,
    });
  } catch {
    return undefined;
  }
}

/** The next chunk of a body, or nothing when the body breaks off or its read is stopped. */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  try {
    return await reader.read();
  } catch {
    return undefined;
  }
}

/** Lets go of a body that is not read, or not to its end, even one that has broken off already. */
async function discard(body: ReadableStream | ReadableStreamDefaultReader | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // A body that broke off holds nothing more to let go of.
  }
}

/** One read of a feed, which ends at its context's deadline or abort, and what it cost. */
class FeedCall {
  readonly #signal: AbortSignal;
  #httpRequests = 0;
  #bytesReceived = 0;

  constructor({ deadline, signal }: CallContext) {
    const timeLeft = AbortSignal.timeout(Math.max(0, deadline - now()));
    this.#signal = AbortSignal.any([signal, timeLeft]);
  }

  /**
   * Sends `hop`, then follows its redirects, each a request of its own. The new address
   * is the target of the last permanent redirect of an unbroken run of them from the
   * stored address; a temporary redirect is followed and changes nothing (CL-COL-19).
   */
  async #request(hop: Hop): Promise<Step<Answered>> {
    if (this.#signal.aborted) {
      return fail(UNREACHABLE);
    }
    this.#httpRequests += 1;
    const response = await send(hop, this.#signal);
    if (response === undefined) {
      return fail(UNREACHABLE);
    }
    if (!REDIRECTS.has(response.status)) {
      return succeed({ response, address: hop.address, movedTo: hop.movedTo });
    }
    await discard(response.body);
    const next = webAddress(response.headers.get('location'), hop.address);
    if (next === null || hop.hopsLeft === 0) {
      return fail({ kind: 'http_error', status: response.status });
    }
    const isMoving = hop.isMoving && PERMANENT_REDIRECTS.has(response.status);
    const movedTo = isMoving ? next : hop.movedTo;
    return this.#request({ ...hop, address: next, hopsLeft: hop.hopsLeft - 1, isMoving, movedTo });
  }

  /** What a final answer gives: not modified for the version sent, the feed it holds, or the failure of its status. */
  async #readAnswer(answered: Answered, knownVersion: string | null): Promise<Step<FeedRead>> {
    const { response, address, movedTo } = answered;
    // A 304 has no body to discard: its status is a null body status.
    if (knownVersion !== null && response.status === NOT_MODIFIED) {
      return succeed({ kind: 'not_modified', movedTo });
    }
    if (!response.ok) {
      await discard(response.body);
      return fail(statusError(response.status));
    }
    const bytes = await this.#bodyOf(response);
    if (!bytes.ok) {
      return bytes;
    }
    const document = feedIn(bytes.value, response.headers.get('content-type'), address);
    const version = response.headers.get('etag') ?? response.headers.get('last-modified');
    return document.ok
      ? succeed({ kind: 'read', version, feed: document.feed, movedTo })
      : fail(document.error);
  }

  /** The bytes of a body, counted as they come: unreadable past the bound, unreachable when it breaks off. */
  async #bodyOf({ body }: Response): Promise<Step<Uint8Array>> {
    if (body === null) {
      return succeed(new Uint8Array());
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let chunk = await readChunk(reader);
    while (chunk?.done === false) {
      this.#bytesReceived += chunk.value.byteLength;
      if (this.#bytesReceived > MAX_FEED_BYTES) {
        await discard(reader);
        return fail(UNREADABLE);
      }
      chunks.push(chunk.value);
      chunk = await readChunk(reader);
    }
    return chunk === undefined ? fail(UNREACHABLE) : succeed(Buffer.concat(chunks));
  }

  /** What the read has cost so far: its requests, each redirect included, and the bytes received. */
  get metadata(): CallMetadata {
    return { httpRequests: this.#httpRequests, bytesReceived: this.#bytesReceived };
  }

  /** Reads the feed at `address`, conditional on `knownVersion` (COL-41, CL-COL-19). */
  async read(address: string, knownVersion: string | null): Promise<Step<FeedRead>> {
    const hop = { address, knownVersion, hopsLeft: MAX_REDIRECTS, isMoving: true, movedTo: null };
    const answered = await this.#request(hop);
    return answered.ok ? this.#readAnswer(answered.value, knownVersion) : answered;
  }
}

/**
 * The press feeds read over the web (module map §5): `readFeed` reads an RSS or Atom
 * feed anonymously and conditionally, maps its server's answers to the port's errors
 * and names a permanent new address (COL-02, COL-26, COL-41, CL-COL-19, TRV-17, TRV-66).
 */
export function createSyndicationPressFeeds(): PressFeeds {
  return {
    readFeed: async (ctx, { url, knownVersion }): Promise<PressFeedsOutcome<FeedRead>> => {
      const address = webAddress(url);
      // A stopped call fails as unreachable before its first request, as FeedCall checks.
      if (address === null || now() >= ctx.deadline) {
        return { ok: false, error: UNREACHABLE, call: NO_CALL };
      }
      const call = new FeedCall(ctx);
      const step = await call.read(address, knownVersion);
      return step.ok
        ? { ok: true, value: step.value, call: call.metadata }
        : { ok: false, error: step.error, call: call.metadata };
    },
  };
}
