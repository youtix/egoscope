import { afterEach, describe, expect, it } from 'vitest';

import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { createFakeTelegram } from './fake';

import type { CallContext, TelegramOutcome } from './types';

const OWNER = { id: 7001, type: 'private' } as const;
const STRANGER = { id: 7002, type: 'private' } as const;
const GROUP = { id: -7003, type: 'group' } as const;
const CODE = 'b3duZXItbGluay1jb2RlLTEyMzQ1Njc4OTAtYWJjZGVm';
const AT = toEpochMs(1_795_217_400_000);
const HOUR_MS = 3_600_000;
const DEADLINE_MS = 5000;
const WEBHOOK = {
  url: 'https://egoscope.example.test/api/telegram/webhook',
  secretToken: 'secret',
};

const open = (): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal: new AbortController().signal,
});

const kindOf = (outcome: TelegramOutcome<unknown>): string =>
  outcome.ok ? 'ok' : outcome.error.kind;

// The clocks that a test installed, restored when it ends.
const restores: (() => void)[] = [];

describe('createFakeTelegram', () => {
  afterEach(() => {
    for (const restore of restores.splice(0).toReversed()) {
      restore();
    }
  });

  it('[TEL-29] [TEL-31] [DSN-31] keeps an inbox per chat and delivers the /start updates of a private chat, a group and a stranger', async () => {
    const fake = createFakeTelegram();
    fake.deliver(OWNER, `/start ${CODE}`);
    fake.deliver(GROUP, `/start@egoscope_fake_bot ${CODE}`);
    fake.deliver(STRANGER, 'Who are you?');
    const updates = await fake.getUpdates(open(), { offset: null });
    const sent = await fake.sendMessage(open(), { chat: OWNER.id, text: 'Linked' });

    expect(updates).toMatchObject({
      ok: true,
      value: [
        { kind: 'start', chat: OWNER, linkCode: CODE },
        { kind: 'start', chat: GROUP, linkCode: CODE },
        { kind: 'other', chat: STRANGER },
      ],
      call: { httpRequests: 1, messages: 0 },
    });
    expect(sent).toMatchObject({ ok: true, call: { httpRequests: 1, messages: 1 } });
    expect(fake.inbox(OWNER.id).map(({ text }) => text)).toStrictEqual(['Linked']);
    expect(fake.inbox(STRANGER.id)).toStrictEqual([]);
    expect(fake.inbox(1)).toStrictEqual([]);
  });

  it('[TEL-31] delivers an update twice, and ignores a body that is no update', async () => {
    const fake = createFakeTelegram();
    const body = fake.deliver(OWNER, 'Hello');
    const first = await fake.getUpdates(open(), { offset: null });
    const updateId = first.ok ? (first.value[0]?.updateId ?? 0) : 0;
    await fake.getUpdates(open(), { offset: updateId + 1 });
    fake.deliverAgain(body);
    fake.deliverAgain({ message: { text: 'no update_id' } });

    expect(await fake.getUpdates(open(), { offset: null })).toMatchObject({
      ok: true,
      value: [{ kind: 'other', updateId, chat: OWNER }],
    });
    expect(fake.parseUpdate(body)).toStrictEqual({
      ok: true,
      update: { kind: 'other', updateId, chat: OWNER },
    });
  });

  it('[TEL-38] [CL-TEL-09] deletes a message younger than 48 hours, refuses an older one and keeps it', async () => {
    const clock = fixedClock(AT);
    restores.push(installFakeClock(clock));
    const fake = createFakeTelegram();
    fake.deliver(OWNER, '/start');
    const first = await fake.sendMessage(open(), { chat: OWNER.id, text: 'First' });
    const second = await fake.sendMessage(open(), { chat: OWNER.id, text: 'Second' });
    const idOf = (outcome: typeof first): number => (outcome.ok ? outcome.value.messageId : 0);
    clock.advance(48 * HOUR_MS - 1);
    const young = await fake.deleteMessage(open(), { chat: OWNER.id, messageId: idOf(first) });
    clock.advance(1);
    const old = await fake.deleteMessage(open(), { chat: OWNER.id, messageId: idOf(second) });

    expect([young, old]).toStrictEqual([
      { ok: true, value: { kind: 'deleted' }, call: { httpRequests: 1, messages: 0 } },
      { ok: false, error: { kind: 'delete_refused' }, call: { httpRequests: 1, messages: 0 } },
    ]);
    expect(fake.inbox(OWNER.id)).toStrictEqual([
      { messageId: idOf(second), text: 'Second', sentAt: AT },
    ]);
  });

  it('[TEL-35] answers a slow-down with its retry delay and temporary failures as scripted, then sends', async () => {
    const fake = createFakeTelegram();
    fake.deliver(OWNER, '/start');
    fake.failNext('sendMessage', [
      { kind: 'rate_limited', retryAfterMs: 3000 },
      { kind: 'unreachable' },
    ]);
    fake.failNext('sendMessage', [{ kind: 'timeout' }]);
    const send = async () => fake.sendMessage(open(), { chat: OWNER.id, text: 'Retry' });
    const answers = [await send(), await send(), await send(), await send()];

    expect(answers.map((outcome) => (outcome.ok ? 'sent' : outcome.error))).toStrictEqual([
      { kind: 'rate_limited', retryAfterMs: 3000 },
      { kind: 'unreachable' },
      { kind: 'timeout' },
      'sent',
    ]);
  });

  it('[TEL-37] answers definitive failures: a blocked bot, a chat that never wrote, a deactivated bot and a refused token', async () => {
    const fake = createFakeTelegram();
    fake.deliver(OWNER, '/start');
    const blocked = fake.block(OWNER);
    fake.failNext('getMe', [{ kind: 'bot_deactivated' }, { kind: 'unauthorized' }]);
    const ctx = open();
    const answers = [
      kindOf(await fake.sendMessage(ctx, { chat: OWNER.id, text: 'Hello' })),
      kindOf(await fake.deleteMessage(ctx, { chat: OWNER.id, messageId: 1 })),
      kindOf(await fake.sendMessage(ctx, { chat: STRANGER.id, text: 'Hello' })),
      kindOf(await fake.deleteMessage(ctx, { chat: STRANGER.id, messageId: 1 })),
      kindOf(await fake.getMe(ctx)),
      kindOf(await fake.getMe(ctx)),
    ];

    expect(fake.parseUpdate(blocked)).toMatchObject({
      ok: true,
      update: { kind: 'other', chat: OWNER },
    });
    expect(answers).toStrictEqual([
      'blocked',
      'blocked',
      'chat_not_found',
      'chat_not_found',
      'bot_deactivated',
      'unauthorized',
    ]);
    expect(await fake.getMe(open())).toMatchObject({
      ok: true,
      value: { username: 'egoscope_fake_bot' },
    });
  });

  it('[TEL-37] [TEL-29] sends to a chat that blocked the bot again once its person writes to the bot to relink it', async () => {
    const fake = createFakeTelegram();
    fake.deliver(OWNER, '/start');
    fake.block(OWNER);
    const whileBlocked = await fake.sendMessage(open(), { chat: OWNER.id, text: 'Hello' });
    const relink = fake.deliver(OWNER, `/start ${CODE}`);
    const confirmed = await fake.sendMessage(open(), { chat: OWNER.id, text: 'Linked' });

    expect(kindOf(whileBlocked)).toBe('blocked');
    expect(fake.parseUpdate(relink)).toMatchObject({
      ok: true,
      update: { kind: 'start', chat: OWNER, linkCode: CODE },
    });
    expect(confirmed).toMatchObject({ ok: true, call: { httpRequests: 1, messages: 1 } });
    expect(fake.inbox(OWNER.id).map(({ text }) => text)).toStrictEqual(['Linked']);
  });

  it('[TEL-37] [DSN-31] keeps a group that removed the bot refused when someone writes there, since only a private chat can be linked', async () => {
    const fake = createFakeTelegram();
    fake.deliver(GROUP, '/start');
    fake.block(GROUP);
    fake.deliver(GROUP, `/start@egoscope_fake_bot ${CODE}`);
    const sent = await fake.sendMessage(open(), { chat: GROUP.id, text: 'Hello' });

    expect(kindOf(sent)).toBe('blocked');
    expect(fake.inbox(GROUP.id)).toStrictEqual([]);
  });

  it('[TEL-08] throws on a text that is empty once its tags are read, as Telegram refuses one, and sends nothing', async () => {
    const fake = createFakeTelegram();
    fake.deliver(OWNER, '/start');

    await expect(fake.sendMessage(open(), { chat: OWNER.id, text: '' })).rejects.toThrow(
      RangeError,
    );
    await expect(fake.sendMessage(open(), { chat: OWNER.id, text: '<i></i>' })).rejects.toThrow(
      'A Telegram message needs a text of at least one character.',
    );
    expect(fake.inbox(OWNER.id)).toStrictEqual([]);
  });

  it('[CL-TEL-14] counts the characters of a text once its tags and entities are read', async () => {
    const fake = createFakeTelegram();
    fake.deliver(OWNER, '/start');
    const answers = [
      await fake.sendMessage(open(), {
        chat: OWNER.id,
        text: `<a href="x">${'&amp;'.repeat(4096)}</a>`,
      }),
      await fake.sendMessage(open(), { chat: OWNER.id, text: `&#33;${'b'.repeat(4096)}` }),
    ];

    expect(answers.map(({ ok }) => ok)).toStrictEqual([true, false]);
  });

  it('[TEL-29] refuses a webhook as scripted, drops the pending updates at registration, reports a delivery error and keeps updates off polling while set', async () => {
    restores.push(installFakeClock(fixedClock(AT)));
    const fake = createFakeTelegram();
    fake.deliver(OWNER, 'Before');
    fake.refuseWebhooks('Bad Request: bad webhook: Failed to resolve host');
    const refused = await fake.setWebhook(open(), WEBHOOK);
    fake.refuseWebhooks(null);
    const registered = await fake.setWebhook(open(), WEBHOOK);
    fake.deliver(OWNER, 'During');
    fake.failWebhookDelivery('Connection refused');
    const info = await fake.getWebhookInfo(open());
    await fake.deleteWebhook(open());

    expect([refused, registered].map((outcome) => outcome.ok && outcome.value)).toStrictEqual([
      { kind: 'refused', description: 'Bad Request: bad webhook: Failed to resolve host' },
      { kind: 'registered' },
    ]);
    expect(info).toMatchObject({
      ok: true,
      value: { pendingUpdates: 0, lastError: { at: AT, message: 'Connection refused' } },
    });
    expect(await fake.getUpdates(open(), { offset: null })).toMatchObject({ ok: true, value: [] });
    expect(await fake.getWebhookInfo(open())).toMatchObject({
      ok: true,
      value: { url: null, maxConnections: null, allowedUpdates: [] },
    });
  });

  it('answers timeout without a request after the deadline of its call', async () => {
    const outcome = await createFakeTelegram().getMe({
      deadline: now(),
      signal: new AbortController().signal,
    });

    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'timeout' },
      call: { httpRequests: 0, messages: 0 },
    });
  });
});
