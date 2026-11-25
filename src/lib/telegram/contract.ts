// The behavior every adapter of the Telegram port shares (module map §2.3, §5): the
// port's own tests run each case against the fake, and against the recorded answers
// of each real adapter, and expect it to find no problem. A case returns the problems
// it finds, each naming its offenders, so that a failure says what an adapter got
// wrong. Never re-exported by index.ts.
import { now, toEpochMs } from '@/lib/time';

import { MY_CHAT_MEMBER, UPDATE_ID } from './inbound';
import { MESSAGE_MAX_LENGTH, WEBHOOK_SETTINGS } from './types';

import type { CallContext, Telegram, TelegramOutcome } from './types';

/** An adapter under test, the chats it knows and what its people do. */
export type TelegramHarness = Readonly<{
  bot: Telegram;
  /** A private chat that wrote to the bot, and a chat that never did. */
  chat: number;
  unknownChat: number;
  /** The person of `chat` writes `text` to the bot, which keeps the update for polling. */
  write: (text: string) => Promise<void>;
  /** Sends `chat` a message that is 48 hours old or more once it returns, and gives its id. */
  sendOld: () => Promise<number | null>;
}>;

type Problems = readonly string[];

/** One behavior of the contract: its title, and the problems that an adapter shows against it. */
type ContractCase = Readonly<{
  title: string;
  check: (harness: TelegramHarness) => Promise<Problems>;
}>;

// A deadline that no answer under test comes near.
const DEADLINE_MS = 10_000;
const BOT_USERNAME = /^\w{2,29}bot$/iu;
const WEBHOOK_URL = 'https://egoscope.example.test/api/telegram/webhook';
const SECRET = 'contract-secret_0123456789';
const LINK_CODE = 'Zm9yLXRoZS1jb250cmFjdA';
const PRIVATE_CHAT_ID = 4242;
const GROUP_CHAT_ID = -1_004_242;
const PRIVATE_CHAT = { id: PRIVATE_CHAT_ID, type: 'private' } as const;
const GROUP_CHAT = { id: GROUP_CHAT_ID, type: 'group' } as const;
const FIRST_UPDATE_ID = 7;

const context = (signal: AbortSignal): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal,
});

const open = (): CallContext => context(new AbortController().signal);

const problem = (rule: string, offenders: readonly unknown[]): Problems =>
  offenders.length === 0 ? [] : [`${rule}: ${JSON.stringify(offenders)}`];

/** What a call told, its cost left out: the value of a success, the error kind of a failure. */
const told = (outcome: TelegramOutcome<unknown>): unknown =>
  outcome.ok ? outcome.value : outcome.error.kind;

/** `value` written with the keys of each object in order, so that two equal values write alike. */
const written = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).toSorted(([one], [other]) => (one < other ? -1 : 1)),
        )
      : inner,
  );

/** The rule `rule` when what was observed is not what the port promises. */
const unlike = (rule: string, observed: unknown, promised: unknown): Problems =>
  problem(rule, written(observed) === written(promised) ? [] : [{ observed, promised }]);

async function checksHealth({ bot }: TelegramHarness): Promise<Problems> {
  const outcome = await bot.checkHealth(open());
  return unlike(
    'health not checked in one request',
    [told(outcome), outcome.call.httpRequests],
    [null, 1],
  );
}

async function namesBot({ bot }: TelegramHarness): Promise<Problems> {
  const outcome = await bot.getMe(open());
  const username = outcome.ok ? outcome.value.username : '';
  return problem('no bot username', BOT_USERNAME.test(username) ? [] : [told(outcome)]);
}

async function sendsThenDeletes({ bot, chat }: TelegramHarness): Promise<Problems> {
  const sent = await bot.sendMessage(open(), { chat, text: '<b>Egoscope</b> &amp; you' });
  const messageId = sent.ok ? sent.value.messageId : 0;
  const deleted = await bot.deleteMessage(open(), { chat, messageId });
  const again = await bot.deleteMessage(open(), { chat, messageId });
  return unlike(
    'messages not sent as one counted message, then deleted, then not found',
    [sent.ok, sent.call, told(deleted), deleted.call, told(again)],
    [
      true,
      { httpRequests: 1, messages: 1 },
      { kind: 'deleted' },
      { httpRequests: 1, messages: 0 },
      { kind: 'not_found' },
    ],
  );
}

async function refusesOldDeletion({ bot, chat, sendOld }: TelegramHarness): Promise<Problems> {
  const messageId = (await sendOld()) ?? 0;
  const outcome = await bot.deleteMessage(open(), { chat, messageId });
  return unlike('a message 48 hours old deleted', told(outcome), 'delete_refused');
}

async function limitsLength({ bot, chat, unknownChat }: TelegramHarness): Promise<Problems> {
  const longest = 'a'.repeat(MESSAGE_MAX_LENGTH);
  const answers = [
    await bot.sendMessage(open(), { chat, text: `<i>${longest}</i>` }),
    await bot.sendMessage(open(), { chat, text: `${longest}a` }),
    await bot.sendMessage(open(), { chat: unknownChat, text: 'Hello' }),
  ];
  return unlike(
    'texts not refused over the limit, or chats not refused that never wrote to the bot',
    answers.map((outcome) => (outcome.ok ? 'sent' : outcome.error.kind)),
    ['sent', 'too_long', 'chat_not_found'],
  );
}

async function registersWebhook({ bot }: TelegramHarness): Promise<Problems> {
  const registered = told(await bot.setWebhook(open(), { url: WEBHOOK_URL, secretToken: SECRET }));
  const info = await bot.getWebhookInfo(open());
  const polled = told(await bot.getUpdates(open(), { offset: null }));
  const checks = [null, SECRET, `${SECRET}x`].map((header) => bot.verifyWebhookSecret(header));
  await bot.deleteWebhook(open());
  const after = await bot.getWebhookInfo(open());
  return unlike(
    'webhook not registered with the settings of the sheet and its secret, then deleted',
    {
      registered,
      info: info.ok && [info.value.url, info.value.maxConnections, info.value.allowedUpdates],
      polled,
      checks,
      after: after.ok && after.value.url,
    },
    {
      registered: { kind: 'registered' },
      info: [WEBHOOK_URL, WEBHOOK_SETTINGS.maxConnections, WEBHOOK_SETTINGS.allowedUpdates],
      polled: 'webhook_conflict',
      checks: [false, true, false],
      after: null,
    },
  );
}

async function pollsFromOffset({ bot, write }: TelegramHarness): Promise<Problems> {
  await write(`/start ${LINK_CODE}`);
  await write('Hello');
  const all = await bot.getUpdates(open(), { offset: null });
  const ids = all.ok ? all.value.map(({ updateId }) => updateId) : [];
  const fromSecond = await bot.getUpdates(open(), { offset: ids[1] ?? 0 });
  const afterConfirmation = await bot.getUpdates(open(), { offset: null });
  const idsOf = (outcome: typeof all): unknown =>
    outcome.ok ? outcome.value.map(({ updateId }) => updateId) : outcome.error.kind;
  return unlike(
    'updates not read from the oldest kept, or from the offset, confirming those below it',
    [all.ok && all.value.map(({ kind }) => kind), idsOf(fromSecond), idsOf(afterConfirmation)],
    [['start', 'other'], ids.slice(1), ids.slice(1)],
  );
}

// The contents of the updates that the parsing case reads, numbered from
// FIRST_UPDATE_ID, and what the port reads in each.
const UPDATE_CONTENTS = [
  { message: { chat: PRIVATE_CHAT, text: `/start ${LINK_CODE}` } },
  { message: { chat: GROUP_CHAT, text: `/start@egoscope_bot ${LINK_CODE}` } },
  { message: { chat: PRIVATE_CHAT, text: '/start' } },
  { [MY_CHAT_MEMBER]: { chat: PRIVATE_CHAT } },
  { message: { chat: { id: PRIVATE_CHAT_ID, type: 'secret' } } },
];
const READ_UPDATES = [
  { kind: 'start', chat: PRIVATE_CHAT, linkCode: LINK_CODE },
  { kind: 'start', chat: GROUP_CHAT, linkCode: LINK_CODE },
  { kind: 'other', chat: PRIVATE_CHAT },
  { kind: 'other', chat: PRIVATE_CHAT },
  { kind: 'other', chat: null },
];

async function parsesUpdates({ bot }: TelegramHarness): Promise<Problems> {
  // Reading an update calls nothing out, unlike the other cases.
  await Promise.resolve();
  return unlike(
    'updates not read as a /start with its code, or as anything else, with their chat',
    [
      ...UPDATE_CONTENTS.map((content, index) =>
        bot.parseUpdate({ ...content, [UPDATE_ID]: FIRST_UPDATE_ID + index }),
      ),
      bot.parseUpdate({ message: { chat: PRIVATE_CHAT, text: 'Hello' } }),
    ],
    [
      ...READ_UPDATES.map((update, index) => ({
        ok: true,
        update: { ...update, updateId: FIRST_UPDATE_ID + index },
      })),
      { ok: false, error: { kind: 'not_an_update' } },
    ],
  );
}

async function stopsOnceAborted({ bot, chat }: TelegramHarness): Promise<Problems> {
  const controller = new AbortController();
  controller.abort();
  const ctx = context(controller.signal);
  const outcomes = await Promise.all([
    bot.checkHealth(ctx),
    bot.getMe(ctx),
    bot.sendMessage(ctx, { chat, text: 'Hello' }),
    bot.deleteMessage(ctx, { chat, messageId: 1 }),
    bot.setWebhook(ctx, { url: WEBHOOK_URL, secretToken: SECRET }),
    bot.getWebhookInfo(ctx),
    bot.deleteWebhook(ctx),
    bot.getUpdates(ctx, { offset: null }),
  ]);
  return problem(
    'calls whose signal aborted not answered timeout without a request',
    outcomes
      .map((outcome, index) => ({
        index,
        answer: told(outcome),
        requests: outcome.call.httpRequests,
      }))
      .filter(({ answer, requests }) => answer !== 'timeout' || requests !== 0),
  );
}

/** The contract of the Telegram port: each case finds no problem in a sound adapter. */
export const TELEGRAM_CONTRACT: readonly ContractCase[] = [
  { title: 'checks its health with one request', check: checksHealth },
  { title: 'names the bot, for the deep link', check: namesBot },
  {
    title: 'sends a message as one counted message, deletes it, then finds it no more',
    check: sendsThenDeletes,
  },
  { title: 'refuses to delete a message sent 48 hours ago or more', check: refusesOldDeletion },
  {
    title:
      'sends a text of 4,096 characters once its tags are read, and refuses a longer one or a chat that never wrote',
    check: limitsLength,
  },
  {
    title:
      'registers the webhook with its settings and secret, refuses polling meanwhile, then deletes it',
    check: registersWebhook,
  },
  {
    title: 'polls from the oldest update kept without an offset, and from the offset with one',
    check: pollsFromOffset,
  },
  {
    title: 'reads a /start with its code from any chat, and anything else with its chat',
    check: parsesUpdates,
  },
  {
    title: 'answers timeout without a request to every call once the signal has aborted',
    check: stopsOnceAborted,
  },
];
