// The optional fallback provider of the chain, Groq (detection-model sheet, "How it is
// called"): OpenAI-compatible chat completions over plain `fetch`, the answer held to the
// request's JSON schema in strict mode, the key only in the Authorization header (TRV-64),
// and Groq's answers mapped to the port's failures and call metadata (CL-TRV-12).
import { z } from 'zod';

import { now, toEpochMs } from '@/lib/time';

import { messagesOf } from './types';

import type { LanguageModelError } from './errors';
import type {
  CallContext,
  CallMetadata,
  ClassificationRequest,
  LanguageModelProvider,
  ProviderOutcome,
} from './types';
import type { Secret } from '@/lib/env';
import type { EpochMs } from '@/lib/time';

/** What the provider needs: the key, without which it is absent; the model ID (`languageModel.fallbackModel`); and the HTTP client. */
export type GroqConfig = Readonly<{
  apiKey: Secret | undefined;
  model: string;
  fetch: typeof fetch;
}>;

/** Groq's chat completions endpoint, the only address that receives the key. */
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
/** The most tokens one request may hold with its maximum output, under the 8,000 tokens a minute of the free plan (sheet, point 5). */
export const GROQ_REQUEST_CEILING_TOKENS = 7000;
/** The most output tokens one answer may hold: the ceiling size of an answer (sheet, "Our expected use"). */
export const GROQ_MAX_OUTPUT_TOKENS = 1000;

// The rough rule by which a request's text is counted in tokens before it is sent.
const CHARS_PER_TOKEN = 4;
const REASONING_EFFORT = 'low';
const BAD_REQUEST = 400;
const TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const SCHEMA_FAILURE_CODE = 'json_validate_failed';
// A 429 names the limit it hit, such as "requests per day (RPD)" or "tokens per day (TPD)".
const DAILY_LIMIT = /\bper day\b/iu;
// Groq writes durations as Go does, such as `2m59.56s` or `500ms`: parts of a number and its unit.
const DURATION = /^(?:\d+(?:\.\d+)?(?:ms|[hms]))+$/u;
const PART_BOUNDARY = /(?<=[hms])(?=\d)/u;
const LEADING_NUMBER = /^[\d.]+/u;
const UNIT_MS: Readonly<Record<string, number>> = {
  h: MS_PER_HOUR,
  m: MS_PER_MINUTE,
  s: MS_PER_SECOND,
  ms: 1,
};
// Groq writes its keys in snake_case, which the answer's schemas read in camelCase.
const SNAKE_CASE_JOINT = /_([a-z])/gu;
const SECONDS = /^\d+(?:\.\d+)?$/u;

const QUOTA_REFUSED: LanguageModelError = { kind: 'quota_refused' };
const SCHEMA_NOT_MET: LanguageModelError = { kind: 'schema_not_met' };
const UNAVAILABLE: LanguageModelError = { kind: 'unavailable' };
const TIMEOUT: LanguageModelError = { kind: 'timeout' };
const MALFORMED: LanguageModelError = { kind: 'malformed' };
const NOT_SENT: CallMetadata = {
  httpRequests: 0,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};
const SENT: CallMetadata = { ...NOT_SENT, httpRequests: 1 };

const tokenCount = z.number().int().nonnegative();
const choice = z.object({ message: z.object({ content: z.string() }) });
const completionSchema = z.object({
  choices: z.tuple([choice], choice),
  usage: z.object({
    promptTokens: tokenCount,
    completionTokens: tokenCount,
    promptTokensDetails: z.object({ cachedTokens: tokenCount }).nullish(),
  }),
});
const errorSchema = z.object({
  error: z.object({ message: z.string(), code: z.string().nullish() }),
});

type Completion = z.infer<typeof completionSchema>;
type ErrorDetails = z.infer<typeof errorSchema>['error'];

/** The configuration of a provider that has its key. */
type KeyedConfig = Readonly<{ apiKey: Secret; model: string; fetch: typeof fetch }>;

/** An answer read whole. */
type Answer = Readonly<{ isSuccess: boolean; status: number; headers: Headers; text: string }>;

/** The body of a request: the static part first, byte for byte the same across calls (DET-14). */
function bodyOf(model: string, request: ClassificationRequest): Readonly<Record<string, unknown>> {
  const { name, schema } = request.schema;
  const jsonSchema = { name, strict: true, schema };
  return Object.fromEntries([
    ['model', model],
    ['messages', messagesOf(request)],
    [
      'response_format',
      Object.fromEntries([
        ['type', 'json_schema'],
        ['json_schema', jsonSchema],
      ]),
    ],
    ['reasoning_effort', REASONING_EFFORT],
    ['max_completion_tokens', GROQ_MAX_OUTPUT_TOKENS],
  ]);
}

/** The tokens `request` may cost at most: its messages and its schema, then the maximum output. */
function estimatedTokens(request: ClassificationRequest): number {
  const texts = messagesOf(request).map(({ content }) => content);
  const characters = [...texts, JSON.stringify(request.schema.schema)].join('').length;
  return Math.ceil(characters / CHARS_PER_TOKEN) + GROQ_MAX_OUTPUT_TOKENS;
}

/** The milliseconds of one part of a duration, a number and its unit such as `59.56s`. */
function partMs(part: string): number {
  const unit = part.replace(LEADING_NUMBER, '');
  return Number(part.slice(0, part.length - unit.length)) * Number(UNIT_MS[unit]);
}

/** The milliseconds of a Go duration such as `2m59.56s`, null when it is not one. */
function durationMs(value: string | null): number | null {
  return value === null || !DURATION.test(value)
    ? null
    : Math.ceil(value.split(PART_BOUNDARY).reduce((sum, part) => sum + partMs(part), 0));
}

/** The instant a header's duration from `at` ends, null without one. */
function resetAt(headers: Headers, name: string, at: EpochMs): EpochMs | null {
  const delay = durationMs(headers.get(name));
  return delay === null ? null : toEpochMs(at + delay);
}

/** The delay of a 429's `retry-after`, given in seconds, null without one. */
function retryAfterMs(headers: Headers): number | null {
  const value = headers.get('retry-after');
  return value !== null && SECONDS.test(value) ? Math.ceil(Number(value) * MS_PER_SECOND) : null;
}

/** Each object of an answer with its keys in camelCase, its values left as they are. */
function camelCaseKeys(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replaceAll(SNAKE_CASE_JOINT, (_joint, letter: string) => letter.toUpperCase()),
      item,
    ]),
  );
}

/** The value of `text` read as JSON by `schema`, null for an answer of another shape. */
function parsed<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(text, camelCaseKeys));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Whether a 429 is one of a daily allowance: no request left of the day, or a message that names a day's limit. */
function isDaily(headers: Headers, details: ErrorDetails | null): boolean {
  return (
    headers.get('x-ratelimit-remaining-requests') === '0' ||
    DAILY_LIMIT.test(details?.message ?? '')
  );
}

/**
 * What a refusal stands for: a 429 of the requests or tokens a day a refusal for quota
 * (TRV-06), another 429 a minute limit with its delay, a 400 for an answer off the schema
 * `schema_not_met`, and any other failure, a rejected key included, `unavailable`.
 */
function errorOf({ status, headers, text }: Answer): LanguageModelError {
  const details = parsed(errorSchema, text)?.error ?? null;
  if (status === TOO_MANY_REQUESTS) {
    return isDaily(headers, details)
      ? QUOTA_REFUSED
      : { kind: 'rate_limited', retryAfterMs: retryAfterMs(headers) };
  }
  return status === BAD_REQUEST && details?.code === SCHEMA_FAILURE_CODE
    ? SCHEMA_NOT_MET
    : UNAVAILABLE;
}

/** The tokens a completion counts towards the limits: its prompt without the cached part, and its output. */
function tokensOf({ usage }: Completion): number {
  const cached = usage.promptTokensDetails?.cachedTokens ?? 0;
  return Math.max(0, usage.promptTokens - cached) + usage.completionTokens;
}

/** The outcome of an answer, with its tokens and the reset instants of its headers. */
function outcomeOf(answer: Answer): ProviderOutcome {
  const at = now();
  const call: CallMetadata = {
    ...SENT,
    requestsResetAt: resetAt(answer.headers, 'x-ratelimit-reset-requests', at),
    tokensResetAt: resetAt(answer.headers, 'x-ratelimit-reset-tokens', at),
  };
  if (!answer.isSuccess) {
    return { ok: false, error: errorOf(answer), call };
  }
  const completion = parsed(completionSchema, answer.text);
  return completion === null
    ? { ok: false, error: MALFORMED, call }
    : {
        ok: true,
        value: completion.choices[0].message.content,
        call: { ...call, tokens: tokensOf(completion) },
      };
}

/** Sends `request` with the key, and reads the answer whole before the call ends. */
async function send(
  { apiKey, fetch: post, model }: KeyedConfig,
  ctx: CallContext,
  request: ClassificationRequest,
): Promise<ProviderOutcome> {
  const timeLeft = AbortSignal.timeout(Math.max(0, ctx.deadline - now()));
  const signal = AbortSignal.any([ctx.signal, timeLeft]);
  try {
    // Called on its own, as the global `fetch` expects, never as a method of the config.
    const response = await post(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey.reveal()}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodyOf(model, request)),
      signal,
    });
    const { ok: isSuccess, status, headers } = response;
    return outcomeOf({ isSuccess, status, headers, text: await response.text() });
  } catch {
    return { ok: false, error: signal.aborted ? TIMEOUT : UNAVAILABLE, call: SENT };
  }
}

/**
 * The Groq providers of the chain (DET-08, module map §5, language-model): none without
 * `GROQ_API_KEY`, so that nothing calls Groq, else one with `languageModel.fallbackModel`.
 * Each request holds the static part first and the articles after it (DET-12, DET-14),
 * the answer held to its JSON schema in strict mode; a request above the ceiling of
 * about 7,000 tokens with its maximum output is never sent, and fails as `unavailable`.
 * Each answer reports its tokens without the cached ones, and the instants that the
 * requests a day and the tokens a minute refill, from `x-ratelimit-reset-requests` and
 * `x-ratelimit-reset-tokens` (TRV-03, CL-TRV-12); a 429 is a minute limit with its
 * `retry-after` delay, or a refusal for quota when it names a daily allowance (TRV-06);
 * the call ends at its deadline or its signal as `timeout`, and is not sent when its
 * deadline has come or its signal has cancelled it before it began. The key goes into the
 * Authorization header alone, and into no outcome (TRV-64).
 */
export function groqProviders(config: GroqConfig): readonly LanguageModelProvider[] {
  const { apiKey, model } = config;
  if (apiKey === undefined) {
    return [];
  }
  const keyed: KeyedConfig = { ...config, apiKey };
  async function complete(
    ctx: CallContext,
    request: ClassificationRequest,
  ): Promise<ProviderOutcome> {
    if (ctx.signal.aborted || now() >= ctx.deadline) {
      return { ok: false, error: TIMEOUT, call: NOT_SENT };
    }
    return estimatedTokens(request) > GROQ_REQUEST_CEILING_TOKENS
      ? { ok: false, error: UNAVAILABLE, call: NOT_SENT }
      : send(keyed, ctx, request);
  }
  return [
    {
      name: 'groq',
      model,
      requestCeilingTokens: GROQ_REQUEST_CEILING_TOKENS,
      complete,
    },
  ];
}
