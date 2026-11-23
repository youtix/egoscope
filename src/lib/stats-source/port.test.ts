import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { open } from './contract-support';
import { startReplay } from './sportsdataverse-replay';

/** The accessor of a server whose configuration holds `variables`, loaded afresh. */
async function serverWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./port');
}

describe('statsSource', () => {
  it('serves the fake that the whole process shares when EGOSCOPE_FAKES names the stats source', async () => {
    const { statsSource, fakeStatsSource } = await serverWith({ EGOSCOPE_FAKES: 'stats-source' });
    const access = statsSource();

    expect(access).toStrictEqual({ ok: true, source: fakeStatsSource() });
    expect(statsSource()).toStrictEqual(access);
    expect(fakeStatsSource().firstCoveredSeason()).toBe('2024-25');
  });

  it('shares one fake across every copy of the module', async () => {
    const first = await serverWith({ EGOSCOPE_FAKES: 'all' });
    const second = await serverWith({ EGOSCOPE_FAKES: 'all' });

    expect(second).not.toBe(first);
    expect(second.fakeStatsSource()).toBe(first.fakeStatsSource());
  });

  it.each([
    ['by default', {}],
    ['when EGOSCOPE_FAKES names other ports only', { EGOSCOPE_FAKES: 'link-check,telegram' }],
  ])(
    '[TRV-15] [STA-02] serves the SportsDataverse adapter, from 1993-94, %s',
    async (_case, variables) => {
      const { statsSource } = await serverWith(variables);
      const access = statsSource();

      expect(access.ok ? access.source.firstCoveredSeason() : access.error).toBe('1993-94');
    },
  );

  it('[TRV-15] reads the release at STATS_SOURCE_BASE_URL when the configuration sets it', async () => {
    const replay = await startReplay();
    onTestFinished(async () => replay.close());
    const { statsSource } = await serverWith({ STATS_SOURCE_BASE_URL: replay.baseUrl });
    const access = statsSource();
    const health = access.ok ? await access.source.checkHealth(open()) : access;

    expect(health).toMatchObject({ ok: true, value: null });
    expect(replay.requests.map(({ path }) => path)).toStrictEqual([
      '/download/espn_nba_player_boxscores/timestamp.json',
    ]);
  });

  it('answers "not configured" while the configuration is invalid', async () => {
    const { statsSource } = await serverWith({ LOG_LEVEL: 'INFO' });

    expect(statsSource()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
  });
});
