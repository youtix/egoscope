import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';

import { parseServerEnv } from '@/lib/env';
import { installFakeClock, now, toEpochMs } from '@/lib/time';
import answers from '@data/fixtures/telegram/answers.json';
import errors from '@data/fixtures/telegram/errors.json';
import updates from '@data/fixtures/telegram/updates.json';

import { TELEGRAM_CONTRACT } from './contract';
import { MESSAGE_MAX_LENGTH, textLength } from './types';

import type { TelegramHarness } from './contract';
import type { TelegramError } from './errors';
import type { FakeTelegramOperation } from './fake';
import type { CallContext, Telegram, TelegramOutcome } from './types';
import type { Secret } from '@/lib/env';

/** A recorded answer of the Bot API: its status and its JSON body, or a text that is none. */
type Recorded = Readonly<{ status: number; body: unknown; text?: string }>;

/** The adapter over `fetcher`, checking webhook calls against `webhookSecret` when given. */
type Factory = (fetcher: typeof fetch, webhookSecret?: string) => Telegram;

/** A request that the replay received: its method, its HTTP method and headers, and its body. */
type Seen = Readonly<{
  address: string;
  method: string;
  init: RequestInit | undefined;
  body: string;
}>;

// A made-up token, which no scan rule takes for a real one (.gitleaks.toml).
const TOKEN = '424242:invented-token-of-the-tests';
const ADDRESS = `https://api.telegram.org/bot${TOKEN}/`;
// The secret that the contract registers its webhook with.
const CONTRACT_SECRET = 'contract-secret_0123456789';
const OWNER = updates.privateText.message.chat;
const LINK_CODE = 'aW52ZW50ZWQtbGluay1jb2RlLW9mLXRoZS1yZXBsYXk';
const DEADLINE_MS = 5000;
const SHORT_DEADLINE_MS = 20;
const FORTY_EIGHT_HOURS_MS = 48 * 3_600_000;
const FIRST_ID = 900;
const PARAMS = z.record(z.string(), z.unknown());
const ONE_REQUEST = { httpRequests: 1, messages: 0 };
const TIMED_OUT = { ok: false, error: { kind: 'timeout' }, call: ONE_REQUEST };
const HELLO = { chat: OWNER.id, text: 'Hello' };
const WEBHOOK_URL = 'https://egoscope.example.test/api/telegram/webhook';

/** A `Secret` as the configuration gives one. */
function secretOf(value: string): Secret {
  const parsed = parseServerEnv({ TELEGRAM_BOT_TOKEN: value });
  const secret = parsed.ok ? parsed.env.TELEGRAM_BOT_TOKEN : undefined;
  if (secret === undefined) {
    throw new Error('The test secret does not parse.');
  }
  return secret;
}

/** `result` with the fields of `fields` replaced, as the replay writes an answer. */
const changed = (result: object, fields: readonly (readonly [string, unknown])[]): unknown =>
  Object.fromEntries([...Object.entries(result), ...fields]);

const withResult = (recorded: Recorded, result: unknown): Recorded => ({
  status: recorded.status,
  body: { ok: true, result },
});

const respond = ({ status, body, text }: Recorded): Response =>
  text === undefined ? Response.json(body, { status }) : new Response(text, { status });

// The page that a proxy in front of Telegram may answer instead of the Bot API.
const PROXY_PAGE: Recorded = { status: 502, body: null, text: '<html>Bad Gateway</html>' };

/**
 * The Bot API of one bot, played from the recorded answers: the owner's private chat,
 * which wrote to the bot, the messages sent to it and when, the updates kept for polling
 * and the webhook's settings. It records every request, and serves `answerNext` first.
 */
class Replay {
  readonly #sentAt = new Map<number, number>();
  readonly #next: (Recorded | Error)[] = [];
  #pending: unknown[] = [];
  #webhook: Readonly<Record<string, unknown>> | null = null;
  #nextId = FIRST_ID;
  readonly seen: Seen[] = [];

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const body = typeof init?.body === 'string' ? init.body : '';
    const address = typeof input === 'string' ? input : '';
    const method = address.slice(ADDRESS.length);
    this.seen.push({ address, method, init, body });
    const next = this.#next.shift();
    if (next instanceof Error) {
      throw next;
    }
    const params = PARAMS.parse(JSON.parse(body));
    return respond(next ?? this.#route(method, params));
  };

  #route(method: string, params: Readonly<Record<string, unknown>>): Recorded {
    const routes: Readonly<Record<string, () => Recorded>> = {
      getMe: () => answers.getMe,
      sendMessage: () => this.#send(params),
      deleteMessage: () => this.#delete(params),
      setWebhook: () => this.#register(params),
      getWebhookInfo: () => this.#info(),
      deleteWebhook: () => this.#unregister(),
    };
    // `getUpdates`, the one method left.
    return routes[method]?.() ?? this.#poll(params);
  }

  #register(params: Readonly<Record<string, unknown>>): Recorded {
    this.#webhook = params;
    this.#pending = [];
    return answers.webhookSet;
  }

  #unregister(): Recorded {
    this.#webhook = null;
    return answers.webhookDeleted;
  }

  #send(params: Readonly<Record<string, unknown>>): Recorded {
    if (params['chat_id'] !== OWNER.id) {
      return errors.chatNotFound;
    }
    if (textLength(z.string().parse(params['text'])) > MESSAGE_MAX_LENGTH) {
      return errors.messageTooLong;
    }
    const messageId = this.#takeId();
    this.#sentAt.set(messageId, now());
    const { result } = answers.sendMessage.body;
    return withResult(answers.sendMessage, changed(result, [['message_id', messageId]]));
  }

  #delete(params: Readonly<Record<string, unknown>>): Recorded {
    const messageId = Number(params['message_id']);
    const sentAt = this.#sentAt.get(messageId);
    if (sentAt === undefined) {
      return errors.messageToDeleteNotFound;
    }
    if (now() - sentAt >= FORTY_EIGHT_HOURS_MS) {
      return errors.messageCannotBeDeleted;
    }
    this.#sentAt.delete(messageId);
    return answers.done;
  }

  #info(): Recorded {
    const webhook = this.#webhook;
    if (webhook === null) {
      const { result } = answers.noWebhookInfo.body;
      return withResult(answers.noWebhookInfo, changed(result, [['pending_update_count', 0]]));
    }
    const fields = ['url', 'max_connections', 'allowed_updates'].map(
      (name): readonly [string, unknown] => [name, webhook[name]],
    );
    const { result } = answers.webhookInfo.body;
    return withResult(answers.webhookInfo, changed(result, fields));
  }

  #poll(params: Readonly<Record<string, unknown>>): Recorded {
    if (this.#webhook !== null) {
      return errors.webhookActive;
    }
    const offset = Number(params['offset'] ?? 0);
    this.#pending = this.#pending.filter(
      (update) => Number(PARAMS.parse(update)['update_id']) >= offset,
    );
    return withResult(answers.updates, this.#pending);
  }

  #takeId(): number {
    this.#nextId += 1;
    return this.#nextId;
  }

  answerNext(...recorded: readonly (Recorded | Error)[]): void {
    this.#next.push(...recorded);
  }

  /** The person of the owner's chat writes `text` to the bot. */
  write(text: string): void {
    const message = changed(updates.privateText.message, [['text', text]]);
    const update = changed(updates.privateText, [
      ['update_id', this.#takeId()],
      ['message', message],
    ]);
    this.#pending.push(update);
  }

  /** Makes the message `messageId` 48 hours old. */
  age(messageId: number): number {
    this.#sentAt.set(messageId, now() - FORTY_EIGHT_HOURS_MS);
    return messageId;
  }
}

const open = (deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal: new AbortController().signal,
});

/** The contract's harness: the adapter that `create` makes over a fresh replay. */
async function botApiHarness(create: Factory): Promise<TelegramHarness> {
  await Promise.resolve();
  const replay = new Replay();
  const bot = create(replay.fetch, CONTRACT_SECRET);
  return {
    bot,
    chat: OWNER.id,
    unknownChat: OWNER.id + 1,
    write: async (text) => {
      await Promise.resolve();
      replay.write(text);
    },
    sendOld: async () => {
      const sent = await bot.sendMessage(open(), { chat: OWNER.id, text: 'An old message' });
      return sent.ok ? replay.age(sent.value.messageId) : null;
    },
  };
}

/** A slow-down that gives no delay. */
const withoutDelay = (recorded: Recorded): Recorded => ({
  status: recorded.status,
  body: Object.fromEntries(
    Object.entries(PARAMS.parse(recorded.body)).filter(([name]) => name !== 'parameters'),
  ),
});

/** A refusal of Telegram whose text holds the address of the request, token included. */
const echoing = (recorded: Recorded): Recorded => ({
  status: recorded.status,
  body: changed(PARAMS.parse(recorded.body), [['description', `Refused ${ADDRESS}getMe`]]),
});

const rateLimited = (retryAfterMs: number): TelegramError => ({
  kind: 'rate_limited',
  retryAfterMs,
});

// Each refusal, the call that meets it, and the failure the port reports.
const NO_CHAT: TelegramError = { kind: 'chat_not_found' };
const UNREACHABLE: TelegramError = { kind: 'unreachable' };

/** A refusal: its name, Telegram's answer, the call that meets it and the failure it stands for. */
type Refusal = readonly [string, Recorded, FakeTelegramOperation, TelegramError];

const REFUSALS: readonly Refusal[] = [
  ['a slow-down', errors.tooManyRequests, 'sendMessage', rateLimited(7000)],
  ['a slow-down without delay', withoutDelay(errors.tooManyRequests), 'getMe', rateLimited(0)],
  ['a refused token', errors.unauthorized, 'setWebhook', { kind: 'unauthorized' }],
  ['an address that names no bot', errors.notFound, 'checkHealth', { kind: 'unauthorized' }],
  ['a blocked bot', errors.blocked, 'sendMessage', { kind: 'blocked' }],
  ['a deleted account', errors.userDeactivated, 'sendMessage', NO_CHAT],
  ['a person who never wrote', errors.cannotInitiate, 'sendMessage', NO_CHAT],
  ['an unknown chat', errors.chatNotFound, 'deleteMessage', NO_CHAT],
  ['a text over 4,096 characters', errors.messageTooLong, 'sendMessage', { kind: 'too_long' }],
  ['an old message', errors.messageCannotBeDeleted, 'deleteMessage', { kind: 'delete_refused' }],
  ['polling under a webhook', errors.webhookActive, 'getUpdates', { kind: 'webhook_conflict' }],
  ['a server error', errors.badGateway, 'getWebhookInfo', UNREACHABLE],
  ['an unknown refusal', echoing(errors.cannotParseEntities), 'sendMessage', UNREACHABLE],
  ['a page that is no JSON', PROXY_PAGE, 'deleteWebhook', UNREACHABLE],
  ['a result of another shape', withResult(answers.done, { username: 7 }), 'getMe', UNREACHABLE],
];

type Call = (bot: Telegram, ctx: CallContext) => Promise<TelegramOutcome<unknown>>;

// Each operation that calls out, with a request that suits it.
const CALLS: Readonly<Record<FakeTelegramOperation, Call>> = {
  checkHealth: async (bot, ctx) => bot.checkHealth(ctx),
  getMe: async (bot, ctx) => bot.getMe(ctx),
  sendMessage: async (bot, ctx) => bot.sendMessage(ctx, HELLO),
  deleteMessage: async (bot, ctx) => bot.deleteMessage(ctx, { chat: OWNER.id, messageId: 1 }),
  setWebhook: async (bot, ctx) => bot.setWebhook(ctx, { url: WEBHOOK_URL, secretToken: 'x' }),
  getWebhookInfo: async (bot, ctx) => bot.getWebhookInfo(ctx),
  deleteWebhook: async (bot, ctx) => bot.deleteWebhook(ctx),
  getUpdates: async (bot, ctx) => bot.getUpdates(ctx, { offset: null }),
};

/** A fetch that answers nothing until its signal aborts, then fails with the address in its text. */
const stalled: typeof fetch = async (_input, init) => {
  await new Promise((resolve) => init?.signal?.addEventListener('abort', resolve));
  throw new DOMException(`Stopped ${ADDRESS}`, 'TimeoutError');
};

describe('createBotApiTelegram', () => {
  // The adapter's factory and what its logger was given, from modules loaded afresh by
  // a server whose configuration holds TOKEN, which `redact` then masks.
  let create: Factory;
  let logged: () => string;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', TOKEN);
    const { createBotApiTelegram } = await import('./bot-api');
    const { logger } = await import('@/lib/log');
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    const spies = levels.map((level) =>
      vi.spyOn(logger, level).mockImplementation(() => undefined),
    );
    logged = () => JSON.stringify(spies.map((spy) => spy.mock.calls));
    create = (fetcher, webhookSecret) =>
      createBotApiTelegram({
        token: secretOf(TOKEN),
        webhookSecret: webhookSecret === undefined ? undefined : secretOf(webhookSecret),
        fetch: fetcher,
      });
  });

  describe('[TRV-18] [TEL-29] [TEL-31] [TEL-38] [CL-TEL-09] [CL-TEL-14] against the Telegram contract, on recorded answers', () => {
    it.each(TELEGRAM_CONTRACT)('$title', async ({ check }) => {
      await expect(check(await botApiHarness(create))).resolves.toStrictEqual([]);
    });
  });

  it('[TRV-18] sends in HTML mode with link previews off, by a POST of JSON to the address of the token, and counts one message', async () => {
    const replay = new Replay();
    const outcome = await create(replay.fetch).sendMessage(open(), {
      chat: OWNER.id,
      text: '<b>Hi</b>',
    });
    const requests = replay.seen.map(({ address, init }) => [address, init?.method, init?.headers]);

    expect(outcome).toStrictEqual({
      ok: true,
      value: { messageId: FIRST_ID + 1 },
      call: { httpRequests: 1, messages: 1 },
    });
    expect(requests).toStrictEqual([
      [`${ADDRESS}sendMessage`, 'POST', { 'content-type': 'application/json' }],
    ]);
    expect(replay.seen.map(({ init }) => init?.redirect)).toStrictEqual(['error']);
    expect(replay.seen.map(({ body }) => body)).toStrictEqual([
      `{"chat_id":${String(OWNER.id)},"text":"<b>Hi</b>","parse_mode":"HTML","link_preview_options":{"is_disabled":true}}`,
    ]);
  });

  it('throws on a text that is empty once its tags are read, without a request', async () => {
    const replay = new Replay();
    const bot = create(replay.fetch);

    await expect(bot.sendMessage(open(), { chat: OWNER.id, text: '' })).rejects.toThrow(RangeError);
    await expect(bot.sendMessage(open(), { chat: OWNER.id, text: '<b></b>' })).rejects.toThrow(
      RangeError,
    );
    expect(replay.seen).toStrictEqual([]);
  });

  it('[TEL-38] [CL-TEL-09] asks once per message whatever its age, and answers deleted, refused or not found', async () => {
    const replay = new Replay();
    const bot = create(replay.fetch);
    await bot.sendMessage(open(), HELLO);
    await bot.sendMessage(open(), HELLO);
    replay.age(FIRST_ID + 2);
    const answered = [
      await bot.deleteMessage(open(), { chat: OWNER.id, messageId: FIRST_ID + 1 }),
      await bot.deleteMessage(open(), { chat: OWNER.id, messageId: FIRST_ID + 2 }),
      await bot.deleteMessage(open(), { chat: OWNER.id, messageId: FIRST_ID + 1 }),
    ];

    expect(answered).toStrictEqual([
      { ok: true, value: { kind: 'deleted' }, call: ONE_REQUEST },
      { ok: false, error: { kind: 'delete_refused' }, call: ONE_REQUEST },
      { ok: true, value: { kind: 'not_found' }, call: ONE_REQUEST },
    ]);
    expect(replay.seen.slice(2).map(({ method, body }) => [method, body])).toStrictEqual(
      [FIRST_ID + 1, FIRST_ID + 2, FIRST_ID + 1].map((id) => [
        'deleteMessage',
        `{"chat_id":${String(OWNER.id)},"message_id":${String(id)}}`,
      ]),
    );
  });

  it('[TEL-29] registers the webhook with its secret, messages and membership changes, one connection and the pending updates dropped', async () => {
    const replay = new Replay();
    const outcome = await create(replay.fetch).setWebhook(open(), {
      url: WEBHOOK_URL,
      secretToken: CONTRACT_SECRET,
    });

    expect(outcome).toStrictEqual({ ok: true, value: { kind: 'registered' }, call: ONE_REQUEST });
    expect(replay.seen.map(({ method, body }) => [method, body])).toStrictEqual([
      [
        'setWebhook',
        `{"url":"${WEBHOOK_URL}","secret_token":"${CONTRACT_SECRET}","allowed_updates":["message","my_chat_member"],"max_connections":1,"drop_pending_updates":true}`,
      ],
    ]);
  });

  it('[TEL-29] [TRV-47] reports the webhook and its last delivery error, and no webhook once none is set', async () => {
    const replay = new Replay();
    const bot = create(replay.fetch);
    replay.answerNext(answers.webhookInfo, answers.noWebhookInfo);
    const outcomes = [await bot.getWebhookInfo(open()), await bot.getWebhookInfo(open())];

    expect(outcomes).toStrictEqual([
      {
        ok: true,
        value: {
          url: WEBHOOK_URL,
          pendingUpdates: 2,
          lastError: {
            at: toEpochMs(1_795_000_300_000),
            message: 'Wrong response from the webhook: 502 Bad Gateway',
          },
          maxConnections: 1,
          allowedUpdates: ['message', 'my_chat_member'],
        },
        call: ONE_REQUEST,
      },
      {
        ok: true,
        value: {
          url: null,
          pendingUpdates: 0,
          lastError: null,
          maxConnections: null,
          allowedUpdates: [],
        },
        call: ONE_REQUEST,
      },
    ]);
  });

  it('[TEL-29] [TRV-47] answers a webhook that Telegram refuses with its reason', async () => {
    const replay = new Replay();
    replay.answerNext(errors.badWebhook);
    const outcome = await create(replay.fetch).setWebhook(open(), {
      url: WEBHOOK_URL,
      secretToken: 'x',
    });

    expect(outcome).toStrictEqual({
      ok: true,
      value: { kind: 'refused', description: errors.badWebhook.body.description },
      call: ONE_REQUEST,
    });
  });

  it('[TEL-29] [TEL-31] polls briefly from an offset for messages and membership changes, and reads each update', async () => {
    const replay = new Replay();
    const bot = create(replay.fetch);
    const recorded = [
      updates.privateStart,
      updates.groupStart,
      updates.privateText,
      updates.botBlocked,
    ];
    replay.answerNext(withResult(answers.updates, recorded));
    const outcome = await bot.getUpdates(open(), { offset: 830_000_101 });
    await bot.getUpdates(open(), { offset: null });
    const owner = { id: OWNER.id, type: 'private' };
    const group = { id: -1_005_550_009, type: 'supergroup' };

    expect(outcome).toStrictEqual({
      ok: true,
      value: [
        { kind: 'start', updateId: 830_000_101, chat: owner, linkCode: LINK_CODE },
        { kind: 'start', updateId: 830_000_102, chat: group, linkCode: LINK_CODE },
        { kind: 'other', updateId: 830_000_103, chat: owner },
        { kind: 'other', updateId: 830_000_104, chat: owner },
      ],
      call: ONE_REQUEST,
    });
    expect(replay.seen.map(({ body }) => body)).toStrictEqual([
      '{"offset":830000101,"limit":100,"timeout":0,"allowed_updates":["message","my_chat_member"]}',
      '{"limit":100,"timeout":0,"allowed_updates":["message","my_chat_member"]}',
    ]);
  });

  it('[TRV-18] [TEL-29] reads a /start with a 43-character code from a private chat, with its chat id, chat type and update_id', () => {
    const parsed = create(new Replay().fetch).parseUpdate(updates.privateStart);

    expect(parsed).toStrictEqual({
      ok: true,
      update: {
        kind: 'start',
        updateId: 830_000_101,
        chat: { id: OWNER.id, type: 'private' },
        linkCode: LINK_CODE,
      },
    });
    expect(LINK_CODE).toHaveLength(43);
  });

  it('[TEL-31] [TRV-67] accepts only the header of TELEGRAM_WEBHOOK_SECRET, and none while it is not set', () => {
    // A made-up value, low in entropy, which no scan rule takes for a real one.
    const configured = 'invented-webhook-header';
    const bots = [create(new Replay().fetch, configured), create(new Replay().fetch)];
    const headers = [configured, `${configured}x`, configured.slice(1), '', null];
    const checks = bots.map((bot) => headers.map((header) => bot.verifyWebhookSecret(header)));

    expect(checks).toStrictEqual([
      [true, false, false, false, false],
      [false, false, false, false, false],
    ]);
  });

  it.each(REFUSALS)(
    '[TEL-35] [TEL-37] [TRV-64] maps %s to the port, and shows the token nowhere',
    async (...row: Refusal) => {
      const [, recorded, operation, error] = row;
      const replay = new Replay();
      replay.answerNext(recorded);
      const outcome = await CALLS[operation](create(replay.fetch), open());

      expect(outcome).toStrictEqual({ ok: false, error, call: ONE_REQUEST });
      expect(JSON.stringify(outcome) + logged()).not.toContain(TOKEN);
    },
  );

  it('[TEL-35] [TRV-64] answers unreachable when no answer comes, and logs why with the token masked', async () => {
    const replay = new Replay();
    replay.answerNext(new TypeError(`fetch failed: ${ADDRESS}getMe`));
    const outcome = await create(replay.fetch).getMe(open());

    expect(outcome).toStrictEqual({ ok: false, error: UNREACHABLE, call: ONE_REQUEST });
    expect(logged()).toContain('fetch failed: https://api.telegram.org/bot[secret]/getMe');
    expect(JSON.stringify(outcome) + logged()).not.toContain(TOKEN);
  });

  it('[TEL-35] [TRV-64] logs a refusal that it does not know with the token masked', async () => {
    const replay = new Replay();
    replay.answerNext(echoing(errors.cannotParseEntities));
    await create(replay.fetch).sendMessage(open(), HELLO);

    expect(logged()).toContain('Refused https://api.telegram.org/bot[secret]/getMe');
    expect(logged()).not.toContain(TOKEN);
  });

  it('[TRV-64] masks the token in a webhook refusal, and in the address and the delivery error of a webhook that Telegram writes back', async () => {
    const replay = new Replay();
    const bot = create(replay.fetch);
    const { result } = answers.webhookInfo.body;
    const failure = changed(result, [
      ['url', `${WEBHOOK_URL}/${TOKEN}`],
      ['last_error_message', `Failed ${ADDRESS}`],
    ]);
    replay.answerNext(echoing(errors.badWebhook), withResult(answers.webhookInfo, failure));
    const outcomes = [
      await bot.setWebhook(open(), { url: WEBHOOK_URL, secretToken: 'x' }),
      await bot.getWebhookInfo(open()),
    ];

    expect(outcomes).toMatchObject([
      {
        ok: true,
        value: {
          kind: 'refused',
          description: 'Refused https://api.telegram.org/bot[secret]/getMe',
        },
      },
      {
        ok: true,
        value: { lastError: { message: 'Failed https://api.telegram.org/bot[secret]/' } },
      },
    ]);
    expect(JSON.stringify(outcomes) + logged()).not.toContain(TOKEN);
  });

  it('[TEL-35] [TRV-64] answers timeout without a request past its deadline, and with one that its deadline or its caller stops', async () => {
    const replay = new Replay();
    const caller = new AbortController();
    const stopped = create(stalled).getMe({ ...open(FORTY_EIGHT_HOURS_MS), signal: caller.signal });
    caller.abort();
    const outcomes = [
      await create(replay.fetch).getMe(open(-1)),
      await create(stalled).getMe(open(SHORT_DEADLINE_MS)),
      await stopped,
    ];

    expect(outcomes).toStrictEqual([
      { ok: false, error: { kind: 'timeout' }, call: { httpRequests: 0, messages: 0 } },
      TIMED_OUT,
      TIMED_OUT,
    ]);
    expect(replay.seen).toStrictEqual([]);
    expect(JSON.stringify(outcomes) + logged()).not.toContain(TOKEN);
  });

  it('[TEL-35] answers timeout, and throws nothing, when its deadline passes as the call starts', async () => {
    // The clock's first read is 1 ms before the deadline, and every later read 1 ms past it.
    const start = now();
    const first = [toEpochMs(start + 2)];
    onTestFinished(installFakeClock({ now: () => first.shift() ?? toEpochMs(start + 4) }));
    const ctx = { deadline: toEpochMs(start + 3), signal: new AbortController().signal };

    await expect(create(stalled).getMe(ctx)).resolves.toStrictEqual(TIMED_OUT);
  });
});
