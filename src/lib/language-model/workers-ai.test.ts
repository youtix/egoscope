import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '@/lib/env';
import { ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';
import answer from '@data/fixtures/language-model/workers-ai/answer.json';
import failures from '@data/fixtures/language-model/workers-ai/failures.json';
import sentBody from '@data/fixtures/language-model/workers-ai/request.json';

import { createChain } from './chain';
import { LANGUAGE_MODEL_CONTRACT } from './contract';
import { createWorkersAiProvider } from './workers-ai';

import type { ContractFault, ProviderHarness } from './contract';
import type { CallContext, CallMetadata, ClassificationRequest } from './types';
import type { Secret } from '@/lib/env';

const MODEL = '@cf/zai-org/glm-4.7-flash';
const ACCOUNT = 'fixture-account';
const TOKEN = 'made-up-workers-ai-token';
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;
const DEADLINE_MS = 10_000;
const SHORT_DEADLINE_MS = 20;
const LATENESS_MS = 1000;
const ONE_REQUEST: CallMetadata = {
  httpRequests: 1,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};
const REQUEST: ClassificationRequest = {
  staticPart: {
    instructions: 'Report the facts that each article tells of each recognized player.',
    typeSheets: 'Type public_dispute: a public argument with a coach or a teammate.',
    doNotRepropose: 'Do not repropose: late_arrival.',
  },
  articles: [
    { id: 'article-1', text: 'Tobias Quillfeather argues with his coach on the bench.' },
    { id: 'article-2', text: 'Marlo Vantreese scores 31 points in a home win.' },
  ],
  schema: {
    name: 'classification',
    schema: { type: 'object', required: ['articles'], additionalProperties: false },
  },
};

/** A recorded answer of Workers AI: its status, its headers and its body. */
type Recorded = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}>;

/** What the replay answers to the next call: a recorded answer, no answer before the abort, or a lost connection. */
type Turn = Recorded | 'hang' | 'connection_lost';

/** The made-up token as the configuration gives it. */
function secret(): Secret {
  const parsed = parseServerEnv({ CLOUDFLARE_AI_API_TOKEN: TOKEN });
  const token = parsed.ok ? parsed.env.CLOUDFLARE_AI_API_TOKEN : undefined;
  if (token === undefined) {
    throw new Error('The test token does not parse.');
  }
  return token;
}

const replayed = ({ status, headers, body }: Recorded): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

async function hang(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(new DOMException('The call ended.', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** A Workers AI that plays the recorded answers, the turns queued first, then the recorded answer. */
function replay() {
  const turns: Turn[] = [];
  const sent: Readonly<{ url: string; method: string; headers: Headers; body: string }>[] = [];
  const fetchReplay: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const { url, method, headers, signal } = request;
    sent.push({ url, method, headers, body: await request.text() });
    const turn = turns.shift() ?? answer;
    if (turn === 'connection_lost') {
      throw new TypeError('fetch failed');
    }
    return turn === 'hang' ? hang(signal) : replayed(turn);
  };
  const created = createWorkersAiProvider({
    accountId: ACCOUNT,
    token: secret(),
    model: MODEL,
    fetch: fetchReplay,
  });
  if (!created.ok) {
    throw new Error('The known model is refused.');
  }
  return { provider: created.value, turns, sent };
}

const context = (deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal: new AbortController().signal,
});

async function outcomeAfter(turn: Turn) {
  const { provider, turns } = replay();
  turns.push(turn);
  return provider.complete(context(), REQUEST);
}

const withRetryAfter = (recorded: Recorded, seconds: string): Recorded => ({
  ...recorded,
  headers: { ...recorded.headers, 'retry-after': seconds },
});

describe('createWorkersAiProvider', () => {
  it('[TRV-16] [DET-14] [DET-12] sends the static part first, the articles after it and the JSON schema in strict mode, and nothing else', async () => {
    const { provider, sent } = replay();
    await provider.complete(context(), REQUEST);

    expect(sent.map(({ url, method }) => [url, method])).toStrictEqual([[ENDPOINT, 'POST']]);
    expect(sent[0]?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(sent[0]?.body ?? '')).toStrictEqual(sentBody);
    expect(sentBody.messages.map(({ content }) => content)).toStrictEqual([
      [
        'Report the facts that each article tells of each recognized player.',
        'Type public_dispute: a public argument with a coach or a teammate.',
        'Do not repropose: late_arrival.',
      ].join('\n\n'),
      JSON.stringify({ articles: REQUEST.articles }),
    ]);
  });

  it('[DET-53] returns the raw answer with the model ID, its tokens without the cached ones and the neurons of the published rates', async () => {
    const { provider } = replay();
    const result = await createChain([provider]).classify(context(), REQUEST, {
      budget: async (_name, call) => ok(await call()),
      validate: ({ raw }) => ok(raw),
      attempts: 1,
    });

    expect([provider.name, provider.requestCeilingTokens]).toStrictEqual(['workersAi', 131_072]);
    expect(result.ok && result.answer).toStrictEqual({
      raw: answer.body.result.choices[0]?.message.content,
      provider: 'workersAi',
      model: MODEL,
      // 5,412 input tokens at 5,500 and 588 output tokens at 36,400 a million: 51.2 neurons.
      call: { ...ONE_REQUEST, tokens: 1904, neurons: 52 },
    });
  });

  it('counts the neurons of every answer at the rates of glm-4.7-flash, rounded up, and its tokens without the cached ones', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 131_072 }),
        fc.nat({ max: 131_072 }),
        fc.nat({ max: 131_072 }),
        async (input, output, cachedDraw) => {
          const cached = Math.min(cachedDraw, input);
          const { result } = answer.body;
          // Workers AI's own keys, in snake_case.
          const usage = Object.fromEntries<unknown>([
            ['prompt_tokens', input],
            ['completion_tokens', output],
            ['total_tokens', input + output],
            ['prompt_tokens_details', Object.fromEntries<number>([['cached_tokens', cached]])],
          ]);
          const withUsage = Object.fromEntries<unknown>([
            ...Object.entries(result),
            ['usage', usage],
          ]);
          const body = Object.fromEntries<unknown>([
            ...Object.entries(answer.body),
            ['result', withUsage],
          ]);
          const outcome = await outcomeAfter({ ...answer, body });
          const exact = (input * 5500 + output * 36_400) / 1_000_000;

          expect(outcome.call.tokens).toBe(input + output - cached);
          expect(outcome.call.neurons).toBeGreaterThanOrEqual(exact);
          expect(outcome.call.neurons - exact).toBeLessThan(1);
          expect(Number.isSafeInteger(outcome.call.neurons)).toBe(true);
        },
      ),
    );
  });

  it('maps an answer that holds no JSON, or no content, and the refusal of JSON mode to schema_not_met', async () => {
    const outcomes = [
      await outcomeAfter(failures.prose_answer),
      await outcomeAfter(failures.no_content),
      await outcomeAfter(failures.json_mode_not_met),
    ];

    expect(outcomes).toStrictEqual([
      {
        ok: false,
        error: { kind: 'schema_not_met' },
        call: { ...ONE_REQUEST, tokens: 5433, neurons: 31 },
      },
      {
        ok: false,
        error: { kind: 'schema_not_met' },
        call: { ...ONE_REQUEST, tokens: 6412, neurons: 67 },
      },
      { ok: false, error: { kind: 'schema_not_met' }, call: ONE_REQUEST },
    ]);
  });

  it('[TRV-06] maps the daily neuron allowance used up to quota_refused, and another 429 to rate_limited with its retry-after or a minute', async () => {
    const errors = [
      await outcomeAfter(failures.neurons_used_up),
      await outcomeAfter(failures.out_of_capacity),
      await outcomeAfter(withRetryAfter(failures.out_of_capacity, '12')),
      await outcomeAfter(withRetryAfter(failures.out_of_capacity, '0')),
    ].map((outcome) => !outcome.ok && outcome.error);

    expect(errors).toStrictEqual([
      { kind: 'quota_refused' },
      { kind: 'rate_limited', retryAfterMs: 60_000 },
      { kind: 'rate_limited', retryAfterMs: 12_000 },
      { kind: 'rate_limited', retryAfterMs: 60_000 },
    ]);
  });

  it('maps server errors, refused credentials and a lost connection to unavailable, a 408 to timeout and an unreadable answer to malformed', async () => {
    const outcomes = [
      await outcomeAfter(failures.server_error),
      await outcomeAfter(failures.bad_token),
      await outcomeAfter('connection_lost'),
      await outcomeAfter(failures.request_timeout),
      await outcomeAfter({ ...answer, body: 'not json' }),
      await outcomeAfter({ ...answer, body: { ...answer.body, result: { choices: [] } } }),
    ];

    expect(outcomes).toStrictEqual(
      ['unavailable', 'unavailable', 'unavailable', 'timeout', 'malformed', 'malformed'].map(
        (kind) => ({ ok: false, error: { kind }, call: ONE_REQUEST }),
      ),
    );
  });

  it('answers timeout at the deadline, and sends nothing once the deadline has come or the call is cancelled', async () => {
    const { provider, turns, sent } = replay();
    turns.push('hang');
    const ctx = context(SHORT_DEADLINE_MS);
    const late = await provider.complete(ctx, REQUEST);
    const endedAt = now();
    const cancelled = new AbortController();
    cancelled.abort();
    const afterDeadline = await provider.complete(context(-1), REQUEST);
    const afterCancel = await provider.complete(
      { ...context(), signal: cancelled.signal },
      REQUEST,
    );

    expect(late).toStrictEqual({ ok: false, error: { kind: 'timeout' }, call: ONE_REQUEST });
    expect(endedAt).toBeLessThanOrEqual(ctx.deadline + LATENESS_MS);
    expect([afterDeadline, afterCancel]).toStrictEqual([
      { ok: false, error: { kind: 'timeout' }, call: { ...ONE_REQUEST, httpRequests: 0 } },
      { ok: false, error: { kind: 'timeout' }, call: { ...ONE_REQUEST, httpRequests: 0 } },
    ]);
    expect(sent).toHaveLength(1);
  });

  it('[TRV-64] writes the token in the authorization header alone, never in another header, the address, the body or an outcome', async () => {
    const played: readonly Turn[] = [answer, ...Object.values(failures), 'connection_lost', 'hang'];
    const calls = await Promise.all(
      played.map(async (turn) => {
        const { provider, turns, sent } = replay();
        turns.push(turn);
        const deadlineMs = turn === 'hang' ? SHORT_DEADLINE_MS : DEADLINE_MS;
        const outcome = await provider.complete(context(deadlineMs), REQUEST);
        return { sent, outcome };
      }),
    );
    const sent = calls.flatMap((call) => call.sent);

    expect(sent.map(({ headers }) => Object.fromEntries(headers))).toStrictEqual(
      played.map(() => ({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' })),
    );
    expect(
      JSON.stringify([
        sent.map(({ url, body }) => [url, body]),
        calls.map(({ outcome }) => outcome),
      ]),
    ).not.toContain(TOKEN);
  });

  it('refuses at configuration a model whose neuron rates it does not know', () => {
    const created = createWorkersAiProvider({
      accountId: ACCOUNT,
      token: secret(),
      model: '@cf/meta/llama-3.1-8b-instruct',
      fetch,
    });

    expect(created).toStrictEqual({
      ok: false,
      error: { kind: 'unknown_model', model: '@cf/meta/llama-3.1-8b-instruct' },
    });
  });
});

/** The adapter on the recorded answers, each fault met by its recorded refusal. */
function recordedHarness(): ProviderHarness {
  const { provider, turns } = replay();
  const faults: Readonly<Record<ContractFault, Turn>> = {
    quotaRefused: failures.neurons_used_up,
    minuteLimit: failures.out_of_capacity,
    slow: 'hang',
  };
  return {
    provider,
    inject: (fault) => {
      turns.push(faults[fault]);
    },
  };
}

describe('the Workers AI adapter against the language-model contract', () => {
  it.each(Object.entries(LANGUAGE_MODEL_CONTRACT))('%s', async (_title, run) => {
    const { observed, promised } = await run(recordedHarness());

    expect(observed).toStrictEqual(promised);
  });
});
