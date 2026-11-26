import { describe, expect, it } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

import { PRESS_FEEDS_CONTRACT } from './contract';
import { createFakePressFeeds } from './fake';

import type { PressFeedsHarness } from './contract';
import type { FeedItem, FeedRead, PressFeeds, PressFeedsOutcome } from './types';

const MOVED = 'https://baseline.example.test/old/rss';
const NEW = 'https://baseline.example.test/rss';
const DEADLINE_MS = 5000;

function fakeHarness(): PressFeedsHarness {
  return {
    feeds: createFakePressFeeds(),
    feedUrl: 'https://courtside.example.test/feed.xml',
    movedUrl: MOVED,
    newUrl: NEW,
    pageUrl: 'https://courtside.example.test/',
    lockedUrl: 'https://premium.example.test/rss',
    unreachableUrl: 'https://nowhere.example.test/rss',
  };
}

// Pads the identifier, empties a missing title and drops the dates.
const spoiled = (item: FeedItem): FeedItem => ({
  ...item,
  identifier: ` ${item.identifier ?? ''} `,
  title: item.title ?? '',
  publishedAt: null,
  updatedAt: null,
});

/**
 * An adapter that breaks every case of the contract, to prove that each case finds
 * it: it ignores its call context and the version, reads the new address in place of
 * a moved one, spoils the items, and answers every failure as a server error.
 */
function brokenHarness(): PressFeedsHarness {
  const harness = fakeHarness();
  const { feeds } = harness;
  const anyContext = {
    deadline: toEpochMs(now() + DEADLINE_MS),
    signal: new AbortController().signal,
  };
  const broken: PressFeeds = {
    readFeed: async (_ctx, { url }): Promise<PressFeedsOutcome<FeedRead>> => {
      const outcome = await feeds.readFeed(anyContext, {
        url: url === MOVED ? NEW : url,
        knownVersion: null,
      });
      return outcome.ok && outcome.value.kind === 'read'
        ? {
            ok: true,
            value: {
              ...outcome.value,
              feed: {
                ...outcome.value.feed,
                items: outcome.value.feed.items.map((item) => spoiled(item)),
              },
            },
            call: { httpRequests: 2, bytesReceived: 1 },
          }
        : { ok: false, error: { kind: 'http_error', status: 500 }, call: outcome.call };
    },
  };
  return { ...harness, feeds: broken };
}

/** Answers a read as an unreachable feed, after one request. */
async function unreachable(): Promise<PressFeedsOutcome<FeedRead>> {
  await Promise.resolve();
  return {
    ok: false,
    error: { kind: 'unreachable' },
    call: { httpRequests: 1, bytesReceived: 0 },
  };
}

/** An adapter that answers every read as an unreachable feed. */
function failingHarness(): PressFeedsHarness {
  return { ...fakeHarness(), feeds: { readFeed: unreachable } };
}

describe('[COL-02] [COL-19] [COL-20] [COL-26] [COL-41] [CL-COL-01] [CL-COL-19] the fake against the press-feeds contract', () => {
  it.each(PRESS_FEEDS_CONTRACT)('$title', async ({ check }) => {
    await expect(check(fakeHarness())).resolves.toStrictEqual([]);
  });
});

describe('the press-feeds contract against adapters that break it', () => {
  it.each(PRESS_FEEDS_CONTRACT)(
    'finds the rule that a wrong adapter breaks: $title',
    async ({ check }) => {
      await expect(check(brokenHarness())).resolves.not.toHaveLength(0);
    },
  );

  it.each(PRESS_FEEDS_CONTRACT)(
    'finds the rule that a failing adapter breaks: $title',
    async ({ check }) => {
      await expect(check(failingHarness())).resolves.not.toHaveLength(0);
    },
  );
});
