// The Telegram Bot API of tests, development and the hermetic end-to-end mode: an
// inbox per chat, the updates that people send the bot, a webhook registration, and
// the controls that script failures (module map §5).
import { now } from '@/lib/time';

import { isSameSecret, MY_CHAT_MEMBER, parseUpdate, UPDATE_ID } from './inbound';
import { MESSAGE_MAX_LENGTH, requireText, textLength, WEBHOOK_SETTINGS } from './types';

import type { TelegramError } from './errors';
import type {
  CallContext,
  CallMetadata,
  Chat,
  DeleteAnswer,
  InboundUpdate,
  Telegram,
  TelegramOutcome,
  WebhookAnswer,
  WebhookInfo,
} from './types';
import type { EpochMs } from '@/lib/time';

/** A message as the chat holds it. */
export type ReceivedMessage = Readonly<{ messageId: number; text: string; sentAt: EpochMs }>;

/** The JSON body that Telegram posts to the webhook, or keeps for polling. */
export type UpdateBody = Readonly<Record<string, unknown>>;

/** An operation of the fake that calls out, which a script can make fail. */
export type FakeTelegramOperation = Exclude<keyof Telegram, 'parseUpdate' | 'verifyWebhookSecret'>;

/** The fake Telegram and its controls. */
export type FakeTelegram = Telegram &
  Readonly<{
    /**
     * A person writes `text` to the bot from `chat`, which can then receive messages, even
     * after blocking the bot, since Telegram has a person unblock the bot to write to it
     * again: Telegram keeps the update for polling while no webhook is set, and the fake
     * gives the body it would post to one (TEL-29, TEL-31, TEL-37).
     */
    deliver: (chat: Chat, text: string) => UpdateBody;
    /** Telegram delivers `body` again, which polling then reads a second time. */
    deliverAgain: (body: unknown) => void;
    /**
     * The person of `chat` blocks the bot: Telegram reports it in an update, and refuses later
     * sends until the person writes again (TEL-37).
     */
    block: (chat: Chat) => UpdateBody;
    /** The messages that `chat` holds, oldest first, without the deleted ones. */
    inbox: (chat: number) => readonly ReceivedMessage[];
    /**
     * Makes the next calls of `operation` fail with `errors`, one each, in order (TEL-35, TEL-37).
     */
    failNext: (operation: FakeTelegramOperation, errors: readonly TelegramError[]) => void;
    /**
     * Makes Telegram refuse every webhook registration, saying `description`, until called with
     * null.
     */
    refuseWebhooks: (description: string | null) => void;
    /** Telegram failed to deliver an update to the webhook, which `getWebhookInfo` then reports. */
    failWebhookDelivery: (message: string) => void;
  }>;

type Registration = Readonly<{ url: string; secretToken: string }>;

const USERNAME = 'egoscope_fake_bot';
const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;
// Telegram deletes a message only if it was sent less than 48 hours ago.
const DELETABLE_HOURS = 48;
const UPDATES_PER_CALL = 100;
const NO_CALL: CallMetadata = { httpRequests: 0, messages: 0 };
const ONE_REQUEST: CallMetadata = { httpRequests: 1, messages: 0 };
const BLOCKED: TelegramError = { kind: 'blocked' };
const CHAT_NOT_FOUND: TelegramError = { kind: 'chat_not_found' };
const DELETED: DeleteAnswer = { kind: 'deleted' };
const NOT_FOUND: DeleteAnswer = { kind: 'not_found' };
// The Bot API's names of the fields that the fake's updates carry besides the chat.
const MESSAGE_ID = 'message_id';
const NEW_CHAT_MEMBER = 'new_chat_member';

const answered = <T>(value: T, messages = 0): TelegramOutcome<T> => ({
  ok: true,
  value,
  call: { httpRequests: 1, messages },
});

const refused = <T>(error: TelegramError, call = ONE_REQUEST): TelegramOutcome<T> => ({
  ok: false,
  error,
  call,
});

class Fake implements FakeTelegram {
  readonly #inboxes = new Map<number, ReceivedMessage[]>();
  readonly #blocked = new Set<number>();
  readonly #failures = new Map<FakeTelegramOperation, TelegramError[]>();
  #pending: InboundUpdate[] = [];
  #registration: Registration | null = null;
  #refusal: string | null = null;
  #lastError: WebhookInfo['lastError'] = null;
  #nextId = 1;

  readonly parseUpdate = parseUpdate;

  readonly verifyWebhookSecret = (header: string | null): boolean =>
    this.#registration !== null && isSameSecret(header, this.#registration.secretToken);

  readonly checkHealth: Telegram['checkHealth'] = async (ctx) =>
    this.#call(ctx, 'checkHealth', () => answered(null));

  readonly getMe: Telegram['getMe'] = async (ctx) =>
    this.#call(ctx, 'getMe', () => answered({ username: USERNAME }));

  readonly sendMessage: Telegram['sendMessage'] = async (ctx, { chat, text }) => {
    requireText(text);
    return this.#call(ctx, 'sendMessage', () => this.#send(chat, text));
  };

  readonly deleteMessage: Telegram['deleteMessage'] = async (ctx, { chat, messageId }) =>
    this.#call(ctx, 'deleteMessage', () => this.#delete(chat, messageId));

  readonly setWebhook: Telegram['setWebhook'] = async (ctx, registration) =>
    this.#call(ctx, 'setWebhook', () => {
      if (this.#refusal !== null) {
        return answered<WebhookAnswer>({ kind: 'refused', description: this.#refusal });
      }
      this.#registration = registration;
      this.#pending = [];
      return answered<WebhookAnswer>({ kind: 'registered' });
    });

  readonly getWebhookInfo: Telegram['getWebhookInfo'] = async (ctx) =>
    this.#call(ctx, 'getWebhookInfo', () => {
      const isRegistered = this.#registration !== null;
      return answered({
        url: this.#registration?.url ?? null,
        pendingUpdates: this.#pending.length,
        lastError: this.#lastError,
        maxConnections: isRegistered ? WEBHOOK_SETTINGS.maxConnections : null,
        allowedUpdates: isRegistered ? WEBHOOK_SETTINGS.allowedUpdates : [],
      });
    });

  readonly deleteWebhook: Telegram['deleteWebhook'] = async (ctx) =>
    this.#call(ctx, 'deleteWebhook', () => {
      this.#registration = null;
      return answered(null);
    });

  readonly getUpdates: Telegram['getUpdates'] = async (ctx, { offset }) =>
    this.#call(ctx, 'getUpdates', () => {
      if (this.#registration !== null) {
        return refused({ kind: 'webhook_conflict' });
      }
      if (offset !== null) {
        this.#pending = this.#pending.filter(({ updateId }) => updateId >= offset);
      }
      return answered(this.#pending.slice(0, UPDATES_PER_CALL));
    });

  readonly deliver = (chat: Chat, text: string): UpdateBody => {
    // A group that removed the bot sends it nothing until someone adds the bot back.
    if (chat.type === 'private') {
      this.#blocked.delete(chat.id);
    }
    return this.#receive(chat, 'message', { [MESSAGE_ID]: this.#takeId(), text });
  };

  readonly deliverAgain = (body: unknown): void => {
    const parsed = parseUpdate(body);
    if (parsed.ok && this.#registration === null) {
      this.#pending.push(parsed.update);
    }
  };

  readonly block = (chat: Chat): UpdateBody => {
    this.#blocked.add(chat.id);
    return this.#receive(chat, MY_CHAT_MEMBER, { [NEW_CHAT_MEMBER]: { status: 'kicked' } });
  };

  readonly inbox = (chat: number): readonly ReceivedMessage[] => [
    ...(this.#inboxes.get(chat) ?? []),
  ];

  readonly failNext = (
    operation: FakeTelegramOperation,
    errors: readonly TelegramError[],
  ): void => {
    this.#failures.set(operation, [...(this.#failures.get(operation) ?? []), ...errors]);
  };

  readonly refuseWebhooks = (description: string | null): void => {
    this.#refusal = description;
  };

  readonly failWebhookDelivery = (message: string): void => {
    this.#lastError = { at: now(), message };
  };

  /** Answers `answer()`, unless the call may no longer run or a script makes it fail. */
  async #call<T>(
    { deadline, signal }: CallContext,
    operation: FakeTelegramOperation,
    answer: () => TelegramOutcome<T>,
  ): Promise<TelegramOutcome<T>> {
    await Promise.resolve();
    if (signal.aborted || now() >= deadline) {
      return refused({ kind: 'timeout' }, NO_CALL);
    }
    const failure = this.#failures.get(operation)?.shift();
    return failure === undefined ? answer() : refused(failure);
  }

  /** The inbox of `chat`, or why nothing reaches it. */
  #reach(chat: number): ReceivedMessage[] | TelegramError {
    return this.#blocked.has(chat) ? BLOCKED : (this.#inboxes.get(chat) ?? CHAT_NOT_FOUND);
  }

  #send(chat: number, text: string): TelegramOutcome<Readonly<{ messageId: number }>> {
    const inbox = this.#reach(chat);
    if (!Array.isArray(inbox)) {
      return refused(inbox);
    }
    if (textLength(text) > MESSAGE_MAX_LENGTH) {
      return refused({ kind: 'too_long' });
    }
    const messageId = this.#takeId();
    inbox.push({ messageId, text, sentAt: now() });
    return answered({ messageId }, 1);
  }

  #delete(chat: number, messageId: number): TelegramOutcome<DeleteAnswer> {
    const inbox = this.#reach(chat);
    if (!Array.isArray(inbox)) {
      return refused(inbox);
    }
    const index = inbox.findIndex((message) => message.messageId === messageId);
    const message = inbox[index];
    if (message === undefined) {
      return answered(NOT_FOUND);
    }
    if (now() - message.sentAt >= DELETABLE_HOURS * MS_PER_HOUR) {
      return refused({ kind: 'delete_refused' });
    }
    inbox.splice(index, 1);
    return answered(DELETED);
  }

  /**
   * Telegram's update of `kind` from `chat`, which opens the chat's inbox, kept for polling while
   * no webhook is set.
   */
  #receive(chat: Chat, kind: string, content: Readonly<Record<string, unknown>>): UpdateBody {
    const body = {
      [UPDATE_ID]: this.#takeId(),
      [kind]: { ...content, chat, date: Math.floor(now() / MS_PER_SECOND) },
    };
    if (!this.#inboxes.has(chat.id)) {
      this.#inboxes.set(chat.id, []);
    }
    this.deliverAgain(body);
    return body;
  }

  #takeId(): number {
    const id = this.#nextId;
    this.#nextId += 1;
    return id;
  }
}

/**
 * A fresh fake Telegram (module map §5): an inbox per chat that wrote to the bot; the
 * updates of private chats, groups and strangers, delivered once or twice; messages
 * that it refuses to delete once 48 hours old (TEL-38, CL-TEL-09); `webhook_conflict`
 * for polling while a webhook is set; and scripted slow-downs, temporary and permanent
 * failures, and webhook refusals (TEL-35, TEL-37).
 */
export function createFakeTelegram(): FakeTelegram {
  return new Fake();
}
