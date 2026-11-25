import { describe, expect, it } from 'vitest';

import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { TELEGRAM_CONTRACT } from './contract';
import { createFakeTelegram } from './fake';

import type { TelegramHarness } from './contract';
import type { FakeTelegram } from './fake';
import type { CallContext, Telegram, TelegramOutcome } from './types';

const CHAT = { id: 501, type: 'private' } as const;
const DEADLINE_MS = 5000;
const FORTY_EIGHT_HOURS_MS = 48 * 3_600_000;
const ONE_REQUEST = { httpRequests: 1, messages: 0 };

const open = (): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal: new AbortController().signal,
});

/** Sends the harness's chat a message from 48 hours ago. */
async function sendOld(fake: FakeTelegram): Promise<number | null> {
  const sentAt = toEpochMs(now() - FORTY_EIGHT_HOURS_MS);
  const restore = installFakeClock(fixedClock(sentAt));
  const sent = await fake.sendMessage(open(), { chat: CHAT.id, text: 'An old message' });
  restore();
  return sent.ok ? sent.value.messageId : null;
}

/** The fake, whose chat wrote to the bot once, an update already confirmed. */
async function fakeHarness(): Promise<TelegramHarness & Readonly<{ bot: FakeTelegram }>> {
  const fake = createFakeTelegram();
  fake.deliver(CHAT, '/start');
  await fake.getUpdates(open(), { offset: Number.MAX_SAFE_INTEGER });
  return {
    bot: fake,
    chat: CHAT.id,
    unknownChat: CHAT.id + 1,
    write: async (text) => {
      await Promise.resolve();
      fake.deliver(CHAT, text);
    },
    sendOld: async () => sendOld(fake),
  };
}

/**
 * An adapter that breaks every case of the contract, to prove that each case finds
 * it: it ignores its call context, the chat and the offset, counts no message, cuts
 * long texts, deletes everything, names no bot, misreports the webhook and accepts
 * any secret.
 */
async function brokenHarness(): Promise<TelegramHarness> {
  const harness = await fakeHarness();
  const fake = harness.bot;
  const broken: Telegram = {
    checkHealth: async () => ({
      ...(await fake.checkHealth(open())),
      call: { httpRequests: 2, messages: 0 },
    }),
    getMe: async () => {
      await Promise.resolve();
      return { ok: true, value: { username: '' }, call: ONE_REQUEST };
    },
    sendMessage: async (_ctx, { text }) => ({
      ...(await fake.sendMessage(open(), { chat: CHAT.id, text: text.slice(0, 10) })),
      call: ONE_REQUEST,
    }),
    deleteMessage: async () => {
      await Promise.resolve();
      return { ok: true, value: { kind: 'deleted' }, call: ONE_REQUEST };
    },
    setWebhook: async (_ctx, request) => fake.setWebhook(open(), request),
    getWebhookInfo: async (): Promise<TelegramOutcome<never>> => {
      await Promise.resolve();
      return { ok: false, error: { kind: 'unreachable' }, call: ONE_REQUEST };
    },
    deleteWebhook: async () => fake.deleteWebhook(open()),
    getUpdates: async () => {
      await fake.deleteWebhook(open());
      return fake.getUpdates(open(), { offset: null });
    },
    parseUpdate: () => ({ ok: true, update: { kind: 'other', updateId: 0, chat: null } }),
    verifyWebhookSecret: () => true,
  };
  return { ...harness, bot: broken };
}

/** An adapter that answers every call as an unreachable Telegram, after one request. */
async function failingHarness(): Promise<TelegramHarness> {
  const unreachable = async (): Promise<TelegramOutcome<never>> => {
    await Promise.resolve();
    return { ok: false, error: { kind: 'unreachable' }, call: ONE_REQUEST };
  };
  const harness = await fakeHarness();
  return {
    ...harness,
    bot: {
      checkHealth: unreachable,
      getMe: unreachable,
      sendMessage: unreachable,
      deleteMessage: unreachable,
      setWebhook: unreachable,
      getWebhookInfo: unreachable,
      deleteWebhook: unreachable,
      getUpdates: unreachable,
      parseUpdate: () => ({ ok: false, error: { kind: 'not_an_update' } }),
      verifyWebhookSecret: () => false,
    },
  };
}

describe('[TEL-29] [TEL-31] [TEL-38] [CL-TEL-09] [CL-TEL-14] [DSN-31] the fake against the Telegram contract', () => {
  it.each(TELEGRAM_CONTRACT)('$title', async ({ check }) => {
    await expect(check(await fakeHarness())).resolves.toStrictEqual([]);
  });
});

describe('the Telegram contract against adapters that break it', () => {
  it.each(TELEGRAM_CONTRACT)(
    'finds the rule that a wrong adapter breaks: $title',
    async ({ check }) => {
      await expect(check(await brokenHarness())).resolves.not.toHaveLength(0);
    },
  );

  it.each(TELEGRAM_CONTRACT)(
    'finds the rule that a failing adapter breaks: $title',
    async ({ check }) => {
      await expect(check(await failingHarness())).resolves.not.toHaveLength(0);
    },
  );
});
