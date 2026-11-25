import { beforeEach, describe, expect, it, vi } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

const DEADLINE_MS = 5000;
// Where the process keeps its one fake.
const SHARED_FAKE = Symbol.for('egoscope.telegram.fake');

/** The port of a server whose configuration holds `variables`: its modules load afresh. */
async function portWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./port');
}

describe('telegram', () => {
  beforeEach(() => {
    // Each test is a fresh process, which holds no fake yet.
    vi.stubGlobal(SHARED_FAKE, undefined);
  });

  it('[TEL-28] answers "not configured" while no real adapter serves', async () => {
    const { telegram } = await portWith({});

    expect(telegram()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
  });

  it('serves the one fake of the process when EGOSCOPE_FAKES names the port', async () => {
    const { fakeTelegram, telegram } = await portWith({ EGOSCOPE_FAKES: 'telegram' });
    fakeTelegram().failNext('getMe', [{ kind: 'unauthorized' }]);
    const access = telegram();
    const ctx = { deadline: toEpochMs(now() + DEADLINE_MS), signal: new AbortController().signal };

    expect(access).toStrictEqual({ ok: true, bot: fakeTelegram() });
    expect(access.ok && (await access.bot.getMe(ctx))).toMatchObject({
      ok: false,
      error: { kind: 'unauthorized' },
    });
  });

  it('gives one fake to every copy of the module', async () => {
    const first = await portWith({ EGOSCOPE_FAKES: 'all' });
    vi.resetModules();
    const second = await import('./port');

    expect(second).not.toBe(first);
    expect(second.fakeTelegram()).toBe(first.fakeTelegram());
  });
});
