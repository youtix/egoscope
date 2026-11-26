// The controls of the Lot 2 fakes, the press feeds, the language model and Telegram,
// which fake-controls.ts registers in `/api/test/fakes` beside those of Lot 1.
import { z } from 'zod';

import { fakeLanguageModel } from '@/lib/language-model';
import { fakePressFeeds } from '@/lib/press-feeds';
import { CHAT_TYPES, fakeTelegram } from '@/lib/telegram';
import { parseTimestamp } from '@/lib/time';

import { control } from './commands';

import type { Control } from './commands';
import type { FakeTelegramOperation } from '@/lib/telegram';

/**
 * The process's own Lot 2 fakes, those that the ports serve under EGOSCOPE_FAKES, each
 * with its own controls (TRV-16, TRV-17, TRV-18).
 */
export const lot2FakeControls = {
  pressFeeds: fakePressFeeds,
  languageModel: fakeLanguageModel,
  telegram: fakeTelegram,
} as const;

const count = z.int().nonnegative();
const address = z.url();

// A feed as a test writes it: its dates written as a feed writes them, which the fake reads.
const feedDate = z.string().refine((written) => parseTimestamp(written).ok, {
  message: 'Expected a date as a feed writes it, in RFC 822 or ISO 8601.',
});
const optionalText = z.string().exactOptional();
const item = z.object({
  identifier: optionalText,
  link: optionalText,
  title: optionalText,
  published: feedDate.exactOptional(),
  updated: feedDate.exactOptional(),
  language: optionalText,
  originOutlet: optionalText,
  excerpt: optionalText,
});
const feed = z.object({
  language: optionalText,
  keeps: z.int().positive().exactOptional(),
  items: z.array(item),
});
const feedError = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['unreachable', 'requires_identification', 'not_a_feed', 'unreadable']),
  }),
  z.object({ kind: z.literal('http_error'), status: z.int() }),
]);

// What a provider of the language model answers for an article, or why it answers nothing.
const provider = z.enum(['primary', 'fallback']);
const fact = z.object({
  player: z.string(),
  type: z.string(),
  confidence: z.number(),
  description: z.string(),
  justification: z.string(),
  event: z.string().nullable(),
});
const part = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('facts'), facts: z.array(fact) }),
  z.object({
    kind: z.literal('proposal'),
    player: z.string(),
    name: z.string(),
    definition: z.string(),
  }),
  z.object({ kind: z.literal('missing_field'), fact, field: fact.keyof() }),
  z.object({ kind: z.literal('schema_breaking') }),
]);
const modelError = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['quota_refused', 'schema_not_met', 'unavailable', 'timeout', 'malformed']),
  }),
  z.object({ kind: z.literal('rate_limited'), retryAfterMs: count.nullable() }),
]);

// A Telegram chat, the operations of the bot that call out, and their failures.
const chat = z.object({ id: z.int(), type: z.enum(CHAT_TYPES) });
const TELEGRAM_OPERATIONS = [
  'checkHealth',
  'getMe',
  'sendMessage',
  'deleteMessage',
  'setWebhook',
  'getWebhookInfo',
  'deleteWebhook',
  'getUpdates',
] as const satisfies readonly FakeTelegramOperation[];
const telegramError = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum([
      'unreachable',
      'timeout',
      'blocked',
      'chat_not_found',
      'bot_deactivated',
      'unauthorized',
      'too_long',
      'delete_refused',
      'webhook_conflict',
    ]),
  }),
  z.object({ kind: z.literal('rate_limited'), retryAfterMs: count }),
]);

// The arguments of the controls.
const publication = z.object({ url: address, feed });
const post = z.object({ url: address, item });
const move = z.object({ from: address, to: address });
const feedFailures = z.object({ url: address, errors: z.array(feedError).min(1) });
const script = z.object({ provider, article: z.string(), part });
const modelFailure = z.object({ provider, error: modelError });
const slowness = z.object({ provider, delayMs: count });
const fallback = z.object({ configured: z.boolean() });
const message = z.object({ chat, text: z.string() });
const redelivery = z.object({ body: z.record(z.string(), z.unknown()) });
const fromChat = z.object({ chat });
const chatId = z.object({ chat: z.int() });
const telegramFailures = z.object({
  operation: z.enum(TELEGRAM_OPERATIONS),
  errors: z.array(telegramError).min(1),
});
const webhookRefusal = z.object({ description: z.string().nullable() });
const deliveryFailure = z.object({ message: z.string() });

/** The messages that a chat holds, oldest first, each sent at an instant in ISO 8601. */
const inboxOf = (id: number) =>
  fakeTelegram()
    .inbox(id)
    .map(({ messageId, text, sentAt }) => ({
      messageId,
      text,
      sentAt: new Date(sentAt).toISOString(),
    }));

/**
 * Every control of the Lot 2 fakes in `/api/test/fakes`, by its name, `<fake>.<control>`
 * (TRV-16, TRV-17, TRV-18): the press feeds served per address, changed between two reads
 * or failing; the answers of each provider of the language model per article, its
 * refusals for quota before the declared limit, its minute and day limits, its slow
 * answers and its fallback; and Telegram's updates from a chat, the messages a chat
 * holds, its temporary and permanent failures, its refused deletions and its webhook.
 */
export const LOT_2_CONTROLS: readonly (readonly [string, Control])[] = [
  [
    'press-feeds.publish',
    control(publication, (args) => {
      fakePressFeeds().publish(args.url, args.feed);
    }),
  ],
  [
    'press-feeds.post',
    control(post, (args) => {
      fakePressFeeds().post(args.url, args.item);
    }),
  ],
  [
    'press-feeds.move',
    control(move, ({ from, to }) => {
      fakePressFeeds().move(from, to);
    }),
  ],
  [
    'press-feeds.fail-next',
    control(feedFailures, ({ url, errors }) => {
      fakePressFeeds().failNext(url, errors);
    }),
  ],
  [
    'language-model.script',
    control(script, (args) => {
      fakeLanguageModel()[args.provider].script(args.article, args.part);
    }),
  ],
  [
    'language-model.fail-next',
    control(modelFailure, (args) => {
      fakeLanguageModel()[args.provider].failNext(args.error);
    }),
  ],
  [
    'language-model.slow-next',
    control(slowness, (args) => {
      fakeLanguageModel()[args.provider].slowNext(args.delayMs);
    }),
  ],
  [
    'language-model.set-fallback',
    control(fallback, ({ configured }) => {
      fakeLanguageModel().setFallback(configured);
    }),
  ],
  ['telegram.deliver', control(message, (args) => fakeTelegram().deliver(args.chat, args.text))],
  [
    'telegram.deliver-again',
    control(redelivery, ({ body }) => {
      fakeTelegram().deliverAgain(body);
    }),
  ],
  ['telegram.block', control(fromChat, (args) => fakeTelegram().block(args.chat))],
  ['telegram.inbox', control(chatId, (args) => inboxOf(args.chat))],
  [
    'telegram.fail-next',
    control(telegramFailures, ({ operation, errors }) => {
      fakeTelegram().failNext(operation, errors);
    }),
  ],
  [
    'telegram.refuse-webhooks',
    control(webhookRefusal, ({ description }) => {
      fakeTelegram().refuseWebhooks(description);
    }),
  ],
  [
    'telegram.fail-webhook-delivery',
    control(deliveryFailure, (args) => {
      fakeTelegram().failWebhookDelivery(args.message);
    }),
  ],
];
