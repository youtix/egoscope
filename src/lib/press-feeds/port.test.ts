import { beforeEach, describe, expect, it, vi } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

const COURTSIDE = 'https://courtside.example.test/feed.xml';
const DEADLINE_MS = 5000;
// Where the process keeps its one fake.
const SHARED_FAKE = Symbol.for('egoscope.press-feeds.fake');

/** The port of a server whose configuration holds `variables`: its modules load afresh. */
async function portWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./port');
}

describe('pressFeeds', () => {
  beforeEach(() => {
    // Each test is a fresh process, which holds no fake yet.
    vi.stubGlobal(SHARED_FAKE, undefined);
  });

  it('[TRV-17] serves the syndication adapter, which reads RSS and Atom feeds, without EGOSCOPE_FAKES', async () => {
    const { pressFeeds } = await portWith({});
    const access = pressFeeds();
    const aborted = new AbortController();
    aborted.abort();
    const ctx = { deadline: toEpochMs(now() + DEADLINE_MS), signal: aborted.signal };

    expect(access.ok).toBe(true);
    expect(access).not.toHaveProperty('feeds.publish');
    await expect(
      access.ok ? access.feeds.readFeed(ctx, { url: COURTSIDE, knownVersion: null }) : null,
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unreachable' },
      call: { httpRequests: 0, bytesReceived: 0 },
    });
  });

  it('answers "not configured" while the configuration is invalid', async () => {
    const { pressFeeds } = await portWith({ LOG_LEVEL: 'INFO' });

    expect(pressFeeds()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
  });

  it('serves the one fake of the process when EGOSCOPE_FAKES names the port', async () => {
    const { fakePressFeeds, pressFeeds } = await portWith({ EGOSCOPE_FAKES: 'press-feeds' });
    fakePressFeeds().failNext(COURTSIDE, [{ kind: 'unreadable' }]);
    const access = pressFeeds();
    const ctx = { deadline: toEpochMs(now() + DEADLINE_MS), signal: new AbortController().signal };

    expect(access).toStrictEqual({ ok: true, feeds: fakePressFeeds() });
    expect(
      access.ok && (await access.feeds.readFeed(ctx, { url: COURTSIDE, knownVersion: null })),
    ).toMatchObject({ ok: false, error: { kind: 'unreadable' } });
  });

  it('gives one fake to every copy of the module', async () => {
    const first = await portWith({ EGOSCOPE_FAKES: 'all' });
    vi.resetModules();
    const second = await import('./port');

    expect(second).not.toBe(first);
    expect(second.fakePressFeeds()).toBe(first.fakePressFeeds());
  });
});
