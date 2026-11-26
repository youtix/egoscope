// The behavior every adapter of the press feeds shares (module map §2.3, §5): the
// port's own tests run each case against the fake, and against the recorded feeds of
// each real adapter, and expect it to find no problem. A case returns the problems it
// finds, each naming its offenders, so that a failure says what an adapter got wrong.
// Never re-exported by index.ts.
import { now, toEpochMs } from '@/lib/time';

import type { PressFeedsErrorKind } from './errors';
import type { CallContext, FeedItem, FeedRead, PressFeeds, PressFeedsOutcome } from './types';

/** An adapter under test, and the addresses at which its feeds answer. */
export type PressFeedsHarness = Readonly<{
  feeds: PressFeeds;
  /** A feed with a version, an item dated without a time and one dated with a time but no zone. */
  feedUrl: string;
  /** An address that a permanent redirect moved to `newUrl` (CL-COL-19). */
  movedUrl: string;
  newUrl: string;
  /** A web page that is not a feed, a feed behind a login, and a host that does not answer. */
  pageUrl: string;
  lockedUrl: string;
  unreachableUrl: string;
}>;

/** What a case finds wrong: one line per broken rule, naming its offenders. */
type Problems = readonly string[];

/** One behavior of the contract: its title, and the problems that an adapter shows against it. */
type ContractCase = Readonly<{
  title: string;
  check: (harness: PressFeedsHarness) => Promise<Problems>;
}>;

type Outcome = PressFeedsOutcome<FeedRead>;

// A deadline that no answer under test comes near.
const DEADLINE_MS = 10_000;
const TEXT_FIELDS = ['identifier', 'link', 'title', 'language', 'originOutlet', 'excerpt'] as const;
const KEPT_DATE_KINDS = ['date', 'no_offset'] as const;

const context = (signal: AbortSignal): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal,
});

const problem = (rule: string, offenders: readonly unknown[]): Problems =>
  offenders.length === 0 ? [] : [`${rule}: ${JSON.stringify(offenders)}`];

/** What a read answered: `read`, `not_modified`, or the kind of its error. */
const answerOf = (outcome: Outcome): string =>
  outcome.ok ? outcome.value.kind : outcome.error.kind;

const itemsOf = (outcome: Outcome): readonly FeedItem[] =>
  outcome.ok && outcome.value.kind === 'read' ? outcome.value.feed.items : [];

async function read(
  feeds: PressFeeds,
  url: string,
  knownVersion: string | null = null,
): Promise<Outcome> {
  return feeds.readFeed(context(new AbortController().signal), { url, knownVersion });
}

async function readsConditionally({ feeds, feedUrl }: PressFeedsHarness): Promise<Problems> {
  const first = await read(feeds, feedUrl);
  const version = first.ok && first.value.kind === 'read' ? first.value.version : null;
  const again = await read(feeds, feedUrl, version);
  return [
    ...problem(
      'feed not read in one request',
      [{ answer: answerOf(first), requests: first.call.httpRequests }].filter(
        ({ answer, requests }) => answer !== 'read' || requests !== 1,
      ),
    ),
    ...problem(
      'feed not answered not_modified for its version, in one request without bytes',
      [{ answer: answerOf(again), call: again.call }].filter(
        ({ answer, call }) =>
          answer !== 'not_modified' || call.httpRequests !== 1 || call.bytesReceived !== 0,
      ),
    ),
  ];
}

async function givesItemsAsGiven({ feeds, feedUrl }: PressFeedsHarness): Promise<Problems> {
  const items = itemsOf(await read(feeds, feedUrl));
  return [
    ...problem('feed items not read', items.length === 0 ? [feedUrl] : []),
    ...problem(
      'identifiers not trimmed',
      items.map(({ identifier }) => identifier).filter((id) => id !== null && id !== id.trim()),
    ),
    ...problem(
      'empty texts given instead of null',
      items.filter((item) => TEXT_FIELDS.some((field) => item[field] === '')),
    ),
  ];
}

async function keepsDatesAsGiven({ feeds, feedUrl }: PressFeedsHarness): Promise<Problems> {
  const kinds = new Set(
    itemsOf(await read(feeds, feedUrl)).flatMap(({ publishedAt, updatedAt }) => [
      publishedAt?.kind,
      updatedAt?.kind,
    ]),
  );
  return problem(
    'dates without a time, or without a zone, not kept as the feed gives them',
    KEPT_DATE_KINDS.filter((kind) => !kinds.has(kind)),
  );
}

async function followsMovedAddress(harness: PressFeedsHarness): Promise<Problems> {
  const { feeds, movedUrl, newUrl } = harness;
  const movedToOf: readonly (readonly [string, string | null])[] = [
    [movedUrl, newUrl],
    [newUrl, null],
  ];
  const reads = await Promise.all(
    movedToOf.map(async ([url, expected]) => ({ url, expected, outcome: await read(feeds, url) })),
  );
  return problem(
    'addresses not read with the new address that a permanent redirect named',
    reads
      .map(({ url, expected, outcome }) => ({
        url,
        expected,
        answer: answerOf(outcome),
        movedTo: outcome.ok ? outcome.value.movedTo : null,
      }))
      .filter(({ expected, answer, movedTo }) => answer !== 'read' || movedTo !== expected),
  );
}

async function answersFailures(harness: PressFeedsHarness): Promise<Problems> {
  const expected: readonly (readonly [string, PressFeedsErrorKind])[] = [
    [harness.pageUrl, 'not_a_feed'],
    [harness.lockedUrl, 'requires_identification'],
    [harness.unreachableUrl, 'unreachable'],
  ];
  const answers = await Promise.all(
    expected.map(async ([url, kind]) => ({
      url,
      kind,
      answer: answerOf(await read(harness.feeds, url)),
    })),
  );
  return problem(
    'failures not answered as the port says',
    answers.filter(({ kind, answer }) => answer !== kind),
  );
}

async function stopsOnceAborted({ feeds, feedUrl }: PressFeedsHarness): Promise<Problems> {
  const controller = new AbortController();
  controller.abort();
  const outcome = await feeds.readFeed(context(controller.signal), {
    url: feedUrl,
    knownVersion: null,
  });
  return problem(
    'reads whose signal aborted not answered unreachable without a request',
    [{ answer: answerOf(outcome), requests: outcome.call.httpRequests }].filter(
      ({ answer, requests }) => answer !== 'unreachable' || requests !== 0,
    ),
  );
}

/** The contract of the press-feeds port: each case finds no problem in a sound adapter. */
export const PRESS_FEEDS_CONTRACT: readonly ContractCase[] = [
  {
    title: 'reads a feed in one request, then answers not_modified for its version',
    check: readsConditionally,
  },
  {
    title: 'gives each identifier trimmed, and null for a text that an item lacks',
    check: givesItemsAsGiven,
  },
  {
    title: 'keeps a date without a time and a time without a zone as the feed gives them',
    check: keepsDatesAsGiven,
  },
  {
    title: 'follows a permanent redirect and names the new address',
    check: followsMovedAddress,
  },
  {
    title: 'answers a page, a feed behind a login and a host that does not answer as the port says',
    check: answersFailures,
  },
  {
    title: 'answers unreachable without a request once the signal has aborted',
    check: stopsOnceAborted,
  },
];
