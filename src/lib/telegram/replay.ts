// A local replay of Telegram's Bot API for the tests of the adapter (bot-api.ts), which never
// reach Telegram: an HTTP layer in the shape of `fetch` that serves the recorded answers of
// data/fixtures/telegram/, each changed by what the request did to the bot's chat. It records
// every request, and answers with a fault of a real service on demand.
import { z } from 'zod';

import { now } from '@/lib/time';
import answers from '@data/fixtures/telegram/answers.json';
import errors from '@data/fixtures/telegram/errors.json';
import updates from '@data/fixtures/telegram/updates.json';

import { MESSAGE_MAX_LENGTH, textLength } from './types';

// A made-up token, which no scan rule takes for a real one (.gitleaks.toml).
export const TOKEN = '424242:invented-token-of-the-tests';
export const ADDRESS = `https://api.telegram.org/bot${TOKEN}/`;
export const OWNER = updates.privateText.message.chat;
const DELETION_WINDOW_HOURS = 48;
const HOUR_MS = 3_600_000;
export const FORTY_EIGHT_HOURS_MS = DELETION_WINDOW_HOURS * HOUR_MS;
export const FIRST_ID = 900;
export const PARAMS = z.record(z.string(), z.unknown());

/** A recorded answer of the Bot API: its status and its JSON body, or a text that is none. */
export type Recorded = Readonly<{ status: number; body: unknown; text?: string }>;

/** A request that the replay received: its method, its HTTP method and headers, and its body. */
type Seen = Readonly<{
  address: string;
  method: string;
  init: RequestInit | undefined;
  body: string;
}>;

/** `result` with the fields of `fields` replaced, as the replay writes an answer. */
export const changed = (result: object, fields: readonly (readonly [string, unknown])[]): unknown =>
  Object.fromEntries([...Object.entries(result), ...fields]);

/** `recorded`, answering with `result` as the result of a successful call. */
export const withResult = (recorded: Recorded, result: unknown): Recorded => ({
  status: recorded.status,
  body: { ok: true, result },
});

const respond = ({ status, body, text }: Recorded): Response =>
  text === undefined ? Response.json(body, { status }) : new Response(text, { status });

/**
 * The Bot API of one bot, played from the recorded answers: the owner's private chat,
 * which wrote to the bot, the messages sent to it and when, the updates kept for polling
 * and the webhook's settings. It records every request, and serves `answerNext` first.
 */
export class Replay {
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

  /** The next requests are answered by `recorded`, in order, before the replay's own routes. */
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
