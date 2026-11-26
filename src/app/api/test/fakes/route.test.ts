import { connection } from 'next/server';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fakeBackupStorage } from '@/lib/backup-storage';
import { fakeLanguageModel } from '@/lib/language-model';
import { fakePressFeeds } from '@/lib/press-feeds';
import { fakeTelegram } from '@/lib/telegram';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

// A connection string that the schema accepts, which a hermetic server never holds.
const DATABASE_URL = 'postgresql://app@db.example.invalid/egoscope?sslmode=verify-full';
const BACKUP_STORAGE = Symbol.for('egoscope.backup-storage.fake');
const CONTEXT = {
  deadline: toEpochMs(Date.UTC(2026, 10, 20, 9)),
  signal: new AbortController().signal,
};
const SET_PUBLIC = { control: 'backup-storage.set-private', private: false };
const LOT_2_FAKES = [
  'egoscope.press-feeds.fake',
  'egoscope.language-model.fake',
  'egoscope.telegram.fake',
];
const FEED = 'https://news.test/courtside.xml';
const CHAT = { id: 4242, type: 'private' } as const;
// An instant before the calls' deadline, at which the Lot 2 fakes, which check it, answer.
const AT = toEpochMs(Date.UTC(2026, 10, 20, 8));

/** Fresh Lot 2 fakes, at a fixed instant before the calls' deadline. */
function freshLot2Fakes(): void {
  for (const fake of LOT_2_FAKES) {
    vi.stubGlobal(Symbol.for(fake), undefined);
  }
  onTestFinished(installFakeClock(fixedClock(AT)));
}

/** What the Lot 2 fakes hold that their controls change: a feed, the fallback, the updates for polling. */
async function lot2State() {
  const feed = await fakePressFeeds().readFeed(CONTEXT, { url: FEED, knownVersion: null });
  const updates = await fakeTelegram().getUpdates(CONTEXT, { offset: null });
  return { feed: feed.ok, providers: fakeLanguageModel().providers().length, updates };
}

/** Stubs each of `variables` with its value. */
function stubVariables(variables: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
}

/** A request to the route whose body is `body`, JSON unless it is already a text. */
const command = (body: unknown) =>
  new Request('http://localhost/api/test/fakes', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** The route of a hermetic server, its environment freshly loaded. */
async function hermeticRoute() {
  vi.stubEnv('EGOSCOPE_FAKES', 'all');
  return import('./route');
}

/** Whether the process's fake backup storage says that its space is private. */
async function isPrivate(): Promise<unknown> {
  const health = await fakeBackupStorage().checkHealth(CONTEXT);
  return health.ok && health.value.private;
}

describe('POST /api/test/fakes', () => {
  beforeEach(() => {
    // The environment is read once per server process, so each test loads a fresh one.
    vi.resetModules();
    vi.stubGlobal(BACKUP_STORAGE, undefined);
  });

  it("scripts one of the server's fakes and answers the control it ran, uncached", async () => {
    const { POST } = await hermeticRoute();

    const response = await POST(command(SET_PUBLIC));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ ran: 'backup-storage.set-private' });
    await expect(isPrivate()).resolves.toBe(false);
  });

  it.each([
    [
      'a body that is no JSON',
      '{ "control": ',
      ['command: Invalid input: expected object, received null'],
    ],
    [
      'an argument of the wrong kind',
      { control: 'backup-storage.set-private', private: 'no' },
      ['command.private: Invalid input: expected boolean, received string'],
    ],
  ])('answers 400 to %s, with what is wrong, and runs nothing', async (_case, body, issues) => {
    const { POST } = await hermeticRoute();

    const response = await POST(command(body));

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toStrictEqual({ kind: 'invalid_command', issues });
    await expect(isPrivate()).resolves.toBe(true);
  });

  it.each([
    ['without fakes', {}],
    ['with fakes for some ports only', { EGOSCOPE_FAKES: 'telegram' }],
    ['with all the fakes beside a database URL', { EGOSCOPE_FAKES: 'all', DATABASE_URL }],
    [
      'with all the fakes on a production deployment',
      { EGOSCOPE_FAKES: 'all', VERCEL_ENV: 'production' },
    ],
  ])('answers 404 with an empty body outside the hermetic mode: %s', async (_case, variables) => {
    stubVariables(variables);
    const { POST } = await import('./route');

    const response = await POST(command(SET_PUBLIC));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('');
    await expect(isPrivate()).resolves.toBe(true);
  });

  it('answers what the fake answered for a control that reads it, such as the messages of a Telegram chat', async () => {
    freshLot2Fakes();
    const { POST } = await hermeticRoute();
    await POST(command({ control: 'telegram.deliver', chat: CHAT, text: 'Hi' }));
    await fakeTelegram().sendMessage(CONTEXT, { chat: CHAT.id, text: 'A new alert.' });

    const response = await POST(command({ control: 'telegram.inbox', chat: CHAT.id }));

    await expect(response.json()).resolves.toStrictEqual({
      ran: 'telegram.inbox',
      answer: [{ messageId: 3, text: 'A new alert.', sentAt: '2026-11-20T08:00:00.000Z' }],
    });
  });

  it.each([
    { control: 'press-feeds.publish', url: FEED, feed: { items: [{ title: 'A late comeback' }] } },
    { control: 'language-model.set-fallback', configured: true },
    { control: 'telegram.deliver', chat: CHAT, text: 'Hi' },
  ])(
    'answers 404 to the Lot 2 control %j outside the hermetic mode, and scripts nothing',
    async (body) => {
      freshLot2Fakes();
      const before = await lot2State();
      const { POST } = await import('./route');

      const response = await POST(command(body));

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe('');
      await expect(lot2State()).resolves.toStrictEqual(before);
      expect(before).toStrictEqual({
        feed: false,
        providers: 1,
        updates: { ok: true, value: [], call: { httpRequests: 1, messages: 0 } },
      });
    },
  );

  it('runs at request time instead of being prerendered with the environment of the build', async () => {
    const { POST } = await import('./route');

    await POST(command(SET_PUBLIC));

    expect(vi.mocked(connection)).toHaveBeenCalledOnce();
  });
});
