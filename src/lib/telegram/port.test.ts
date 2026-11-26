import { beforeEach, describe, expect, it, vi } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

const DEADLINE_MS = 5000;
// A made-up bot token, which no scan rule takes for a real one (.gitleaks.toml).
const TOKEN = '515151:invented-port-token';
// A made-up webhook key of 43 characters, of one letter, as the configuration demands.
const WEBHOOK_SECRET = 'k'.repeat(43);
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

  it('answers "not configured" while the configuration holds no bot token', async () => {
    const { telegram } = await portWith({});

    expect(telegram()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
  });

  it('answers "not configured" while the configuration is invalid, a bot token included', async () => {
    const { telegram } = await portWith({ TELEGRAM_BOT_TOKEN: TOKEN, LOG_LEVEL: 'INFO' });

    expect(telegram()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
  });

  it('[TRV-18] [TRV-67] serves the Bot API adapter with the bot token and the webhook secret, calling out to its address alone', async () => {
    const answered = vi.fn<typeof fetch>(async () => {
      await Promise.resolve();
      return Response.json({ ok: true, result: { username: 'egoscope_port_bot' } });
    });
    vi.stubGlobal('fetch', answered);
    const { telegram } = await portWith({
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    const access = telegram();
    const ctx = { deadline: toEpochMs(now() + DEADLINE_MS), signal: new AbortController().signal };

    expect(access.ok && (await access.bot.getMe(ctx))).toStrictEqual({
      ok: true,
      value: { username: 'egoscope_port_bot' },
      call: { httpRequests: 1, messages: 0 },
    });
    expect(answered.mock.calls.map(([address]) => address)).toStrictEqual([
      `https://api.telegram.org/bot${TOKEN}/getMe`,
    ]);
    expect(
      [WEBHOOK_SECRET, 'j'.repeat(WEBHOOK_SECRET.length), null].map(
        (header) => access.ok && access.bot.verifyWebhookSecret(header),
      ),
    ).toStrictEqual([true, false, false]);
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
