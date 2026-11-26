import { describe, expect, it, onTestFinished } from 'vitest';

import { parseServerEnv } from '@/lib/env';
import { err, ok } from '@/lib/result';
import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';
import completion from '@data/fixtures/language-model/groq/completion.json';
import errors from '@data/fixtures/language-model/groq/errors.json';
import recordedRequest from '@data/fixtures/language-model/groq/request.json';

import { createChain } from './chain';
import { LANGUAGE_MODEL_CONTRACT } from './contract';
import { createFakeLanguageModel } from './fake';
import {
  GROQ_ENDPOINT,
  GROQ_MAX_OUTPUT_TOKENS,
  GROQ_REQUEST_CEILING_TOKENS,
  groqProviders,
} from './groq';
import { messagesOf } from './types';

import type { ContractFault, ProviderHarness } from './contract';
import type {
  Budget,
  CallContext,
  ClassificationRequest,
  LanguageModelProvider,
  ProviderOutcome,
} from './types';
import type { Secret } from '@/lib/env';

/** A recorded answer: its status, its headers and its body. */
type Recorded = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}>;

/** What the next request meets: a recorded answer, an answer that never comes, or a lost connection. */
type Next = Recorded | 'slow' | 'lost';

/** A request that the replay received, with its body as sent. */
type Seen = Readonly<{ url: string; headers: Headers; text: string }>;

// An invented key, which no secret-scan rule takes for a real one.
const KEY = 'invented-groq-key-for-tests';
const MODEL = 'openai/gpt-oss-120b';
const AT = toEpochMs(Date.UTC(2026, 10, 26, 16, 30));
const DEADLINE_MS = 10_000;
const SHORT_DEADLINE_MS = 20;
// The reset instants of the recorded answers: `2m52.8s`, `12.15s` and `1h26m24s`.
const REQUESTS_RESET_MS = 172_800;
const TOKENS_RESET_MS = 12_150;
const REQUESTS_A_DAY_RESET_MS = 5_184_000;
const MINUTE_RETRY_MS = 7000;
// The recorded answer's 1,520 prompt tokens without its 1,280 cached ones, and its 140 output tokens.
const UNCACHED_TOKENS = 380;
// Its prompt and output tokens, when it reports no cached ones.
const WHOLE_TOKENS = 1660;
// The ceiling of the detection-model sheet, and the rough rule by which the provider counts tokens.
const SHEET_CEILING_TOKENS = 7000;
const CHARS_PER_TOKEN = 4;
const SCHEMA = {
  name: 'classification',
  schema: {
    type: 'object',
    properties: { articles: { type: 'array', items: { type: 'object' } } },
    required: ['articles'],
    additionalProperties: false,
  },
} as const;
const STATIC_PART = {
  instructions: 'Report the facts that each article tells of each recognized player.',
  typeSheets: 'Type sheets: public_dispute.',
  doNotRepropose: 'Do not repropose: none.',
};

const requestOf = (...texts: readonly string[]): ClassificationRequest => ({
  staticPart: STATIC_PART,
  articles: texts.map((text, index) => ({ id: `article-${String(index + 1)}`, text })),
  schema: SCHEMA,
});

const REQUEST = requestOf('Title and excerpt of article 1.', 'Title and excerpt of article 2.');

function apiKey(): Secret {
  const parsed = parseServerEnv({ GROQ_API_KEY: KEY });
  const key = parsed.ok ? parsed.env.GROQ_API_KEY : undefined;
  if (key === undefined) {
    throw new Error('The test key does not parse.');
  }
  return key;
}

/** Groq's endpoint played from the recorded answers, the completion unless told otherwise. */
function replay() {
  const seen: Seen[] = [];
  const queued: Next[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const text = typeof init?.body === 'string' ? init.body : '';
    seen.push({ url, headers: new Headers(init?.headers), text });
    const next = queued.shift() ?? completion;
    if (next === 'lost') {
      throw new TypeError('fetch failed');
    }
    if (next === 'slow') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The call ended.', 'AbortError'));
        });
      });
    }
    await Promise.resolve();
    return Response.json(next.body, { status: next.status, headers: next.headers });
  };
  const queue = (next: Next): void => {
    queued.push(next);
  };
  return { fetch: fetcher, seen, queue };
}

function setUp() {
  const http = replay();
  const [provider] = groqProviders({ apiKey: apiKey(), model: MODEL, fetch: http.fetch });
  if (provider === undefined) {
    throw new Error('The provider is absent with a key.');
  }
  return { http, provider };
}

const context = (deadlineMs = DEADLINE_MS, signal = new AbortController().signal): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal,
});

const bodyOf = (seen: Seen | undefined): unknown => JSON.parse(seen?.text ?? 'null');

/** The failure of one call of `provider` on `request`, null for an answer. */
async function errorAfter(provider: LanguageModelProvider, request = REQUEST, ctx = context()) {
  const outcome = await provider.complete(ctx, request);
  return outcome.ok ? null : outcome.error;
}

/** The characters that the provider counts in `request`: its messages and its schema. */
const charactersOf = (request: ClassificationRequest): number =>
  [...messagesOf(request).map(({ content }) => content), JSON.stringify(SCHEMA.schema)].join('')
    .length;

const atFixedTime = (): void => {
  onTestFinished(installFakeClock(fixedClock(AT)));
};

const passThrough: Budget = async (_name, call) => ok(await call());

describe('the Groq provider in the chain', () => {
  it('[DET-08] is absent without GROQ_API_KEY, so that a chain never calls Groq', async () => {
    const http = replay();
    const { primary } = createFakeLanguageModel();
    const chain = createChain([
      primary,
      ...groqProviders({ apiKey: undefined, model: MODEL, fetch: http.fetch }),
    ]);
    const result = await chain.classify(context(), REQUEST, {
      budget: passThrough,
      validate: () => err('unusable'),
      attempts: 2,
    });

    expect(chain.providers.map(({ name }) => name)).toStrictEqual(['workersAi']);
    expect(result.ok ? [] : result.error.steps.map(({ provider }) => provider)).toStrictEqual([
      'workersAi',
      'workersAi',
    ]);
    expect(http.seen).toStrictEqual([]);
  });

  it('[DET-08] follows the primary with the fallback model and its ceiling when a key is set', () => {
    const { primary } = createFakeLanguageModel();
    const fallback = groqProviders({ apiKey: apiKey(), model: MODEL, fetch: replay().fetch });
    const chain = createChain([primary, ...fallback]);

    expect(
      chain.providers.map(({ name, model, requestCeilingTokens }) => [
        name,
        model,
        requestCeilingTokens,
      ]),
    ).toStrictEqual([
      ['workersAi', primary.model, primary.requestCeilingTokens],
      ['groq', MODEL, SHEET_CEILING_TOKENS],
    ]);
  });
});

describe('the requests of the Groq provider', () => {
  it('[DET-14] posts the messages with the key, the answer held to the schema in strict mode', async () => {
    const { http, provider } = setUp();
    await provider.complete(context(), REQUEST);
    const [seen] = http.seen;

    expect([seen?.url, seen?.headers.get('content-type')]).toStrictEqual([
      GROQ_ENDPOINT,
      recordedRequest.headers['content-type'],
    ]);
    expect(seen?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(bodyOf(seen)).toStrictEqual(recordedRequest.body);
  });

  it('[DET-14] keeps the static part first and byte for byte the same for other articles', async () => {
    const { http, provider } = setUp();
    await provider.complete(context(), REQUEST);
    await provider.complete(context(), requestOf('Another title and excerpt.'));
    const [first, second] = http.seen.map(({ text }) =>
      text.slice(0, text.indexOf('"role":"user"')),
    );
    const system = JSON.stringify({
      role: 'system',
      content: Object.values(STATIC_PART).join('\n\n'),
    });

    expect(first).toBe(second);
    expect(first?.endsWith(`"messages":[${system},{`)).toBe(true);
  });

  it('never sends a request above 7,000 tokens with its maximum output, and sends one at the ceiling', async () => {
    const { http, provider } = setUp();
    const atCeiling = (GROQ_REQUEST_CEILING_TOKENS - GROQ_MAX_OUTPUT_TOKENS) * CHARS_PER_TOKEN;
    const filler = 'x'.repeat(atCeiling - charactersOf(requestOf('')));
    const above = await provider.complete(context(), requestOf(`${filler}x`));

    expect(GROQ_REQUEST_CEILING_TOKENS).toBe(SHEET_CEILING_TOKENS);
    expect(above).toStrictEqual({
      ok: false,
      error: { kind: 'unavailable' },
      call: { httpRequests: 0, tokens: 0, neurons: 0, requestsResetAt: null, tokensResetAt: null },
    });
    expect(http.seen).toHaveLength(0);
    await expect(errorAfter(provider, requestOf(filler))).resolves.toBeNull();
    expect(http.seen).toHaveLength(1);
  });
});

describe('the answers of the Groq provider', () => {
  it('[TRV-03] gives the answer with its tokens without the cached ones and the resets of the requests a day and the tokens a minute', async () => {
    atFixedTime();
    const { provider } = setUp();

    await expect(provider.complete(context(), REQUEST)).resolves.toStrictEqual({
      ok: true,
      value: completion.body.choices[0]?.message.content,
      call: {
        httpRequests: 1,
        tokens: UNCACHED_TOKENS,
        neurons: 0,
        requestsResetAt: AT + REQUESTS_RESET_MS,
        tokensResetAt: AT + TOKENS_RESET_MS,
      },
    });
  });

  it.each([
    ['the requests a day', errors.requests_per_day],
    ['the tokens a day', errors.tokens_per_day],
    ['the requests a day, its message unreadable', { ...errors.requests_per_day, body: {} }],
  ])('[TRV-06] reports a 429 of %s as quota_refused', async (_limit, recorded) => {
    const { http, provider } = setUp();
    http.queue(recorded);

    await expect(errorAfter(provider)).resolves.toStrictEqual({ kind: 'quota_refused' });
  });

  it('[TRV-06] reports when the requests a day refill from a refusal of them', async () => {
    atFixedTime();
    const { http, provider } = setUp();
    http.queue(errors.requests_per_day);
    const { call } = await provider.complete(context(), REQUEST);

    expect([
      call.httpRequests,
      call.tokens,
      call.requestsResetAt,
      call.tokensResetAt,
    ]).toStrictEqual([1, 0, AT + REQUESTS_A_DAY_RESET_MS, AT]);
  });

  it('reports a 429 of the tokens a minute as rate_limited with its retry-after delay, or none', async () => {
    const { http, provider } = setUp();
    const { headers } = errors.tokens_per_minute;
    const withoutDelay = Object.fromEntries(
      Object.entries(headers).filter(([name]) => name !== 'retry-after'),
    );
    http.queue(errors.tokens_per_minute);
    http.queue({ ...errors.tokens_per_minute, headers: { ...headers, 'retry-after': 'soon' } });
    http.queue({ ...errors.tokens_per_minute, headers: withoutDelay });
    const delays = [
      await errorAfter(provider),
      await errorAfter(provider),
      await errorAfter(provider),
    ];

    expect(delays).toStrictEqual([
      { kind: 'rate_limited', retryAfterMs: MINUTE_RETRY_MS },
      { kind: 'rate_limited', retryAfterMs: null },
      { kind: 'rate_limited', retryAfterMs: null },
    ]);
  });

  it.each<readonly [string, Next, string]>([
    ['an answer off the schema', errors.json_validate_failed, 'schema_not_met'],
    [
      'another refused request',
      { ...errors.json_validate_failed, body: 'Bad request' },
      'unavailable',
    ],
    ['a rejected key', errors.invalid_api_key, 'unavailable'],
    ['a server error', errors.service_unavailable, 'unavailable'],
    ['a lost connection', 'lost', 'unavailable'],
    ['an answer without a message', { ...completion, body: { choices: [] } }, 'malformed'],
  ])('reports %s as %s', async (_case, next, kind) => {
    const { http, provider } = setUp();
    http.queue(next);

    await expect(errorAfter(provider)).resolves.toStrictEqual({ kind });
  });

  it('reads a reset header that holds no duration as unknown, and counts a prompt without cached tokens whole', async () => {
    const { http, provider } = setUp();
    const { usage } = completion.body;
    const uncached = { ...usage, ...Object.fromEntries([['prompt_tokens_details', null]]) };
    http.queue({
      ...completion,
      headers: { 'x-ratelimit-reset-requests': '2 minutes' },
      body: { ...completion.body, usage: uncached },
    });
    const { call } = await provider.complete(context(), REQUEST);

    expect([call.tokens, call.requestsResetAt, call.tokensResetAt]).toStrictEqual([
      WHOLE_TOKENS,
      null,
      null,
    ]);
  });

  it('ends a call at its deadline or at its signal as timeout', async () => {
    const { http, provider } = setUp();
    const cancel = new AbortController();
    http.queue('slow');
    http.queue('slow');
    const cancelled = errorAfter(provider, REQUEST, context(DEADLINE_MS, cancel.signal));
    cancel.abort();

    await expect(errorAfter(provider, REQUEST, context(SHORT_DEADLINE_MS))).resolves.toStrictEqual({
      kind: 'timeout',
    });
    await expect(cancelled).resolves.toStrictEqual({ kind: 'timeout' });
  });

  it('[TRV-64] sends the key in the Authorization header alone, and into no outcome', async () => {
    const { http, provider } = setUp();
    const answers: readonly Next[] = [completion, ...Object.values(errors), 'lost'];
    const outcomes: ProviderOutcome[] = [];
    for (const answer of answers) {
      http.queue(answer);
      outcomes.push(await provider.complete(context(), REQUEST));
    }

    expect(JSON.stringify(outcomes)).not.toContain(KEY);
    expect(http.seen.map(({ text }) => text.includes(KEY))).not.toContain(true);
    expect(http.seen.map(({ headers }) => headers.get('authorization'))).toStrictEqual(
      answers.map(() => `Bearer ${KEY}`),
    );
  });
});

/** The provider on the recorded answers, each fault of the contract met by its own. */
function groqHarness(): ProviderHarness {
  const { http, provider } = setUp();
  const faults: Readonly<Record<ContractFault, Next>> = {
    quotaRefused: errors.requests_per_day,
    minuteLimit: errors.tokens_per_minute,
    slow: 'slow',
  };
  return {
    provider,
    inject: (fault) => {
      http.queue(faults[fault]);
    },
  };
}

describe('the Groq provider against the language-model contract', () => {
  it.each(Object.entries(LANGUAGE_MODEL_CONTRACT))('%s', async (_title, run) => {
    const { observed, promised } = await run(groqHarness());

    expect(observed).toStrictEqual(promised);
  });
});
