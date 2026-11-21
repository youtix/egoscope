import { describe, expect, it, vi } from 'vitest';

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
    'answers "not configured" for the real adapter, which does not exist yet, %s',
    async (_case, variables) => {
      const { statsSource } = await serverWith(variables);

      expect(statsSource()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
    },
  );
});
