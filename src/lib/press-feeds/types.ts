import type { PressFeedsError } from './errors';
import type { EpochMs, ParsedTimestamp } from '@/lib/time';

/** The deadline and abort signal of one call, inside the budget of its tick (module map §2.3). */
export type CallContext = Readonly<{ deadline: EpochMs; signal: AbortSignal }>;

/** What one read cost: its HTTP requests, each redirect included, and the bytes received. */
export type CallMetadata = Readonly<{ httpRequests: number; bytesReceived: number }>;

/**
 * A feed item as the feed gives it, each field null when the item lacks it or leaves it
 * empty, so that an item without a link or a title shows it (COL-17–COL-27):
 * its identifier (RSS `guid`, Atom `id`) trimmed (CL-COL-01); its publication and update
 * dates as written, with or without a time or a zone (COL-19, COL-20); the language it
 * declares (COL-17); the origin outlet an aggregator names (COL-06); its excerpt with the
 * feed's markup, which the collection strips and shortens (COL-27).
 */
export type FeedItem = Readonly<{
  identifier: string | null;
  link: string | null;
  title: string | null;
  publishedAt: ParsedTimestamp | null;
  updatedAt: ParsedTimestamp | null;
  language: string | null;
  originOutlet: string | null;
  excerpt: string | null;
}>;

/** A feed's content: the language it declares and its items, in the feed's order (COL-17, COL-46). */
export type Feed = Readonly<{ language: string | null; items: readonly FeedItem[] }>;

/**
 * What a read found: the feed with its version, null when its server gives none; or
 * `not_modified` for the version known. Either way, `movedTo` is the new address that
 * a permanent redirect announced and that the read followed (CL-COL-19).
 */
export type FeedRead =
  | Readonly<{ kind: 'read'; version: string | null; feed: Feed; movedTo: string | null }>
  | Readonly<{ kind: 'not_modified'; movedTo: string | null }>;

/** A read of the feed at `url`, conditional on the version that the last read gave. */
export type ReadFeedRequest = Readonly<{ url: string; knownVersion: string | null }>;

/** A read's answer, with what the call cost whether it succeeded or failed. */
export type PressFeedsOutcome<T> = Readonly<
  | { ok: true; value: T; call: CallMetadata }
  | { ok: false; error: PressFeedsError; call: CallMetadata }
>;

/**
 * The public news feeds (module map §5): `readFeed` reads one feed anonymously, without
 * an account, a subscription or a cookie, and never fetches an article's page (COL-02,
 * COL-26, DSN-02).
 */
export type PressFeeds = Readonly<{
  readFeed: (ctx: CallContext, request: ReadFeedRequest) => Promise<PressFeedsOutcome<FeedRead>>;
}>;
