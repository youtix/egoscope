// The Telegram adapter on the Bot API (telegram sheet, "How it is called"): plain HTTPS,
// one POST with a JSON body to https://api.telegram.org/bot<token>/<method> per call, and
// Telegram's answers mapped to the port's failures. The token sits in the request path,
// the only place where the Bot API takes it, so the address is a secret (TRV-64, module
// map §7): `addressOf` alone writes it and `fetch` alone reads it; no error, log line or
// returned value carries it, and whatever Telegram writes back goes through `env.redact`.
import { z } from 'zod';

import { redact } from '@/lib/env';
import { logger } from '@/lib/log';
import { now, toEpochMs } from '@/lib/time';

import { isSameSecret, parseUpdate } from './inbound';
import { requireText, WEBHOOK_SETTINGS } from './types';

import type { TelegramError } from './errors';
import type {
  CallContext,
  CallMetadata,
  DeleteAnswer,
  InboundUpdate,
  Telegram,
  TelegramOutcome,
  WebhookAnswer,
  WebhookInfo,
} from './types';
import type { Secret } from '@/lib/env';

/** What the adapter needs: the bot's token, the webhook's secret when one is set, and `fetch`. */
export type BotApiOptions = Readonly<{
  token: Secret;
  webhookSecret: Secret | undefined;
  fetch: typeof fetch;
}>;

/** A refusal as Telegram writes it: its code, its description, and the seconds to wait if given. */
type Refusal = Readonly<{ code: number; description: string; retryAfter: number | undefined }>;

/**
 * One call: its method, its parameters, how its result reads, and the refusals that
 * answer it instead of failing it.
 */
type BotRequest<T> = Readonly<{
  method: string;
  params?: Readonly<Record<string, unknown>>;
  result: z.ZodType<T>;
  answerTo?: (refusal: Refusal) => T | undefined;
}>;

const API = 'https://api.telegram.org';
const JSON_TYPE = 'application/json';
const MS_PER_SECOND = 1000;
const BAD_REQUEST = 400;
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN = 403;
const NOT_FOUND_STATUS = 404;
const CONFLICT = 409;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const UPDATES_PER_CALL = 100;
// A slow-down whose answer gives no delay leaves the wait to the caller's schedule (TEL-35).
const NO_DELAY = 0;
// A short poll: a serverless function cannot hold a request open (telegram sheet).
const NO_WAIT_SECONDS = 0;
const NO_CALL: CallMetadata = { httpRequests: 0, messages: 0 };
const ONE_REQUEST: CallMetadata = { httpRequests: 1, messages: 0 };
const ONE_MESSAGE: CallMetadata = { httpRequests: 1, messages: 1 };
const TIMEOUT: TelegramError = { kind: 'timeout' };
const UNREACHABLE: TelegramError = { kind: 'unreachable' };
const CHAT_NOT_FOUND: TelegramError = { kind: 'chat_not_found' };
const UNAUTHORIZED: TelegramError = { kind: 'unauthorized' };
const DELETED: DeleteAnswer = { kind: 'deleted' };
const NOT_FOUND: DeleteAnswer = { kind: 'not_found' };
const REGISTERED: WebhookAnswer = { kind: 'registered' };
// What Telegram answers to the deletion of a message that it no longer holds.
const NO_DELETION = 'message to delete not found';

// The Bot API's names of the parameters and fields that the adapter writes or reads.
const FIELD = {
  chatId: 'chat_id',
  messageId: 'message_id',
  parseMode: 'parse_mode',
  linkPreview: 'link_preview_options',
  isDisabled: 'is_disabled',
  secretToken: 'secret_token',
  allowedUpdates: 'allowed_updates',
  maxConnections: 'max_connections',
  dropPending: 'drop_pending_updates',
  pendingCount: 'pending_update_count',
  errorDate: 'last_error_date',
  errorMessage: 'last_error_message',
  errorCode: 'error_code',
  retryAfter: 'retry_after',
} as const;

// The refusals that the adapter tells apart, the first match winning: a code, and a
// phrase of the description where the code alone does not say. Telegram answers 404 to
// an address whose token names no bot, and 403 to a chat that the bot may not write to:
// one that blocked it, a deleted account, or a person who never started the bot.
const REFUSALS: readonly Readonly<{ code: number; phrase: string; error: TelegramError }>[] = [
  { code: UNAUTHORIZED_STATUS, phrase: '', error: UNAUTHORIZED },
  { code: NOT_FOUND_STATUS, phrase: '', error: UNAUTHORIZED },
  { code: FORBIDDEN, phrase: 'blocked', error: { kind: 'blocked' } },
  { code: FORBIDDEN, phrase: '', error: CHAT_NOT_FOUND },
  { code: BAD_REQUEST, phrase: 'chat not found', error: CHAT_NOT_FOUND },
  { code: BAD_REQUEST, phrase: 'message is too long', error: { kind: 'too_long' } },
  { code: BAD_REQUEST, phrase: "message can't be deleted", error: { kind: 'delete_refused' } },
  { code: CONFLICT, phrase: 'webhook', error: { kind: 'webhook_conflict' } },
];

// The two answers of every call: a result, or a refusal with what may say how long to wait.
const RESULT = z.object({ ok: z.literal(true), result: z.unknown() });
const WAIT = z.object({ [FIELD.retryAfter]: z.int().nonnegative().optional() });
const REFUSAL = z.object({
  ok: z.literal(false),
  [FIELD.errorCode]: z.int(),
  description: z.string().default(''),
  parameters: WAIT.optional(),
});
const ENVELOPE = z.discriminatedUnion('ok', [RESULT, REFUSAL]);
const DONE = z.literal(true);
const BOT = z.object({ username: z.string() });
const SENT = z.object({ [FIELD.messageId]: z.int() });
// An update as `parseUpdate` reads it: a body that is no update fails the answer.
const READ_UPDATE = z.object({ ok: z.literal(true), update: z.custom<InboundUpdate>() });
const UPDATE = z
  .unknown()
  .transform(parseUpdate)
  .pipe(READ_UPDATE)
  .transform(({ update }) => update);
const WEBHOOK_INFO = z.object({
  url: z.string(),
  [FIELD.pendingCount]: z.int().nonnegative(),
  [FIELD.errorDate]: z.int().optional(),
  [FIELD.errorMessage]: z.string().optional(),
  [FIELD.maxConnections]: z.int().optional(),
  [FIELD.allowedUpdates]: z.array(z.string()).optional(),
});

/** The address of `method`, the only place that writes the token, which only `fetch` reads. */
const addressOf = (token: Secret, method: string): string =>
  `${API}/bot${token.reveal()}/${method}`;

const failed = <T>(error: TelegramError, call = ONE_REQUEST): TelegramOutcome<T> => ({
  ok: false,
  error,
  call,
});

/** Notes an answer that the adapter cannot read, which the caller then meets as `unreachable`. */
function unread<T>(method: string, fields: Readonly<Record<string, unknown>>): TelegramOutcome<T> {
  logger.warn('The Telegram Bot API gave an answer that the adapter does not read.', {
    method,
    ...fields,
  });
  return failed(UNREACHABLE);
}

/** The failure that a refusal stands for, or none when the adapter does not know it. */
function errorOf({ code, description, retryAfter }: Refusal): TelegramError | undefined {
  if (code === TOO_MANY_REQUESTS) {
    return { kind: 'rate_limited', retryAfterMs: (retryAfter ?? NO_DELAY) * MS_PER_SECOND };
  }
  if (code >= SERVER_ERROR) {
    return UNREACHABLE;
  }
  const text = description.toLowerCase();
  return REFUSALS.find((known) => known.code === code && text.includes(known.phrase))?.error;
}

/** `text` read as JSON, or undefined when it is none. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The outcome that the text of an answer gives. */
function outcomeOf<T>(request: BotRequest<T>, status: number, text: string): TelegramOutcome<T> {
  const answer = ENVELOPE.safeParse(parsedJson(text));
  if (!answer.success) {
    return unread(request.method, { status });
  }
  if (answer.data.ok) {
    const result = request.result.safeParse(answer.data.result);
    return result.success
      ? { ok: true, value: result.data, call: ONE_REQUEST }
      : unread(request.method, { status });
  }
  const refusal: Refusal = {
    code: answer.data[FIELD.errorCode],
    description: answer.data.description,
    retryAfter: answer.data.parameters?.[FIELD.retryAfter],
  };
  const value = request.answerTo?.(refusal);
  if (value !== undefined) {
    return { ok: true, value, call: ONE_REQUEST };
  }
  const error = errorOf(refusal);
  return error === undefined
    ? unread(request.method, { code: refusal.code, description: redact(refusal.description) })
    : failed(error);
}

/**
 * Makes the one request of a call inside its context: none once its signal has aborted
 * or its deadline passed, `timeout` when either stops it, `unreachable` without answer.
 */
async function exchange<T>(
  bot: BotApiOptions,
  ctx: CallContext,
  request: BotRequest<T>,
): Promise<TelegramOutcome<T>> {
  // One read of the clock: a second one could pass the deadline, and a negative delay
  // makes `AbortSignal.timeout` throw.
  const leftMs = ctx.deadline - now();
  if (ctx.signal.aborted || leftMs <= 0) {
    return failed(TIMEOUT, NO_CALL);
  }
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(leftMs)]);
  // Called on its own, as the global `fetch` expects, never as a method of the options.
  const send = bot.fetch;
  try {
    const response = await send(addressOf(bot.token, request.method), {
      method: 'POST',
      headers: { 'content-type': JSON_TYPE },
      body: JSON.stringify(request.params ?? {}),
      redirect: 'error',
      signal,
    });
    return outcomeOf(request, response.status, await response.text());
  } catch (error) {
    if (signal.aborted) {
      return failed(TIMEOUT);
    }
    logger.warn('The Telegram Bot API could not be reached.', {
      method: request.method,
      error: redact(error),
    });
    return failed(UNREACHABLE);
  }
}

/** The webhook that `getWebhookInfo` reports, read from Telegram's answer. */
function webhookInfoOf(info: z.infer<typeof WEBHOOK_INFO>): WebhookInfo {
  const at = info[FIELD.errorDate];
  const message = info[FIELD.errorMessage];
  return {
    url: info.url === '' ? null : redact(info.url),
    pendingUpdates: info[FIELD.pendingCount],
    lastError:
      at === undefined || message === undefined
        ? null
        : { at: toEpochMs(at * MS_PER_SECOND), message: redact(message) },
    maxConnections: info[FIELD.maxConnections] ?? null,
    allowedUpdates: info[FIELD.allowedUpdates] ?? [],
  };
}

// The requests of the calls, built from what each operation asks.
const ASK_BOT: BotRequest<Readonly<{ username: string }>> = { method: 'getMe', result: BOT };
const ASK_HEALTH: BotRequest<null> = { method: 'getMe', result: BOT.transform(() => null) };
const ASK_WEBHOOK: BotRequest<WebhookInfo> = {
  method: 'getWebhookInfo',
  result: WEBHOOK_INFO.transform(webhookInfoOf),
};
const DROP_WEBHOOK: BotRequest<null> = {
  method: 'deleteWebhook',
  result: DONE.transform(() => null),
};

const sending = (chat: number, text: string): BotRequest<Readonly<{ messageId: number }>> => ({
  method: 'sendMessage',
  params: {
    [FIELD.chatId]: chat,
    text,
    [FIELD.parseMode]: 'HTML',
    [FIELD.linkPreview]: { [FIELD.isDisabled]: true },
  },
  result: SENT.transform((message) => ({ messageId: message[FIELD.messageId] })),
});

const deleting = (chat: number, messageId: number): BotRequest<DeleteAnswer> => ({
  method: 'deleteMessage',
  params: { [FIELD.chatId]: chat, [FIELD.messageId]: messageId },
  result: DONE.transform(() => DELETED),
  answerTo: ({ description }) =>
    description.toLowerCase().includes(NO_DELETION) ? NOT_FOUND : undefined,
});

const registering = (url: string, secretToken: string): BotRequest<WebhookAnswer> => ({
  method: 'setWebhook',
  params: {
    url,
    [FIELD.secretToken]: secretToken,
    [FIELD.allowedUpdates]: WEBHOOK_SETTINGS.allowedUpdates,
    [FIELD.maxConnections]: WEBHOOK_SETTINGS.maxConnections,
    [FIELD.dropPending]: WEBHOOK_SETTINGS.dropPendingUpdates,
  },
  result: DONE.transform(() => REGISTERED),
  answerTo: ({ code, description }) =>
    code === BAD_REQUEST ? { kind: 'refused', description: redact(description) } : undefined,
});

const polling = (offset: number | null): BotRequest<readonly InboundUpdate[]> => ({
  method: 'getUpdates',
  params: {
    ...(offset !== null && { offset }),
    limit: UPDATES_PER_CALL,
    timeout: NO_WAIT_SECONDS,
    [FIELD.allowedUpdates]: WEBHOOK_SETTINGS.allowedUpdates,
  },
  result: z.array(UPDATE),
});

/**
 * The Telegram port on the Bot API, authenticated by TELEGRAM_BOT_TOKEN (TRV-18,
 * module map §5): one request per call; `sendMessage` in HTML mode with link previews off,
 * never pacing, since the caller sends one message a second per chat at most
 * (`quotas.telegram.messagesPerSecond`); `deleteMessage` asked once per message whatever
 * its age, Telegram refusing those 48 hours old (TEL-38, CL-TEL-09); `setWebhook` with
 * WEBHOOK_SETTINGS; `getUpdates` as a short poll; `verifyWebhookSecret` against
 * TELEGRAM_WEBHOOK_SECRET in constant time, refusing every header while none is set
 * (TEL-31, TRV-67); `checkHealth` with one `getMe`. Telegram's answers map to the port's
 * failures (TEL-35, TEL-37): 429 with its `retry_after`, 401 and 404 a refused token, 403
 * a blocked bot or a chat it may not write to; a 5xx, no answer, or an answer it does not
 * read, which it logs redacted, is `unreachable`.
 */
export function createBotApiTelegram(bot: BotApiOptions): Telegram {
  const { webhookSecret } = bot;
  return {
    checkHealth: async (ctx) => exchange(bot, ctx, ASK_HEALTH),
    getMe: async (ctx) => exchange(bot, ctx, ASK_BOT),
    sendMessage: async (ctx, { chat, text }) => {
      requireText(text);
      const sent = await exchange(bot, ctx, sending(chat, text));
      return sent.ok ? { ...sent, call: ONE_MESSAGE } : sent;
    },
    deleteMessage: async (ctx, { chat, messageId }) =>
      exchange(bot, ctx, deleting(chat, messageId)),
    setWebhook: async (ctx, { url, secretToken }) =>
      exchange(bot, ctx, registering(url, secretToken)),
    getWebhookInfo: async (ctx) => exchange(bot, ctx, ASK_WEBHOOK),
    deleteWebhook: async (ctx) => exchange(bot, ctx, DROP_WEBHOOK),
    getUpdates: async (ctx, { offset }) => exchange(bot, ctx, polling(offset)),
    parseUpdate,
    verifyWebhookSecret: (header) =>
      webhookSecret !== undefined && isSameSecret(header, webhookSecret.reveal()),
  };
}
