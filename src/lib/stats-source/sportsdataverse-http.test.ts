import { createServer } from 'node:http';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, onTestFinished } from 'vitest';

import { now, parseTimestamp } from '@/lib/time';

import { context, open } from './contract-support';
import { createSportsDataverseSource } from './sportsdataverse';
import { startReplay } from './sportsdataverse-replay';

import type { StatsSource } from './port';
import type { Replay, ReplayFault } from './sportsdataverse-replay';
import type { EpochMs } from '@/lib/time';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SEASON = '2024-25';
const SCHEDULE = 'espn_nba_schedules/nba_schedule_2025.csv';
const BOX_SCORES = 'espn_nba_player_boxscores/player_box_2025.csv';
const PROBE = 'espn_nba_player_boxscores/timestamp.json';
const PLAYER = '9000121';
const GAMES = { season: SEASON, knownVersion: null };
const NO_FILE = { httpRequests: 1, bytesReceived: 0, fileRequests: 0 };
// The size of the largest box-score file of the release, 2024-25's (evaluation, section 6).
const LARGEST_FILE_BYTES = 17_900_000;
const CHUNK_BYTES = 65_536;
const MEMORY_BOUND_BYTES = 8_000_000;
const SAMPLE_EVERY_MS = 5;

/** The instant that `text` writes with its offset. */
function instant(text: string): EpochMs {
  const parsed = parseTimestamp(text);
  if (!parsed.ok || parsed.timestamp.kind !== 'instant') {
    throw new Error(`Not an instant: ${text}`);
  }
  return parsed.timestamp.at;
}

/** The adapter on a local replay of the recorded release, closed when the test ends. */
async function recorded(): Promise<Readonly<{ source: StatsSource; replay: Replay }>> {
  const replay = await startReplay();
  onTestFinished(async () => replay.close());
  return { source: createSportsDataverseSource(replay.baseUrl), replay };
}

/** A local server answering with `handler`, closed when the test ends; its address. */
async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  return `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
}

/** The recorded line of a player in the 2024-25 box-score file, and the file's header. */
function recordedLine(replay: Replay): Readonly<{ header: string; line: string }> {
  const [header = '', ...lines] = replay.text(BOX_SCORES).split('\n');
  return { header, line: lines.find((line) => line.includes(`,${PLAYER},`)) ?? '' };
}

describe('[TRV-15] the requests of the SportsDataverse adapter', () => {
  it('[TRV-15] [TRV-66] reads only the documented addresses of the release, under a generic user agent', async () => {
    const { source, replay } = await recorded();
    await source.checkHealth(open());
    await source.getPublication(open(), { knownVersion: null });
    await source.getSeasonGames(open(), GAMES);
    await source.getSeasonPlayers(open(), GAMES);
    await source.getPlayerRecords(open(), { ...GAMES, season: '2026-27', players: ['9000121'] });
    await source.mapPlayers?.(open(), { otherSource: 'nba_stats', season: SEASON });
    const documented = replay.requests
      .map(({ path }) => path)
      .filter((path) => path.startsWith('/download/'));
    expect(documented).toStrictEqual([
      `/download/${PROBE}`,
      `/download/${PROBE}`,
      `/download/${SCHEDULE}`,
      `/download/${BOX_SCORES}`,
      '/download/espn_nba_player_core/player_core_2027.csv',
      '/download/nba_crosswalk/nba_player_crosswalk_2025.csv',
    ]);
    expect(new Set(replay.requests.map(({ userAgent }) => userAgent))).toStrictEqual(
      new Set(['Mozilla/5.0 (compatible; StatsFetch/1.0)']),
    );
  });

  it('[STA-42] [TRV-03] sends the stored version, and counts every request, byte and file of each call', async () => {
    const { source, replay } = await recorded();
    const first = await source.getSeasonGames(open(), GAMES);
    const version = first.ok && first.value.kind === 'read' ? first.value.version : null;
    expect(first.call).toStrictEqual({
      httpRequests: 2,
      bytesReceived: Buffer.byteLength(replay.text(SCHEDULE)),
      fileRequests: 1,
    });
    await expect(
      source.getSeasonGames(open(), { ...GAMES, knownVersion: version }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { kind: 'not_modified' },
      call: { httpRequests: 2, bytesReceived: 0, fileRequests: 1 },
    });
    expect(replay.requests.map(({ ifNoneMatch }) => ifNoneMatch)).toStrictEqual([
      null,
      null,
      version,
      version,
    ]);
    await expect(
      source.getSeasonGames(open(), { ...GAMES, season: '2022-23' }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'not_published' }, call: NO_FILE });
  });

  it('[TRV-47] checks its health with one request to the probe file, without following a redirect', async () => {
    const { source, replay } = await recorded();
    await expect(source.checkHealth(open())).resolves.toStrictEqual({
      ok: true,
      value: null,
      call: NO_FILE,
    });
    replay.inject(PROBE, { kind: 'outage' });
    await expect(source.checkHealth(open())).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unavailable' },
      call: NO_FILE,
    });
    const direct = await serve((_, response) => {
      response.writeHead(200, { etag: '"probe"' }).end('{}');
    });
    await expect(createSportsDataverseSource(direct).checkHealth(open())).resolves.toMatchObject({
      ok: true,
      call: { httpRequests: 1, fileRequests: 1 },
    });
  });

  it('[CL-TRV-23] reads the refresh instant from Last-Modified, else from the New York time of the probe file', async () => {
    const { source, replay } = await recorded();
    const refreshedAt = async () => {
      const outcome = await source.getPublication(open(), { knownVersion: null });
      return outcome.ok && outcome.value.kind === 'read' ? outcome.value.data.refreshedAt : outcome;
    };
    await expect(refreshedAt()).resolves.toBe(instant('2026-11-22T12:34:02Z'));
    replay.omitLastModified();
    await expect(refreshedAt()).resolves.toBe(instant('2026-11-22T12:33:59Z'));
    replay.publish(PROBE, '{"last_updated":"2026-07-01 08:00:00 EDT"}\n');
    await expect(refreshedAt()).resolves.toBe(instant('2026-07-01T12:00:00Z'));
    replay.publish(PROBE, '{"last_updated":"soon"}\n');
    await expect(refreshedAt()).resolves.toMatchObject({ error: { kind: 'schema_changed' } });
  });

  it.each<Readonly<{ name: string; fault: ReplayFault; error: object }>>([
    {
      name: '429 with a delay in seconds',
      fault: { kind: 'quota', status: 429, headers: { 'retry-after': '120' } },
      error: { kind: 'rate_limited', retryAfterMs: 120_000 },
    },
    {
      name: '429 with a delay as a date',
      fault: {
        kind: 'quota',
        status: 429,
        headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      },
      error: { kind: 'rate_limited', retryAfterMs: null },
    },
    {
      name: '403 with a rate-limit header',
      fault: { kind: 'quota', status: 403, headers: { 'x-ratelimit-remaining': '0' } },
      error: { kind: 'rate_limited', retryAfterMs: null },
    },
    {
      name: '403 without one',
      fault: { kind: 'quota', status: 403, headers: {} },
      error: { kind: 'unavailable' },
    },
    {
      name: '401, which no key could answer',
      fault: { kind: 'quota', status: 401, headers: {} },
      error: { kind: 'unavailable' },
    },
    { name: 'a server error', fault: { kind: 'outage' }, error: { kind: 'unavailable' } },
  ])(
    '[STA-39] [CL-STA-15] answers $name as the port says, never unauthorized',
    async ({ fault, error }) => {
      const { source, replay } = await recorded();
      replay.inject(SCHEDULE, fault);
      await expect(source.getSeasonGames(open(), GAMES)).resolves.toStrictEqual({
        ok: false,
        error,
        call: NO_FILE,
      });
    },
  );

  it('[CL-STA-15] follows at most three redirects, and fails an endless or a broken one as an outage', async () => {
    const base = await serve((request, response) => {
      const address = request.url ?? '';
      const target = address.includes('nba_schedule_2026') ? 'loop' : 'nowhere';
      response.writeHead(307, address.includes('2025') ? {} : { location: target }).end();
    });
    const source = createSportsDataverseSource(`${base}/releases`);
    await expect(
      source.getSeasonGames(open(), { ...GAMES, season: '2025-26' }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unavailable' },
      call: { httpRequests: 4, bytesReceived: 0, fileRequests: 0 },
    });
    await expect(source.getSeasonGames(open(), GAMES)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unavailable' },
      call: NO_FILE,
    });
  });

  it('[STA-42] refuses a file answered without its version as an outage', async () => {
    const { source, replay } = await recorded();
    replay.inject(SCHEDULE, { kind: 'no_version' });
    await expect(source.getSeasonGames(open(), GAMES)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unavailable' },
      call: { httpRequests: 2, bytesReceived: 0, fileRequests: 0 },
    });
  });

  it('[CL-STA-15] answers aborted when its signal aborts during a read, and unavailable when its deadline passes', async () => {
    const { source, replay } = await recorded();
    const { header } = recordedLine(replay);
    const started = Promise.withResolvers<undefined>();
    const ended = Promise.withResolvers<undefined>();
    onTestFinished(() => {
      ended.resolve(undefined);
    });
    replay.publish(BOX_SCORES, async function* stalled() {
      yield Buffer.from(`${header}\n`);
      started.resolve(undefined);
      await ended.promise;
    });
    const controller = new AbortController();
    const aborted = source.getSeasonPlayers(context(controller.signal), GAMES);
    await started.promise;
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ ok: false, error: { kind: 'aborted' } });
    const ctx = context(new AbortController().signal, 50);
    const late = await source.getSeasonPlayers(ctx, GAMES);
    expect(late).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(now()).toBeGreaterThanOrEqual(ctx.deadline - 1);
  });

  it('[STA-02] stops reading a file at its first unreadable row, and answers schema_changed', async () => {
    const { source, replay } = await recorded();
    const { header, line } = recordedLine(replay);
    const rest = Buffer.from(`${line}\n`.repeat(Math.ceil(LARGEST_FILE_BYTES / line.length)));
    replay.publish(BOX_SCORES, `${header}\n${line}\nnot,a,row\n${rest.toString('utf8')}`);
    const outcome = await source.getSeasonPlayers(open(), GAMES);
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'schema_changed' } });
    expect(outcome.call.bytesReceived).toBeLessThan(rest.length);
  });

  it('[TRV-15] streams a box-score file the size of the largest one in bounded memory', async () => {
    setFlagsFromString('--expose-gc');
    const collect: unknown = runInNewContext('gc');
    const measure = (): number => {
      if (typeof collect === 'function') {
        Reflect.apply(collect, undefined, []);
      }
      const { heapUsed, arrayBuffers } = process.memoryUsage();
      return heapUsed + arrayBuffers;
    };
    const { source, replay } = await recorded();
    const { header, line } = recordedLine(replay);
    // Rows of another season, which the read skips, then the one row it keeps.
    const otherSeason = line.replaceAll('2025-03-08', '2019-03-08');
    const chunk = Buffer.from(
      `${otherSeason}\n`.repeat(Math.ceil(CHUNK_BYTES / otherSeason.length)),
    );
    const chunks = Math.ceil(LARGEST_FILE_BYTES / chunk.length);
    replay.publish(BOX_SCORES, function* generated() {
      yield Buffer.from(`${header}\n`);
      for (let sent = 0; sent < chunks; sent += 1) {
        yield chunk;
      }
      yield Buffer.from(`${line}\n`);
    });
    const baseline = measure();
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, measure());
    }, SAMPLE_EVERY_MS);
    const outcome = await source.getSeasonBoxScores(open(), { ...GAMES, players: ['9000121'] });
    clearInterval(sampler);
    expect(outcome).toMatchObject({ ok: true, value: { data: [{ player: '9000121' }] } });
    expect(outcome.call.bytesReceived).toBeGreaterThan(LARGEST_FILE_BYTES);
    expect(peak - baseline).toBeLessThan(MEMORY_BOUND_BYTES);
  });
});
