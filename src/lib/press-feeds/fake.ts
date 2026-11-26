// The public news feeds of tests, development and the hermetic end-to-end mode: the
// invented feeds of data/fixtures/press-feeds/world.json, served per address, and the
// controls that publish, post to, move or fail a feed (module map §5).
import { now, parseTimestamp } from '@/lib/time';
import world from '@data/fixtures/press-feeds/world.json';

import type { PressFeedsError } from './errors';
import type {
  CallContext,
  CallMetadata,
  Feed,
  FeedItem,
  FeedRead,
  PressFeeds,
  PressFeedsOutcome,
} from './types';
import type { ParsedTimestamp } from '@/lib/time';

/** An item as a test writes it: the feed's texts, its dates written as the feed writes them. */
export type FakeItem = Readonly<{
  identifier?: string;
  link?: string;
  title?: string;
  published?: string;
  updated?: string;
  language?: string;
  originOutlet?: string;
  excerpt?: string;
}>;

/** A feed as a test writes it; one that `keeps` a number of items drops the oldest beyond it. */
export type FakeFeed = Readonly<{ language?: string; keeps?: number; items: readonly FakeItem[] }>;

/** The fake press feeds and their controls. */
export type FakePressFeeds = PressFeeds &
  Readonly<{
    /** Serves `feed` at `url` under a new version, in place of what it served there. */
    publish: (url: string, feed: FakeFeed) => void;
    /**
     * Puts `item` at the top of the feed at `url`, under a new version; a feed that keeps
     * a number of items drops its oldest beyond it, so that posts between two reads can
     * leave a gap (COL-46).
     */
    post: (url: string, item: FakeItem) => void;
    /** Answers a read of `from` with a permanent redirect to `to` (CL-COL-19). */
    move: (from: string, to: string) => void;
    /** Makes the next reads of `url` fail with `errors`, one each, in order; the feed then comes back (COL-41). */
    failNext: (url: string, errors: readonly PressFeedsError[]) => void;
  }>;

type Served = Readonly<{ feed: Feed; keeps: number | null; version: string }>;

const NO_CALL: CallMetadata = { httpRequests: 0, bytesReceived: 0 };
const UNREACHABLE: PressFeedsError = { kind: 'unreachable' };
const WORLD_FEEDS: Readonly<Record<string, FakeFeed>> = world.feeds;
const WORLD_REFUSALS: readonly (readonly [string, PressFeedsError])[] = [
  ...world.pages.map((url) => [url, { kind: 'not_a_feed' }] as const),
  ...world.locked.map((url) => [url, { kind: 'requires_identification' }] as const),
];

/** A date read from the text a feed wrote, as an adapter reads it; a text that is no date is a bug of the test. */
function dateOf(text: string | undefined): ParsedTimestamp | null {
  if (text === undefined) {
    return null;
  }
  const parsed = parseTimestamp(text);
  if (!parsed.ok) {
    throw new RangeError(`Not a date that a feed writes: "${text}".`);
  }
  return parsed.timestamp;
}

const itemOf = (item: FakeItem): FeedItem => ({
  identifier: item.identifier?.trim() ?? null,
  link: item.link ?? null,
  title: item.title ?? null,
  publishedAt: dateOf(item.published),
  updatedAt: dateOf(item.updated),
  language: item.language ?? null,
  originOutlet: item.originOutlet ?? null,
  excerpt: item.excerpt ?? null,
});

/** Says whether the call may no longer run: its signal aborted, or its deadline passed. */
const isOver = ({ deadline, signal }: CallContext): boolean => signal.aborted || now() >= deadline;

const failed = (error: PressFeedsError, call: CallMetadata): PressFeedsOutcome<FeedRead> => ({
  ok: false,
  error,
  call,
});

class Fake implements FakePressFeeds {
  readonly #served = new Map<string, Served>();
  readonly #moves = new Map<string, string>(Object.entries(world.moves));
  readonly #refusals = new Map<string, PressFeedsError>(WORLD_REFUSALS);
  readonly #failures = new Map<string, PressFeedsError[]>();
  #revision = 0;

  readonly readFeed: PressFeeds['readFeed'] = async (ctx, { url, knownVersion }) => {
    await Promise.resolve();
    if (isOver(ctx)) {
      return failed(UNREACHABLE, NO_CALL);
    }
    const target = this.#moves.get(url) ?? url;
    const movedTo = target === url ? null : target;
    const call = { httpRequests: movedTo === null ? 1 : 2, bytesReceived: 0 };
    const served = this.#servedAt(url, target);
    if (!('feed' in served)) {
      return failed(served, call);
    }
    const { feed, version } = served;
    return knownVersion === version
      ? { ok: true, value: { kind: 'not_modified', movedTo }, call }
      : {
          ok: true,
          value: { kind: 'read', version, feed, movedTo },
          call: { ...call, bytesReceived: JSON.stringify(feed).length },
        };
  };

  readonly publish = (url: string, { language, keeps, items }: FakeFeed): void => {
    const feed = { language: language ?? null, items: items.map((item) => itemOf(item)) };
    this.#serve(url, feed, keeps ?? null);
  };

  readonly post = (url: string, item: FakeItem): void => {
    const served = this.#served.get(url);
    const keeps = served?.keeps ?? null;
    const items = [itemOf(item), ...(served?.feed.items ?? [])];
    const kept = keeps === null ? items : items.slice(0, keeps);
    this.#serve(url, { language: served?.feed.language ?? null, items: kept }, keeps);
  };

  readonly move = (from: string, to: string): void => {
    this.#moves.set(from, to);
  };

  readonly failNext = (url: string, errors: readonly PressFeedsError[]): void => {
    this.#failures.set(url, [...(this.#failures.get(url) ?? []), ...errors]);
  };

  constructor() {
    for (const [url, feed] of Object.entries(WORLD_FEEDS)) {
      this.publish(url, feed);
    }
  }

  /** What a read of `url`, which leads to `target`, finds: a scripted failure, a refusal, the feed, or no answer. */
  #servedAt(url: string, target: string): Served | PressFeedsError {
    return (
      this.#failures.get(url)?.shift() ??
      this.#refusals.get(target) ??
      this.#served.get(target) ??
      UNREACHABLE
    );
  }

  #serve(url: string, feed: Feed, keeps: number | null): void {
    this.#revision += 1;
    this.#served.set(url, { feed, keeps, version: `"${String(this.#revision)}"` });
  }
}

/**
 * Fresh fake press feeds serving the invented feeds (module map §5): dates with and
 * without a time or a zone, an update-only date, other languages, items without a link
 * or a title, an article in two feeds, an aggregator naming origin outlets, a moved
 * address, a silent feed, a feed that keeps two items, a page that is no feed and a feed
 * behind a login; an unknown address is unreachable (COL-02, COL-17–COL-24, COL-41, COL-46).
 */
export function createFakePressFeeds(): FakePressFeeds {
  return new Fake();
}
