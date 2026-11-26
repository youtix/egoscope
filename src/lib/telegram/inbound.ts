// What every adapter of the Telegram port shares about what the bot receives: the body
// of a webhook call read as an update, its secret header compared in constant time, and
// the deep link whose Start button sends the bot a one-time link code (telegram sheet,
// "How it is called").
import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { CHAT_TYPES } from './types';

import type { Chat, InboundUpdate, UpdateParse } from './types';

/** The Bot API's name of an update's identifier. */
export const UPDATE_ID = 'update_id';
/** The Bot API's name of an update that changes the bot's membership of a chat. */
export const MY_CHAT_MEMBER = 'my_chat_member';

// The `/start <code>` that the deep link's Start button sends, its code 1 to 64
// base64url characters; in a group, the command may carry the bot's name.
const START = /^\/start(?:@\w{1,32})? (?<code>[\w-]{1,64})$/u;
const NOT_AN_UPDATE: UpdateParse = { ok: false, error: { kind: 'not_an_update' } };

const chat = z.object({ id: z.int(), type: z.enum(CHAT_TYPES) });
// An update of the two kinds the webhook asks for; a part that cannot be read leaves
// the update without its chat, still counted by its identifier.
const update = z.object({
  [UPDATE_ID]: z.int().nonnegative(),
  message: z.object({ chat, text: z.string().optional() }).optional().catch(undefined),
  [MY_CHAT_MEMBER]: z.object({ chat }).optional().catch(undefined),
});

type Update = z.infer<typeof update>;

/** The link code of a `/start <code>`, or none for any other text. */
const linkCodeOf = (text = ''): string | undefined => START.exec(text)?.groups?.['code'];

function inboundOf(body: Update): InboundUpdate {
  const updateId = body[UPDATE_ID];
  const { message } = body;
  const linkCode = linkCodeOf(message?.text);
  if (message !== undefined && linkCode !== undefined) {
    return { kind: 'start', updateId, chat: message.chat, linkCode };
  }
  const named: Chat | undefined = message?.chat ?? body[MY_CHAT_MEMBER]?.chat;
  return { kind: 'other', updateId, chat: named ?? null };
}

/**
 * Reads a body that Telegram sent as an update (TEL-29, TEL-31): a `/start` with a link
 * code, from whatever chat it comes, or anything else with the chat it names, each with
 * its `update_id`; a body without an `update_id` is `not_an_update`.
 */
export function parseUpdate(body: unknown): UpdateParse {
  const parsed = update.safeParse(body);
  return parsed.success ? { ok: true, update: inboundOf(parsed.data) } : NOT_AN_UPDATE;
}

const digestOf = (text: string): Buffer => createHash('sha256').update(text).digest();

/**
 * Says whether a webhook call's `X-Telegram-Bot-Api-Secret-Token` header is `secret`,
 * in a time that tells nothing of either (TEL-31, TRV-67): it compares their digests,
 * of one length whatever the header's.
 */
export function isSameSecret(header: string | null, secret: string): boolean {
  return header !== null && timingSafeEqual(digestOf(header), digestOf(secret));
}

/**
 * The `https://t.me/<bot>?start=<code>` link that the "Open Telegram" button carries:
 * its Start button sends the bot `/start <code>` from the owner's private chat (TEL-29,
 * CL-TEL-23).
 */
export function deepLink(username: string, linkCode: string): string {
  return `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(linkCode)}`;
}
