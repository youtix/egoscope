import { describe, expect, it, onTestFinished } from 'vitest';

import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { createFakeLanguageModel, createFakeProvider } from './fake';

import type { FakeProviderOptions, ScriptedFact } from './fake';
import type { CallContext, ClassificationRequest, ProviderOutcome } from './types';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 10, 15, 30));
const NEXT_MINUTE = toEpochMs(Date.UTC(2026, 10, 25, 10, 16));
const NEXT_DAY = toEpochMs(Date.UTC(2026, 10, 26));
const DEADLINE_MS = 10_000;
const SLOW_MS = 30;
const OVER_LONG = 'A long description. '.repeat(100);
const FACT: ScriptedFact = {
  player: 'player-7',
  type: 'public_dispute',
  confidence: 85,
  description: 'He argued with his coach after the game.',
  justification: 'The article quotes the exchange.',
  event: null,
};
const OPTIONS: FakeProviderOptions = {
  name: 'groq',
  model: 'fake-groq',
  requestCeilingTokens: 7000,
  requestsPerMinute: 2,
  requestsPerDay: 3,
  neuronRates: null,
  reportsResets: true,
};
const ids = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7', 'a-8', 'a-9', 'a-10'];
const REQUEST: ClassificationRequest = {
  staticPart: { instructions: 'Instructions.', typeSheets: 'Sheets.', doNotRepropose: 'None.' },
  articles: ids.map((id) => ({ id, text: `Text of ${id}.` })),
  schema: { name: 'classification', schema: { type: 'object' } },
};

const context = (deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal: new AbortController().signal,
});

function answerOf(outcome: ProviderOutcome) {
  return outcome.ok ? outcome.value : outcome.error.kind;
}

describe('createFakeProvider', () => {
  it('[DET-12] [DET-22] answers each article as scripted, by its identifier, in order', async () => {
    onTestFinished(installFakeClock(fixedClock(AT)));
    const provider = createFakeProvider(OPTIONS);
    provider.script('a-1', { kind: 'facts', facts: [FACT] });
    provider.script('a-2', { kind: 'facts', facts: [{ ...FACT, confidence: 40 }] });
    provider.script('a-3', { kind: 'facts', facts: [{ ...FACT, event: 'event-12' }] });
    provider.script('a-4', {
      kind: 'proposal',
      player: 'player-7',
      name: 'Bench outburst',
      definition: 'An outburst on the bench.',
    });
    provider.script('a-5', { kind: 'facts', facts: [{ ...FACT, player: 'player-99' }] });
    provider.script('a-6', { kind: 'facts', facts: [{ ...FACT, type: 'proposed_type' }] });
    provider.script('a-7', { kind: 'missing_field', fact: FACT, field: 'confidence' });
    provider.script('a-8', {
      kind: 'facts',
      facts: [{ ...FACT, description: OVER_LONG, justification: OVER_LONG }],
    });
    provider.script('a-9', {
      kind: 'facts',
      facts: [{ ...FACT, description: 'He said "never again" and « basta ».' }],
    });
    const outcome = await provider.complete(context(), REQUEST);
    const { player, type, description, justification, event } = FACT;
    const withoutConfidence = { player, type, description, justification, event };

    expect(outcome.ok && JSON.parse(outcome.value)).toStrictEqual({
      articles: [
        { article: 'a-1', facts: [FACT], proposals: [] },
        { article: 'a-2', facts: [{ ...FACT, confidence: 40 }], proposals: [] },
        { article: 'a-3', facts: [{ ...FACT, event: 'event-12' }], proposals: [] },
        {
          article: 'a-4',
          facts: [],
          proposals: [
            { player: 'player-7', name: 'Bench outburst', definition: 'An outburst on the bench.' },
          ],
        },
        { article: 'a-5', facts: [{ ...FACT, player: 'player-99' }], proposals: [] },
        { article: 'a-6', facts: [{ ...FACT, type: 'proposed_type' }], proposals: [] },
        { article: 'a-7', facts: [withoutConfidence], proposals: [] },
        {
          article: 'a-8',
          facts: [{ ...FACT, description: OVER_LONG, justification: OVER_LONG }],
          proposals: [],
        },
        {
          article: 'a-9',
          facts: [{ ...FACT, description: 'He said "never again" and « basta ».' }],
          proposals: [],
        },
        { article: 'a-10', facts: [], proposals: [] },
      ],
    });
  });

  it('[DET-22] breaks the whole answer when one article is scripted to break the schema', async () => {
    const provider = createFakeProvider(OPTIONS);
    provider.script('a-1', { kind: 'schema_breaking' });
    const outcome = await provider.complete(context(), {
      ...REQUEST,
      articles: REQUEST.articles.slice(0, 1),
    });

    expect(answerOf(outcome)).toBe('{"articles":[{"article":"a-1","facts":[]}');
  });

  it('reports its tokens, its refill instants, and refuses the calls above its minute and day limits with the delay to the next window', async () => {
    const clock = fixedClock(AT);
    onTestFinished(installFakeClock(clock));
    const provider = createFakeProvider(OPTIONS);
    const request = { ...REQUEST, articles: [] };
    const first = await provider.complete(context(), request);
    await provider.complete(context(), request);
    const third = await provider.complete(context(), request);
    clock.advance(NEXT_MINUTE - AT);
    await provider.complete(context(), request);
    const fifth = await provider.complete(context(), request);

    expect(first).toStrictEqual({
      ok: true,
      value: '{"articles":[]}',
      call: {
        httpRequests: 1,
        tokens: 16,
        neurons: 0,
        requestsResetAt: NEXT_DAY,
        tokensResetAt: NEXT_MINUTE,
      },
    });
    expect(third).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: NEXT_MINUTE - AT },
    });
    expect(fifth).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: NEXT_DAY - NEXT_MINUTE },
    });
  });

  it('[TRV-06] meets the failures injected, a refusal for quota before any limit among them, then answers again', async () => {
    const provider = createFakeProvider(OPTIONS);
    provider.failNext({ kind: 'quota_refused' });
    provider.failNext({ kind: 'schema_not_met' });
    const answers = [
      await provider.complete(context(), REQUEST),
      await provider.complete(context(), REQUEST),
      await provider.complete(context(), REQUEST),
    ].map((outcome) => outcome.ok);

    expect(answers).toStrictEqual([false, false, true]);
    expect(provider.received()).toHaveLength(3);
  });

  it('answers a slow call late, and times out at its deadline when the answer would come after it', async () => {
    onTestFinished(installFakeClock(fixedClock(AT)));
    const provider = createFakeProvider(OPTIONS);
    provider.slowNext(SLOW_MS);
    provider.slowNext(SLOW_MS);
    const late = await provider.complete(context(), REQUEST);
    const tooLate = await provider.complete(context(SLOW_MS), REQUEST);

    expect(late.ok).toBe(true);
    expect(answerOf(tooLate)).toBe('timeout');
  });

  it('ends a slow call at once as timeout when its signal cancels it, and sends nothing for a call cancelled before it began', async () => {
    const provider = createFakeProvider(OPTIONS);
    provider.slowNext(DEADLINE_MS);
    const during = new AbortController();
    const before = new AbortController();
    before.abort();
    const startedAt = now();
    const pending = provider.complete({ ...context(), signal: during.signal }, REQUEST);
    during.abort();
    const cancelled = await pending;
    const endedAt = now();
    const neverSent = await provider.complete({ ...context(), signal: before.signal }, REQUEST);

    expect(answerOf(cancelled)).toBe('timeout');
    expect(endedAt - startedAt).toBeLessThan(DEADLINE_MS);
    expect(neverSent).toStrictEqual({
      ok: false,
      error: { kind: 'timeout' },
      call: { httpRequests: 0, tokens: 0, neurons: 0, requestsResetAt: null, tokensResetAt: null },
    });
    expect(provider.received()).toHaveLength(1);
  });
});

describe('createFakeLanguageModel', () => {
  it("[DET-08] chains the primary alone until the fallback is configured, and counts the primary's neurons", async () => {
    const fakes = createFakeLanguageModel();
    const alone = fakes.providers().map(({ name }) => name);
    fakes.setFallback(true);
    const outcome = await fakes.primary.complete(context(), REQUEST);

    expect(alone).toStrictEqual(['workersAi']);
    expect(
      fakes.providers().map(({ name, requestCeilingTokens }) => [name, requestCeilingTokens]),
    ).toStrictEqual([
      ['workersAi', 131_072],
      ['groq', 7000],
    ]);
    expect(outcome).toMatchObject({
      ok: true,
      call: { neurons: 5, requestsResetAt: null, tokensResetAt: null },
    });
  });
});
