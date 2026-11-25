import { describe, expect, it } from 'vitest';

import { now, toEpochMs, toIsoDate } from '@/lib/time';

import { createFakePressFeeds } from './fake';

import type { CallContext, FeedItem, FeedRead, PressFeeds, PressFeedsOutcome } from './types';

const COURTSIDE = 'https://courtside.example.test/feed.xml';
const LE_PANIER = 'https://lepanier.example.test/rss';
const HOOPS_WIRE = 'https://hoopswire.example.test/atom';
const OLD_BASELINE = 'https://baseline.example.test/old/rss';
const BASELINE = 'https://baseline.example.test/rss';
const QUIET_CORNER = 'https://quietcorner.example.test/rss';
const SHORT_FEED = 'https://shortfeed.example.test/rss';
const VRASK_ANKLE = 'https://courtside.example.test/2026/11/20/vrask-ankle';
const NOVEMBER_20 = toIsoDate('2026-11-20');
const NOVEMBER_19 = toIsoDate('2026-11-19');
const DEADLINE_MS = 5000;

const open = (): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal: new AbortController().signal,
});

type Outcome = PressFeedsOutcome<FeedRead>;

async function read(
  feeds: PressFeeds,
  url: string,
  knownVersion: string | null = null,
): Promise<Outcome> {
  return feeds.readFeed(open(), { url, knownVersion });
}

const itemsOf = (outcome: Outcome): readonly FeedItem[] =>
  outcome.ok && outcome.value.kind === 'read' ? outcome.value.feed.items : [];

const versionOf = (outcome: Outcome): string | null =>
  outcome.ok && outcome.value.kind === 'read' ? outcome.value.version : null;

/** What a read answered: the kind of its value, or its error. */
const answerOf = (outcome: Outcome): unknown => (outcome.ok ? outcome.value.kind : outcome.error);

describe('createFakePressFeeds', () => {
  it('[COL-19] [COL-20] [CL-COL-01] serves dates with a time and a zone, without a time, without a zone, and an update date alone, each identifier trimmed', async () => {
    const items = itemsOf(await read(createFakePressFeeds(), COURTSIDE));

    expect(
      items.slice(0, 4).map(({ identifier, publishedAt, updatedAt }) => ({
        identifier,
        publishedAt,
        updatedAt,
      })),
    ).toStrictEqual([
      {
        identifier: 'courtside-1042',
        publishedAt: {
          kind: 'instant',
          on: NOVEMBER_20,
          at: toEpochMs(1_795_217_400_000),
          offsetMinutes: -300,
        },
        updatedAt: null,
      },
      {
        identifier: 'courtside-1041',
        publishedAt: { kind: 'date', on: NOVEMBER_20 },
        updatedAt: null,
      },
      {
        identifier: 'courtside-1040',
        publishedAt: { kind: 'no_offset', on: NOVEMBER_20, time: '09:15:00' },
        updatedAt: null,
      },
      {
        identifier: 'courtside-1039',
        publishedAt: null,
        updatedAt: {
          kind: 'instant',
          on: NOVEMBER_19,
          at: toEpochMs(1_795_125_600_000),
          offsetMinutes: 0,
        },
      },
    ]);
  });

  it('[COL-17] [COL-18] [COL-24] serves items without a link or a title, one in another language than its feed, and a very old one', async () => {
    const outcome = await read(createFakePressFeeds(), COURTSIDE);
    const items = itemsOf(outcome);

    expect(outcome).toMatchObject({ ok: true, value: { feed: { language: 'en' } } });
    expect(
      items.slice(4).map(({ identifier, link, title, language }) => ({
        identifier,
        link: link !== null,
        title: title !== null,
        language,
      })),
    ).toStrictEqual([
      { identifier: 'courtside-1038', link: false, title: true, language: null },
      { identifier: 'courtside-1037', link: true, title: false, language: null },
      { identifier: 'courtside-1036', link: true, title: true, language: 'es' },
      { identifier: 'courtside-0904', link: true, title: true, language: null },
    ]);
    expect(items.at(-1)?.publishedAt).toMatchObject({ at: toEpochMs(1_790_856_000_000) });
    expect(items[0]?.excerpt).toBe(
      '<p>The forward <b>limped off</b> during the morning session.</p>',
    );
  });

  it('[COL-06] serves the same article in two feeds, a French one and an aggregator naming its origin outlets', async () => {
    const feeds = createFakePressFeeds();
    const french = await read(feeds, LE_PANIER);
    const aggregated = itemsOf(await read(feeds, HOOPS_WIRE));

    expect(french).toMatchObject({ ok: true, value: { feed: { language: 'fr' } } });
    expect(itemsOf(french)[0]?.link).toBe(VRASK_ANKLE);
    expect(aggregated.map(({ originOutlet }) => originOutlet)).toStrictEqual([
      'Courtside Daily',
      'Dunk Digest',
      null,
    ]);
  });

  it('[CL-COL-19] follows a moved address to its new one in two requests, and names it', async () => {
    const feeds = createFakePressFeeds();
    const moved = await read(feeds, OLD_BASELINE);
    feeds.move(BASELINE, QUIET_CORNER);

    expect(moved).toMatchObject({
      ok: true,
      value: { kind: 'read', movedTo: BASELINE },
      call: { httpRequests: 2 },
    });
    expect(await read(feeds, BASELINE, versionOf(moved))).toMatchObject({
      ok: true,
      value: { kind: 'read', movedTo: QUIET_CORNER },
    });
  });

  it('[COL-41] [COL-02] fails a feed as scripted, then serves it again, and refuses a page or a feed behind a login', async () => {
    const feeds = createFakePressFeeds();
    feeds.failNext(BASELINE, [{ kind: 'unreachable' }]);
    feeds.failNext(BASELINE, [{ kind: 'http_error', status: 503 }]);
    const answers = [
      answerOf(await read(feeds, BASELINE)),
      answerOf(await read(feeds, BASELINE)),
      answerOf(await read(feeds, BASELINE)),
      answerOf(await read(feeds, 'https://courtside.example.test/')),
    ];

    expect(answers).toStrictEqual([
      { kind: 'unreachable' },
      { kind: 'http_error', status: 503 },
      'read',
      { kind: 'not_a_feed' },
    ]);
    expect(await read(feeds, 'https://premium.example.test/rss')).toStrictEqual({
      ok: false,
      error: { kind: 'requires_identification' },
      call: { httpRequests: 1, bytesReceived: 0 },
    });
  });

  it('[COL-42] serves a silent feed: not_modified for the version of its last read, with no bytes', async () => {
    const feeds = createFakePressFeeds();
    const first = await read(feeds, QUIET_CORNER);

    expect(await read(feeds, QUIET_CORNER, versionOf(first))).toStrictEqual({
      ok: true,
      value: { kind: 'not_modified', movedTo: null },
      call: { httpRequests: 1, bytesReceived: 0 },
    });
  });

  it('[COL-46] drops the oldest items of a feed that keeps two when new ones are posted, leaving a gap', async () => {
    const feeds = createFakePressFeeds();
    const before = await read(feeds, SHORT_FEED);
    feeds.post(SHORT_FEED, { identifier: 'short-3', published: '2026-11-21T08:00:00Z' });
    feeds.post(SHORT_FEED, { identifier: 'short-4', published: '2026-11-21T09:00:00Z' });
    feeds.post('https://new.example.test/rss', { identifier: 'new-1' });
    const after = await read(feeds, SHORT_FEED, versionOf(before));

    expect(itemsOf(after).map(({ identifier }) => identifier)).toStrictEqual([
      'short-4',
      'short-3',
    ]);
    expect(itemsOf(await read(feeds, 'https://new.example.test/rss'))).toHaveLength(1);
  });

  it('serves a published feed under a new version, and answers unreachable for an address that nothing serves', async () => {
    const feeds = createFakePressFeeds();
    const before = await read(feeds, QUIET_CORNER);
    feeds.publish(QUIET_CORNER, { items: [{ title: 'A new title' }] });
    const after = await read(feeds, QUIET_CORNER, versionOf(before));

    expect(after).toMatchObject({ ok: true, value: { kind: 'read', feed: { language: null } } });
    expect(itemsOf(after).map(({ title }) => title)).toStrictEqual(['A new title']);
    expect(await read(feeds, 'https://nowhere.example.test/rss')).toMatchObject({
      ok: false,
      error: { kind: 'unreachable' },
    });
  });

  it('answers unreachable without a request after the deadline of its call', async () => {
    const outcome = await createFakePressFeeds().readFeed(
      { deadline: now(), signal: new AbortController().signal },
      { url: COURTSIDE, knownVersion: null },
    );

    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'unreachable' },
      call: { httpRequests: 0, bytesReceived: 0 },
    });
  });

  it('throws on a date that no feed writes, a bug of the test', () => {
    expect(() => {
      createFakePressFeeds().publish(COURTSIDE, { items: [{ published: 'yesterday' }] });
    }).toThrow(RangeError);
  });
});
