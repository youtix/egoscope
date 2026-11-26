import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

import { PRESS_FEEDS_CONTRACT } from './contract';
import { createSyndicationPressFeeds, FEED_USER_AGENT, MAX_FEED_BYTES } from './syndication';

import type { PressFeedsHarness } from './contract';
import type { CallContext, FeedRead, PressFeedsOutcome } from './types';

const FIXTURES = path.join(import.meta.dirname, '../../../data/fixtures/press-feeds');
const DEADLINE_MS = 10_000;
const COURTSIDE = 'https://courtside.example.test/feed.xml';
const COURTSIDE_TAG = '"courtside-7"';
const MOVED = 'https://baseline.example.test/old/atom.xml';
const BASELINE = 'https://baseline.example.test/atom.xml';
const PAGE = 'https://courtside.example.test/';
const LOCKED = 'https://premium.example.test/rss';
const NOWHERE = 'https://nowhere.example.test/rss';
const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8';
const RSS = '<rss version="2.0"><channel><item><title>Invented</title></item></channel></rss>';
const CHUNK_BYTES = 64 * 1024;

type Route = (request: Request) => Response | Promise<Response>;
type Outcome = PressFeedsOutcome<FeedRead>;

const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8');

/** Answers with `body`, or with 304 when the request is conditional on `etag`. */
const conditional =
  (body: string, etag: string): Route =>
  (request) =>
    request.headers.get('if-none-match') === etag
      ? new Response(null, { status: 304 })
      : new Response(body, { headers: { 'content-type': 'application/xml', etag } });

const answer =
  (status: number, body: string | null = null): Route =>
  () =>
    new Response(body, { status });

const redirect =
  (status: number, location: string | null, body: string | null = null): Route =>
  () =>
    new Response(body, { status, headers: location === null ? {} : { location } });

/** Serves `routes` in place of the network, where any other address gives no answer, and gives the requests made. */
function serve(routes: Readonly<Record<string, Route>>): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request);
    await Promise.resolve();
    const route = routes[request.url];
    if (route === undefined) {
      throw new TypeError('fetch failed');
    }
    return route(request);
  });
  return requests;
}

const context = (deadlineMs = DEADLINE_MS, signal = new AbortController().signal): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal,
});

async function read(url: string, knownVersion: string | null = null): Promise<Outcome> {
  return createSyndicationPressFeeds().readFeed(context(), { url, knownVersion });
}

const outcomeOf = (outcome: Outcome): unknown => (outcome.ok ? outcome.value : outcome.error);

/** An unreachable feed's outcome, after `httpRequests` requests and `bytesReceived` bytes. */
const unreachable = (httpRequests: number, bytesReceived = 0): Outcome => ({
  ok: false,
  error: { kind: 'unreachable' },
  call: { httpRequests, bytesReceived },
});

/** A body that breaks off before its first byte. */
const broken = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => {
      controller.error(new Error('The connection was reset.'));
    },
  });

/** A body that never ends, which records under `name` in `cancelled` that the read let go of it. */
const endlessBody = (cancelled: string[], name: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    pull: (controller) => {
      controller.enqueue(new Uint8Array(CHUNK_BYTES));
    },
    cancel: () => {
      cancelled.push(name);
    },
  });

/** An address of the redirects' world. */
const moveAt = (name: string): string => `https://moves.example.test/${name}`;

const courtsideFeed = conditional(fixture('courtside-rss.xml'), COURTSIDE_TAG);

const WORLD: Readonly<Record<string, Route>> = {
  [COURTSIDE]: courtsideFeed,
  // A relative address, which the redirect gives against the old one.
  [MOVED]: redirect(301, '/atom.xml', 'Moved'),
  [BASELINE]: conditional(fixture('baseline-atom.xml'), '"baseline-3"'),
  [PAGE]: () =>
    new Response(fixture('front-page.html'), { headers: { 'content-type': 'text/html' } }),
  [LOCKED]: () =>
    new Response('Sign in to read this feed.', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="members"' },
    }),
};

function harness(): PressFeedsHarness {
  serve(WORLD);
  return {
    feeds: createSyndicationPressFeeds(),
    feedUrl: COURTSIDE,
    movedUrl: MOVED,
    newUrl: BASELINE,
    pageUrl: PAGE,
    lockedUrl: LOCKED,
    unreachableUrl: NOWHERE,
  };
}

describe('[TRV-17] [COL-02] [COL-19] [COL-20] [COL-26] [COL-41] [CL-COL-01] [CL-COL-19] the syndication adapter against the press-feeds contract', () => {
  it.each(PRESS_FEEDS_CONTRACT)('$title', async ({ check }) => {
    await expect(check(harness())).resolves.toStrictEqual([]);
  });
});

describe('createSyndicationPressFeeds', () => {
  it('[COL-26] [TRV-66] requests the feed alone, anonymously, with the generic user agent', async () => {
    const requests = serve(WORLD);

    await expect(read(COURTSIDE)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'read', version: COURTSIDE_TAG, movedTo: null },
      call: { httpRequests: 1, bytesReceived: Buffer.byteLength(fixture('courtside-rss.xml')) },
    });
    expect(FEED_USER_AGENT).toBe('Mozilla/5.0 (compatible; FeedFetch/1.0)');
    expect(
      requests.map((request) => ({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        credentials: request.credentials,
        redirect: request.redirect,
      })),
    ).toStrictEqual([
      {
        method: 'GET',
        url: COURTSIDE,
        headers: { accept: ACCEPT, 'user-agent': FEED_USER_AGENT },
        credentials: 'omit',
        redirect: 'manual',
      },
    ]);
  });

  it('[COL-41] reads conditionally on the stored entity tag, else on the stored date', async () => {
    const dated = 'https://dated.example.test/rss';
    const plain = 'https://plain.example.test/rss';
    const modified = 'Fri, 20 Nov 2026 23:00:00 GMT';
    const requests = serve({
      [COURTSIDE]: courtsideFeed,
      [dated]: (request) =>
        request.headers.get('if-modified-since') === modified
          ? new Response(null, { status: 304 })
          : new Response(RSS, { headers: { 'last-modified': modified } }),
      [plain]: () => new Response(RSS),
    });
    const notModified = {
      ok: true,
      value: { kind: 'not_modified', movedTo: null },
      call: { httpRequests: 1, bytesReceived: 0 },
    };

    const outcomes = [
      await read(dated),
      await read(plain),
      await read(dated, modified),
      await read(COURTSIDE, COURTSIDE_TAG),
      await read(COURTSIDE, 'W/"older"'),
    ];

    expect(outcomes.map((outcome) => outcomeOf(outcome))).toMatchObject([
      { kind: 'read', version: modified },
      { kind: 'read', version: null },
      { kind: 'not_modified' },
      { kind: 'not_modified' },
      { kind: 'read', version: COURTSIDE_TAG },
    ]);
    expect(outcomes.slice(2, 4)).toStrictEqual([notModified, notModified]);
    expect(
      requests.map(({ headers }) => [
        headers.get('if-modified-since'),
        headers.get('if-none-match'),
      ]),
    ).toStrictEqual([
      [null, null],
      [null, null],
      [modified, null],
      [null, COURTSIDE_TAG],
      [null, 'W/"older"'],
    ]);
  });

  it('[COL-02] [COL-41] [TRV-17] answers a login or a subscription as requires_identification, another error status as http_error', async () => {
    const statuses = [401, 402, 403, 404, 500, 304];
    serve(
      Object.fromEntries(
        statuses.map((status, index) => [
          `https://status.example.test/${String(status)}`,
          answer(status, index % 2 === 0 ? 'Refused' : null),
        ]),
      ),
    );
    const outcomes = await Promise.all(
      statuses.map(async (status) => read(`https://status.example.test/${String(status)}`)),
    );

    expect(outcomes.map((outcome) => outcomeOf(outcome))).toStrictEqual([
      { kind: 'requires_identification' },
      { kind: 'requires_identification' },
      { kind: 'http_error', status: 403 },
      { kind: 'http_error', status: 404 },
      { kind: 'http_error', status: 500 },
      { kind: 'http_error', status: 304 },
    ]);
  });

  it('[TRV-17] [COL-41] answers an empty answer as not a feed', async () => {
    serve({ [COURTSIDE]: () => new Response(null) });

    await expect(read(COURTSIDE)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not_a_feed' },
      call: { httpRequests: 1, bytesReceived: 0 },
    });
  });

  it('[COL-41] answers unreachable for no web address, a passed deadline, a stopped call or a body that breaks off', async () => {
    const hanging = 'https://hanging.example.test/rss';
    const cut = 'https://cut.example.test/rss';
    const stopping = 'https://stopping.example.test/rss';
    const stopper = new AbortController();
    let pulls = 0;
    serve({
      [hanging]: async (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(new DOMException('The read was stopped.', 'AbortError'));
          });
        }),
      [cut]: () =>
        new Response(
          new ReadableStream({
            pull: (controller) => {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(new TextEncoder().encode('<rss>'));
              } else {
                controller.error(new Error('The connection was reset.'));
              }
            },
          }),
        ),
      [stopping]: () => {
        stopper.abort();
        return new Response(null, { status: 302, headers: { location: COURTSIDE } });
      },
    });
    const feeds = createSyndicationPressFeeds();
    const knownVersion = null;
    // A call stopped before it starts.
    const stopped = AbortSignal.abort();
    const outcomes = await Promise.all([
      feeds.readFeed(context(), { url: 'file:///etc/hosts', knownVersion }),
      feeds.readFeed(context(-1), { url: COURTSIDE, knownVersion }),
      feeds.readFeed(context(20), { url: hanging, knownVersion }),
      feeds.readFeed(context(), { url: cut, knownVersion }),
      feeds.readFeed(context(DEADLINE_MS, stopper.signal), { url: stopping, knownVersion }),
      feeds.readFeed(context(DEADLINE_MS, stopped), { url: COURTSIDE, knownVersion }),
    ]);

    expect(outcomes).toStrictEqual([
      unreachable(0),
      unreachable(0),
      unreachable(1),
      unreachable(1, '<rss>'.length),
      unreachable(1),
      unreachable(0),
    ]);
  });

  it('[CL-COL-19] names the new address of an unbroken run of permanent redirects, never that of a temporary one', async () => {
    serve({
      [moveAt('a1')]: redirect(301, COURTSIDE),
      [moveAt('a2')]: redirect(308, COURTSIDE, 'Moved'),
      [moveAt('a3')]: redirect(302, COURTSIDE),
      [moveAt('a4')]: redirect(301, moveAt('b4')),
      [moveAt('b4')]: redirect(307, COURTSIDE),
      [moveAt('a5')]: redirect(303, moveAt('b5')),
      [moveAt('b5')]: redirect(301, COURTSIDE),
      [moveAt('a6')]: redirect(301, moveAt('b6')),
      [moveAt('b6')]: redirect(308, COURTSIDE),
      [COURTSIDE]: courtsideFeed,
    });
    const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const outcomes = await Promise.all(names.map(async (name) => read(moveAt(name))));

    expect(
      outcomes.map((outcome) => [
        outcome.ok ? outcome.value.movedTo : outcome.error,
        outcome.call.httpRequests,
      ]),
    ).toStrictEqual([
      [COURTSIDE, 2],
      [COURTSIDE, 2],
      [null, 2],
      [moveAt('b4'), 3],
      [null, 3],
      [COURTSIDE, 3],
    ]);
    await expect(read(moveAt('a1'), COURTSIDE_TAG)).resolves.toMatchObject({
      value: { kind: 'not_modified', movedTo: COURTSIDE },
    });
  });

  it('[CL-COL-19] [COL-41] fails a redirect with no web address to follow, or past the bound, with its status', async () => {
    const loop = 'https://loop.example.test/rss';
    serve({
      'https://moves.example.test/nowhere': redirect(302, null),
      'https://moves.example.test/ftp': redirect(301, 'ftp://files.example.test/feed'),
      [loop]: redirect(301, loop),
    });
    const outcomes = await Promise.all(
      ['https://moves.example.test/nowhere', 'https://moves.example.test/ftp', loop].map(
        async (url) => read(url),
      ),
    );

    expect(
      outcomes.map((outcome) => [outcomeOf(outcome), outcome.call.httpRequests]),
    ).toStrictEqual([
      [{ kind: 'http_error', status: 302 }, 1],
      [{ kind: 'http_error', status: 301 }, 1],
      [{ kind: 'http_error', status: 301 }, 6],
    ]);
  });

  it('[TRV-17] [COL-26] never requests an external entity or an external DTD that a feed names', async () => {
    const secret = 'https://attacker.example.test/secret';
    const entity = 'https://entity.example.test/rss';
    const dtd = 'https://dtd.example.test/rss';
    const requests = serve({
      [entity]: () =>
        new Response(
          `<!DOCTYPE rss [<!ENTITY secret SYSTEM "${secret}">]>${RSS.replace('Invented', '&secret;')}`,
        ),
      [dtd]: () => new Response(`<!DOCTYPE rss SYSTEM "${secret}">${RSS}`),
      [secret]: () => new Response('A secret.'),
    });

    await expect(read(entity)).resolves.toMatchObject({ ok: false, error: { kind: 'unreadable' } });
    await expect(read(dtd)).resolves.toMatchObject({
      ok: true,
      value: { feed: { items: [{ title: 'Invented' }] } },
    });
    expect(requests.map(({ url }) => url)).toStrictEqual([entity, dtd]);
  });

  it('[TRV-17] answers a body nested past the depth bound as unreadable within its deadline', async () => {
    const deep = 'https://deep.example.test/rss';
    const levels = 80_000;
    const body = `<rss version="2.0">${'<a>'.repeat(levels)}${'</a>'.repeat(levels)}</rss>`;
    serve({ [deep]: () => new Response(body) });
    const deadlineMs = 1000;
    const started = now();
    const outcome = await createSyndicationPressFeeds().readFeed(context(deadlineMs), {
      url: deep,
      knownVersion: null,
    });

    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'unreadable' },
      call: { httpRequests: 1, bytesReceived: body.length },
    });
    expect(now() - started).toBeLessThan(deadlineMs);
  });

  it('[COL-41] answers a redirect or an error status whose body breaks off by its status, never by a rejection', async () => {
    const moving = 'https://broken.example.test/moving';
    const failing = 'https://broken.example.test/failing';
    serve({
      [moving]: () => new Response(broken(), { status: 302, headers: { location: COURTSIDE } }),
      [failing]: () => new Response(broken(), { status: 500 }),
      [COURTSIDE]: courtsideFeed,
    });
    const outcomes = await Promise.all([read(moving), read(failing)]);

    expect(
      outcomes.map((outcome) => [
        outcome.ok ? outcome.value.kind : outcome.error,
        outcome.call.httpRequests,
      ]),
    ).toStrictEqual([
      ['read', 2],
      [{ kind: 'http_error', status: 500 }, 1],
    ]);
  });

  it('[TRV-17] stops reading a body past the byte bound and answers it as unreadable', async () => {
    const endless = 'https://endless.example.test/rss';
    serve({
      [endless]: () =>
        new Response(
          new ReadableStream({
            pull: (controller) => {
              controller.enqueue(new Uint8Array(CHUNK_BYTES));
            },
          }),
        ),
    });
    const outcome = await read(endless);

    expect(MAX_FEED_BYTES).toBe(4 * 1024 * 1024);
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'unreadable' } });
    expect(outcome.call.bytesReceived).toBeGreaterThan(MAX_FEED_BYTES);
    expect(outcome.call.bytesReceived).toBeLessThanOrEqual(MAX_FEED_BYTES + CHUNK_BYTES);
  });

  it('[TRV-17] lets go of the body of a redirect, of an error status and of an answer past the byte bound', async () => {
    const cancelled: string[] = [];
    const moving = 'https://unread.example.test/moving';
    const failing = 'https://unread.example.test/failing';
    const endless = 'https://unread.example.test/endless';
    serve({
      [moving]: () =>
        new Response(endlessBody(cancelled, 'redirect'), {
          status: 301,
          headers: { location: COURTSIDE },
        }),
      [failing]: () => new Response(endlessBody(cancelled, 'error status'), { status: 500 }),
      [endless]: () => new Response(endlessBody(cancelled, 'past the bound')),
      [COURTSIDE]: courtsideFeed,
    });
    // One read after the other, so that the bodies are let go of in this order.
    const outcomes = [await read(moving), await read(failing), await read(endless)];

    expect(
      outcomes.map((outcome) => (outcome.ok ? outcome.value.kind : outcome.error.kind)),
    ).toStrictEqual(['read', 'http_error', 'unreadable']);
    expect(cancelled).toStrictEqual(['redirect', 'error status', 'past the bound']);
  });
});
