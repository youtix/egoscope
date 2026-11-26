import type { TelegramError } from './errors';
import type { EpochMs } from '@/lib/time';

/** The deadline and abort signal of one call, inside the budget of its tick (module map §2.3). */
export type CallContext = Readonly<{ deadline: EpochMs; signal: AbortSignal }>;

/** What one call cost, which `quotas.withQuota` records for the service `telegram` (TRV-03): its requests and the messages it sent. */
export type CallMetadata = Readonly<{ httpRequests: number; messages: number }>;

/** The longest text of one message, in characters once its tags are read: Telegram's limit (CL-TEL-14). */
export const MESSAGE_MAX_LENGTH = 4096;

// The markup of a text in HTML mode that Telegram does not count as written: a tag,
// which it leaves out, or an entity, which it counts as one character.
const MARKUP = /<[^<>]*>|&(?:lt|gt|amp|quot|#\d+|#x[\da-f]+);/giu;
const ENTITY_START = '&';

/**
 * The length that Telegram counts of a text in HTML mode, its markup measured, never
 * removed (CL-TEL-14): 1 to MESSAGE_MAX_LENGTH characters for a text it sends.
 */
export function textLength(html: string): number {
  let length = html.length;
  for (const [markup] of html.matchAll(MARKUP)) {
    length -= markup.startsWith(ENTITY_START) ? markup.length - 1 : markup.length;
  }
  return length;
}

/**
 * Throws a RangeError on a text that Telegram would refuse as empty, no character once
 * its tags are read: a bug of the caller, which composes every message from at least
 * one line (TEL-08), and which no adapter sends.
 */
export function requireText(html: string): void {
  if (textLength(html) === 0) {
    throw new RangeError('A Telegram message needs a text of at least one character.');
  }
}

/**
 * The settings of every webhook registration (telegram sheet): the updates the app
 * reads, one connection so that updates arrive one at a time and in order, and the
 * pending updates dropped.
 */
export const WEBHOOK_SETTINGS = {
  allowedUpdates: ['message', 'my_chat_member'],
  maxConnections: 1,
  dropPendingUpdates: true,
} as const;

/** The kinds of Telegram chats; only a private one can be linked (TEL-29, DSN-31). */
export const CHAT_TYPES = ['private', 'group', 'supergroup', 'channel'] as const;

/** The kind of a Telegram chat. */
export type ChatType = (typeof CHAT_TYPES)[number];

/**
 * A chat: its Telegram identifier, which a `bigint` column stores and a number holds
 * exactly, as it does a message's identifier within the chat (CL-TEL-09), and its kind.
 */
export type Chat = Readonly<{ id: number; type: ChatType }>;

/**
 * An update that Telegram delivers, by webhook or by polling (TEL-29, TEL-31): a `/start`
 * that carries a one-time link code, or anything else, such as a message without a code
 * or a change of the bot's membership, with its chat when it names one.
 */
export type InboundUpdate =
  | Readonly<{ kind: 'start'; updateId: number; chat: Chat; linkCode: string }>
  | Readonly<{ kind: 'other'; updateId: number; chat: Chat | null }>;

/** What a webhook body holds: an update, or a body that is none. */
export type UpdateParse =
  | Readonly<{ ok: true; update: InboundUpdate }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'not_an_update' }> }>;

/** What a deletion did: deleted the message, or found none, which a withdrawal counts as deleted (CL-TEL-09). */
export type DeleteAnswer = Readonly<{ kind: 'deleted' }> | Readonly<{ kind: 'not_found' }>;

/** What a webhook registration did: registered it, or Telegram refused it, saying why. */
export type WebhookAnswer =
  Readonly<{ kind: 'registered' }> | Readonly<{ kind: 'refused'; description: string }>;

/** The webhook that Telegram holds, which the installation check shows (TRV-47); `url` null when none is set. */
export type WebhookInfo = Readonly<{
  url: string | null;
  pendingUpdates: number;
  lastError: Readonly<{ at: EpochMs; message: string }> | null;
  maxConnections: number | null;
  allowedUpdates: readonly string[];
}>;

/** A call's answer, with what the call cost whether it succeeded or failed. */
export type TelegramOutcome<T> = Readonly<
  | { ok: true; value: T; call: CallMetadata }
  | { ok: false; error: TelegramError; call: CallMetadata }
>;

type Query<T> = (ctx: CallContext) => Promise<TelegramOutcome<T>>;
type Operation<Request, T> = (ctx: CallContext, request: Request) => Promise<TelegramOutcome<T>>;

/**
 * The Telegram Bot API (module map §5, telegram sheet). `sendMessage` sends in HTML mode,
 * with link previews off, a text of 1 to MESSAGE_MAX_LENGTH characters once its tags are
 * read: a longer one is `too_long`, and an empty one, which Telegram refuses, is a bug of
 * the caller, on which every adapter throws a RangeError before any request; pacing the
 * sends, one a second per chat, is the caller's (`quotas.telegram.messagesPerSecond`);
 * `deleteMessage` deletes one sent message, one call per message
 * whatever its age (TEL-38, CL-TEL-09); `getMe` gives the bot's username, for the deep
 * link; `setWebhook` registers with WEBHOOK_SETTINGS and a secret token, and
 * `getWebhookInfo` reports the last delivery error; `getUpdates` reads the updates of
 * the polling fallback from `offset`, or from the oldest kept without one, confirming
 * those below it; `parseUpdate` reads a webhook body; `verifyWebhookSecret` compares a
 * webhook call's secret header in constant time (TEL-31, TRV-67).
 */
export type Telegram = Readonly<{
  checkHealth: Query<null>;
  getMe: Query<Readonly<{ username: string }>>;
  sendMessage: Operation<Readonly<{ chat: number; text: string }>, Readonly<{ messageId: number }>>;
  deleteMessage: Operation<Readonly<{ chat: number; messageId: number }>, DeleteAnswer>;
  setWebhook: Operation<Readonly<{ url: string; secretToken: string }>, WebhookAnswer>;
  getWebhookInfo: Query<WebhookInfo>;
  deleteWebhook: Query<null>;
  getUpdates: Operation<Readonly<{ offset: number | null }>, readonly InboundUpdate[]>;
  parseUpdate: (body: unknown) => UpdateParse;
  verifyWebhookSecret: (header: string | null) => boolean;
}>;
