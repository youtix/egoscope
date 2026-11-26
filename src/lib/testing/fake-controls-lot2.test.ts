import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fakeLanguageModel } from '@/lib/language-model';
import { fakePressFeeds } from '@/lib/press-feeds';
import { fakeTelegram } from '@/lib/telegram';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { fakeControls, scriptFake } from './fake-controls';

const AT = toEpochMs(Date.UTC(2026, 10, 26, 8));
const AN_HOUR_MS = 3_600_000;
const CONTEXT = { deadline: toEpochMs(AT + AN_HOUR_MS), signal: new AbortController().signal };
const FAKES = [
  'egoscope.press-feeds.fake',
  'egoscope.language-model.fake',
  'egoscope.telegram.fake',
];

// Invented feeds and articles.
const FEED = 'https://news.test/courtside.xml';
const NEW_ADDRESS = 'https://news.test/courtside/feed.xml';
const STORY = {
  identifier: 'story-1',
  link: 'https://news.test/story-1',
  title: 'A late comeback',
  published: '2026-11-25',
};
const STORY_ITEM = {
  identifier: 'story-1',
  link: 'https://news.test/story-1',
  title: 'A late comeback',
  publishedAt: { kind: 'date', on: '2026-11-25' },
  updatedAt: null,
  language: null,
  originOutlet: null,
  excerpt: null,
};

const FACT = {
  player: 'player-7',
  type: 'media-storm',
  confidence: 0.82,
  description: 'Questions about a missed practice.',
  justification: 'The article quotes the coach.',
  event: null,
};
const REQUEST = {
  staticPart: { instructions: 'Classify.', typeSheets: 'Sheets.', doNotRepropose: 'None.' },
  articles: [
    { id: 'article-1', text: 'A forward missed practice.' },
    { id: 'article-2', text: 'A guard started a podcast.' },
  ],
  schema: { name: 'classification', schema: {} },
};
const ONE_REQUEST = {
  httpRequests: 1,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};

const OWNER = { id: 4242, type: 'private' } as const;
const TELEGRAM_CALL = { httpRequests: 1, messages: 0 };
// The Bot API's names of the fields of an update, and its date, in seconds.
const UPDATE_ID = 'update_id';
const MESSAGE_ID = 'message_id';
const MY_CHAT_MEMBER = 'my_chat_member';
const NEW_CHAT_MEMBER = 'new_chat_member';
const SENT_AT_SECONDS = AT / 1000;

/** What a read of the feed finds, the reader knowing the version `knownVersion`. */
const read = async (knownVersion: string | null = null) =>
  fakePressFeeds().readFeed(CONTEXT, { url: FEED, knownVersion });

/** The items that a read of the feed finds, or why it finds none. */
async function feedItems() {
  const outcome = await read();
  if (!outcome.ok) {
    return outcome.error;
  }
  return outcome.value.kind === 'read' ? outcome.value.feed.items : outcome.value;
}

/** What the language model's `provider` answers for each article of the request, or why it does not. */
async function answerOf(provider: 'primary' | 'fallback', context = CONTEXT) {
  const outcome = await fakeLanguageModel()[provider].complete(context, REQUEST);
  if (!outcome.ok) {
    return outcome;
  }
  const answer: unknown = JSON.parse(outcome.value);
  return answer;
}

/** Runs `command`, which must be a valid command, and gives what the fake answered. */
function answered(command: unknown): unknown {
  const scripted = scriptFake(command);
  if (!scripted.ok) {
    throw new Error(`An invalid command: ${scripted.error.issues.join('; ')}`);
  }
  return scripted.value.answer;
}

/** Sends `text` to `chat` as the bot does, and gives the message's identifier. */
async function sendToChat(chat: number, text: string): Promise<number> {
  const sent = await fakeTelegram().sendMessage(CONTEXT, { chat, text });
  if (!sent.ok) {
    throw new Error(`The fake refused to send to ${String(chat)}.`);
  }
  return sent.value.messageId;
}

describe('the controls of the Lot 2 fakes', () => {
  beforeEach(() => {
    for (const fake of FAKES) {
      vi.stubGlobal(Symbol.for(fake), undefined);
    }
    onTestFinished(installFakeClock(fixedClock(AT)));
  });

  it("gives the process's own Lot 2 fakes, those that the ports serve", () => {
    expect(fakeControls.pressFeeds()).toBe(fakePressFeeds());
    expect(fakeControls.languageModel()).toBe(fakeLanguageModel());
    expect(fakeControls.telegram()).toBe(fakeTelegram());
  });

  describe('the press feeds', () => {
    it('serves the feed published at an address, and answers nothing more than the control it ran', async () => {
      expect(
        scriptFake({ control: 'press-feeds.publish', url: FEED, feed: { items: [STORY] } }),
      ).toStrictEqual({ ok: true, value: { ran: 'press-feeds.publish' } });

      await expect(read()).resolves.toMatchObject({
        ok: true,
        value: { kind: 'read', feed: { language: null, items: [STORY_ITEM] }, movedTo: null },
        call: { httpRequests: 1 },
      });
    });

    it('changes the feed between two reads, dropping the oldest items beyond those it keeps', async () => {
      const older = { title: 'An older story' };
      scriptFake({
        control: 'press-feeds.publish',
        url: FEED,
        feed: { language: 'en', keeps: 2, items: [STORY, older] },
      });
      const first = await read();
      const version = first.ok && first.value.kind === 'read' ? first.value.version : null;
      await expect(read(version)).resolves.toMatchObject({ value: { kind: 'not_modified' } });

      scriptFake({ control: 'press-feeds.post', url: FEED, item: { title: 'Breaking news' } });

      await expect(read(version)).resolves.toMatchObject({
        value: {
          kind: 'read',
          feed: { language: 'en', items: [{ title: 'Breaking news', link: null }, STORY_ITEM] },
        },
      });
    });

    it('moves an address, which the next read follows to the new one', async () => {
      scriptFake({ control: 'press-feeds.publish', url: NEW_ADDRESS, feed: { items: [STORY] } });

      scriptFake({ control: 'press-feeds.move', from: FEED, to: NEW_ADDRESS });

      await expect(read()).resolves.toMatchObject({
        ok: true,
        value: { kind: 'read', movedTo: NEW_ADDRESS, feed: { items: [STORY_ITEM] } },
        call: { httpRequests: 2 },
      });
    });

    it('fails the next reads of an address, one failure each, then serves the feed again', async () => {
      scriptFake({ control: 'press-feeds.publish', url: FEED, feed: { items: [STORY] } });

      scriptFake({
        control: 'press-feeds.fail-next',
        url: FEED,
        errors: [{ kind: 'unreachable' }, { kind: 'http_error', status: 503 }],
      });

      await expect(feedItems()).resolves.toStrictEqual({ kind: 'unreachable' });
      await expect(feedItems()).resolves.toStrictEqual({ kind: 'http_error', status: 503 });
      await expect(feedItems()).resolves.toStrictEqual([STORY_ITEM]);
    });
  });

  describe('the language model', () => {
    it('scripts what each provider answers per article, an article without a script having no fact', async () => {
      scriptFake({
        control: 'language-model.script',
        provider: 'primary',
        article: 'article-1',
        part: { kind: 'facts', facts: [FACT] },
      });
      scriptFake({
        control: 'language-model.script',
        provider: 'fallback',
        article: 'article-2',
        part: {
          kind: 'proposal',
          player: 'player-9',
          name: 'Side project',
          definition: 'A venture.',
        },
      });

      await expect(answerOf('primary')).resolves.toStrictEqual({
        articles: [
          { article: 'article-1', facts: [FACT], proposals: [] },
          { article: 'article-2', facts: [], proposals: [] },
        ],
      });
      await expect(answerOf('fallback')).resolves.toStrictEqual({
        articles: [
          { article: 'article-1', facts: [], proposals: [] },
          {
            article: 'article-2',
            facts: [],
            proposals: [{ player: 'player-9', name: 'Side project', definition: 'A venture.' }],
          },
        ],
      });
    });

    it('scripts a fact without one of its fields', async () => {
      scriptFake({
        control: 'language-model.script',
        provider: 'primary',
        article: 'article-2',
        part: { kind: 'missing_field', fact: FACT, field: 'justification' },
      });

      await expect(answerOf('primary')).resolves.toStrictEqual({
        articles: [
          { article: 'article-1', facts: [], proposals: [] },
          {
            article: 'article-2',
            facts: [
              {
                player: 'player-7',
                type: 'media-storm',
                confidence: 0.82,
                description: 'Questions about a missed practice.',
                event: null,
              },
            ],
            proposals: [],
          },
        ],
      });
    });

    it.each([
      ['a refusal for quota before the declared limit', 'primary', { kind: 'quota_refused' }],
      [
        'the limit of the minute, until the next one',
        'primary',
        { kind: 'rate_limited', retryAfterMs: 15_000 },
      ],
      [
        'the limit of the day, until the next one',
        'fallback',
        { kind: 'rate_limited', retryAfterMs: 57_600_000 },
      ],
    ] as const)('refuses the next call with %s, then answers', async (_case, provider, error) => {
      scriptFake({ control: 'language-model.fail-next', provider, error });

      await expect(answerOf(provider)).resolves.toStrictEqual({
        ok: false,
        error,
        call: ONE_REQUEST,
      });
      await expect(answerOf(provider)).resolves.toHaveProperty('articles');
    });

    it('answers the next call late, a timeout when its deadline comes first', async () => {
      const deadline = { ...CONTEXT, deadline: toEpochMs(AT + 10) };
      scriptFake({ control: 'language-model.slow-next', provider: 'primary', delayMs: 50 });

      await expect(answerOf('primary', deadline)).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'timeout' },
        call: ONE_REQUEST,
      });
      scriptFake({ control: 'language-model.slow-next', provider: 'primary', delayMs: 5 });
      await expect(answerOf('primary', deadline)).resolves.toHaveProperty('articles');
    });

    it('configures the fallback, then leaves it out again, as GROQ_API_KEY does', () => {
      const { primary, fallback } = fakeLanguageModel();

      scriptFake({ control: 'language-model.set-fallback', configured: true });
      expect(fakeLanguageModel().providers()).toStrictEqual([primary, fallback]);

      scriptFake({ control: 'language-model.set-fallback', configured: false });
      expect(fakeLanguageModel().providers()).toStrictEqual([primary]);
    });
  });

  describe('Telegram', () => {
    it.each([
      { from: 'a private chat', chat: OWNER, text: '/start Z2V0LWEtY29kZQ', kind: 'start' },
      { from: 'a group', chat: { id: -100_777, type: 'group' }, text: 'Hello, bot', kind: 'other' },
      {
        from: 'a stranger',
        chat: { id: 9191, type: 'private' },
        text: 'Who are you?',
        kind: 'other',
      },
    ] as const)(
      'delivers an update from $from, answering its body, which polling then reads',
      async ({ chat, text, kind }) => {
        expect(answered({ control: 'telegram.deliver', chat, text })).toStrictEqual({
          [UPDATE_ID]: 2,
          message: { [MESSAGE_ID]: 1, text, chat, date: SENT_AT_SECONDS },
        });

        const updates = await fakeTelegram().getUpdates(CONTEXT, { offset: null });
        expect(updates).toMatchObject({ ok: true, value: [{ kind, updateId: 2, chat }] });
      },
    );

    it('delivers an update again, which polling then reads a second time', async () => {
      const body = answered({ control: 'telegram.deliver', chat: OWNER, text: 'Hi' });

      scriptFake({ control: 'telegram.deliver-again', body });

      const updates = await fakeTelegram().getUpdates(CONTEXT, { offset: null });
      const update = { kind: 'other', updateId: 2, chat: OWNER };
      expect(updates).toStrictEqual({ ok: true, value: [update, update], call: TELEGRAM_CALL });
    });

    it('reads the messages that a chat holds, oldest first, and none of a chat that never wrote', async () => {
      scriptFake({ control: 'telegram.deliver', chat: OWNER, text: 'Hi' });
      const first = await sendToChat(OWNER.id, 'A new alert.');
      const second = await sendToChat(OWNER.id, 'A <b>second</b> alert.');

      expect(scriptFake({ control: 'telegram.inbox', chat: OWNER.id })).toStrictEqual({
        ok: true,
        value: {
          ran: 'telegram.inbox',
          answer: [
            { messageId: first, text: 'A new alert.', sentAt: '2026-11-26T08:00:00.000Z' },
            {
              messageId: second,
              text: 'A <b>second</b> alert.',
              sentAt: '2026-11-26T08:00:00.000Z',
            },
          ],
        },
      });
      expect(answered({ control: 'telegram.inbox', chat: 9191 })).toStrictEqual([]);
    });

    it('blocks the bot from a chat, answering the update, after which every send fails as blocked', async () => {
      scriptFake({ control: 'telegram.deliver', chat: OWNER, text: 'Hi' });

      expect(answered({ control: 'telegram.block', chat: OWNER })).toStrictEqual({
        [UPDATE_ID]: 3,
        [MY_CHAT_MEMBER]: {
          [NEW_CHAT_MEMBER]: { status: 'kicked' },
          chat: OWNER,
          date: SENT_AT_SECONDS,
        },
      });

      const sent = await fakeTelegram().sendMessage(CONTEXT, { chat: OWNER.id, text: 'An alert.' });
      expect(sent).toStrictEqual({ ok: false, error: { kind: 'blocked' }, call: TELEGRAM_CALL });
    });

    it('fails the next calls of an operation, a temporary failure then a permanent one, then sends', async () => {
      scriptFake({ control: 'telegram.deliver', chat: OWNER, text: 'Hi' });

      scriptFake({
        control: 'telegram.fail-next',
        operation: 'sendMessage',
        errors: [{ kind: 'rate_limited', retryAfterMs: 3000 }, { kind: 'chat_not_found' }],
      });

      const send = async () =>
        fakeTelegram().sendMessage(CONTEXT, { chat: OWNER.id, text: 'An alert.' });
      await expect(send()).resolves.toMatchObject({
        error: { kind: 'rate_limited', retryAfterMs: 3000 },
      });
      await expect(send()).resolves.toMatchObject({ error: { kind: 'chat_not_found' } });
      await expect(send()).resolves.toMatchObject({ ok: true });
    });

    it('refuses the next deletion of a message, which the one after deletes', async () => {
      scriptFake({ control: 'telegram.deliver', chat: OWNER, text: 'Hi' });
      const messageId = await sendToChat(OWNER.id, 'A new alert.');

      scriptFake({
        control: 'telegram.fail-next',
        operation: 'deleteMessage',
        errors: [{ kind: 'delete_refused' }],
      });

      const remove = async () =>
        fakeTelegram().deleteMessage(CONTEXT, { chat: OWNER.id, messageId });
      await expect(remove()).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'delete_refused' },
        call: TELEGRAM_CALL,
      });
      await expect(remove()).resolves.toMatchObject({ ok: true, value: { kind: 'deleted' } });
    });

    it('refuses every webhook registration until told otherwise, and reports a failed delivery', async () => {
      const registration = { url: 'https://app.test/api/telegram', secretToken: 'test-secret' };
      const register = async () => fakeTelegram().setWebhook(CONTEXT, registration);

      scriptFake({ control: 'telegram.refuse-webhooks', description: 'Bad Request: bad webhook' });
      await expect(register()).resolves.toMatchObject({
        value: { kind: 'refused', description: 'Bad Request: bad webhook' },
      });
      scriptFake({ control: 'telegram.refuse-webhooks', description: null });
      await expect(register()).resolves.toMatchObject({ value: { kind: 'registered' } });

      scriptFake({ control: 'telegram.fail-webhook-delivery', message: 'Connection refused' });
      await expect(fakeTelegram().getWebhookInfo(CONTEXT)).resolves.toMatchObject({
        value: { lastError: { at: AT, message: 'Connection refused' } },
      });
    });
  });

  it.each([
    [
      { control: 'press-feeds.post', url: FEED, item: { published: 'yesterday' } },
      ['command.item.published: Expected a date as a feed writes it, in RFC 822 or ISO 8601.'],
    ],
    [
      { control: 'press-feeds.publish', url: FEED, feed: { keeps: 0, items: [] } },
      ['command.feed.keeps: Too small: expected number to be >0'],
    ],
    [
      { control: 'press-feeds.fail-next', url: FEED, errors: [] },
      ['command.errors: Too small: expected array to have >=1 items'],
    ],
    [
      { control: 'language-model.set-fallback', configured: 'yes' },
      ['command.configured: Invalid input: expected boolean, received string'],
    ],
    [
      { control: 'language-model.fail-next', provider: 'third', error: { kind: 'timeout' } },
      ['command.provider: Invalid option: expected one of "primary"|"fallback"'],
    ],
    [
      { control: 'language-model.fail-next', provider: 'primary', error: { kind: 'rate_limited' } },
      ['command.error.retryAfterMs: Invalid input: expected number, received undefined'],
    ],
    [
      { control: 'telegram.deliver', chat: { id: 7, type: 'bot' }, text: 'Hi' },
      [
        'command.chat.type: Invalid option: expected one of "private"|"group"|"supergroup"|"channel"',
      ],
    ],
    [
      { control: 'telegram.fail-next', operation: 'parseUpdate', errors: [{ kind: 'blocked' }] },
      [
        'command.operation: Invalid option: expected one of "checkHealth"|"getMe"|"sendMessage"|"deleteMessage"|"setWebhook"|"getWebhookInfo"|"deleteWebhook"|"getUpdates"',
      ],
    ],
  ])('runs nothing for an invalid command %j, and says what is wrong', async (command, issues) => {
    expect(scriptFake(command)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid_command', issues },
    });
    await expect(feedItems()).resolves.toStrictEqual({ kind: 'unreachable' });
    expect(fakeLanguageModel().providers()).toHaveLength(1);
    await expect(fakeTelegram().getUpdates(CONTEXT, { offset: null })).resolves.toMatchObject({
      value: [],
    });
  });
});
