// The primary provider of the language-model chain (detection-model sheet, "How it is
// called"): Cloudflare Workers AI's REST API, one POST a request over plain fetch, its
// answer in the chat-completion layout of the model's output schema.
import { z } from 'zod';

import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

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
import type { Result } from '@/lib/result';

/** What the adapter needs: the account, its Workers AI token, the model ID and the HTTP client. */
export type WorkersAiConfig = Readonly<{
  accountId: string;
  token: Secret;
  model: string;
  fetch: typeof fetch;
}>;

/** Why a configuration is refused: a model whose neuron rates the adapter does not know. */
export type WorkersAiConfigError = Readonly<{ kind: 'unknown_model'; model: string }>;

// What the adapter knows of a model (detection-model sheet, "Limits"): its context, which
// holds the request with its maximum output, and its published neuron rates.
type KnownModel = Readonly<{
  contextTokens: number;
  neuronsPerMillionInput: number;
  neuronsPerMillionOutput: number;
}>;

const GLM_CONTEXT_TOKENS = 131_072;
const GLM_NEURONS_PER_MILLION_INPUT = 5500;
const GLM_NEURONS_PER_MILLION_OUTPUT = 36_400;
const GLM_4_7_FLASH: KnownModel = {
  contextTokens: GLM_CONTEXT_TOKENS,
  neuronsPerMillionInput: GLM_NEURONS_PER_MILLION_INPUT,
  neuronsPerMillionOutput: GLM_NEURONS_PER_MILLION_OUTPUT,
};
const KNOWN_MODELS: ReadonlyMap<string, KnownModel> = new Map([
  ['@cf/zai-org/glm-4.7-flash', GLM_4_7_FLASH],
]);

const API = 'https://api.cloudflare.com/client/v4/accounts';
// The ceiling of one answer that the sheet's research gives ("Our expected use").
const MAX_COMPLETION_TOKENS = 1000;
const PER_MILLION = 1_000_000;
const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
// The 429 of the daily free allocation used up (Workers AI errors, "Account limited").
const NEURONS_USED_UP = 3036;
// Cloudflare's error when the answer cannot hold to the schema (Workers AI JSON mode).
const JSON_MODE_NOT_MET = /JSON Mode couldn't be met/iu;
const MS_PER_SECOND = 1000;
// The delay of a minute limit without retry-after: the window of 300 requests a minute.
const MINUTE_MS = 60_000;
const SECONDS = /^\d+$/u;

const NO_COST: CallMetadata = {
  httpRequests: 0,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};
const ONE_REQUEST: CallMetadata = { ...NO_COST, httpRequests: 1 };
const TIMEOUT: LanguageModelError = { kind: 'timeout' };
const UNAVAILABLE: LanguageModelError = { kind: 'unavailable' };

// The answer as the schemas read it: Workers AI writes its keys in snake_case
// (`prompt_tokens`), which `camelCased` turns into camelCase (`promptTokens`).
const tokenCount = z.number().int().nonnegative();
const choiceSchema = z.object({ message: z.object({ content: z.string().nullable() }) });
const usageSchema = z.object({
  promptTokens: tokenCount,
  completionTokens: tokenCount,
  promptTokensDetails: z.object({ cachedTokens: tokenCount }).optional(),
});
const answerSchema = z.object({
  result: z.object({ choices: z.tuple([choiceSchema], choiceSchema), usage: usageSchema }),
});
const errorSchema = z.object({ code: z.number().optional(), message: z.string() });
const failureSchema = z.object({ errors: z.array(errorSchema) });

type Usage = z.infer<typeof usageSchema>;

// What came back over HTTP: whether its status is a success, the status, its headers and its whole body.
type Reply = Readonly<{ succeeded: boolean; status: number; headers: Headers; text: string }>;

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const SNAKE_JOINT = /_([a-z])/gu;
const camelKey = (key: string): string =>
  key.replaceAll(SNAKE_JOINT, (_joint, letter: string) => letter.toUpperCase());

// `value` with every key of its objects, at every depth, in camelCase.
function camelCased(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => camelCased(item));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([key, inner]) => [camelKey(key), camelCased(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}

// What the call cost: its one request, its tokens without the cached ones (CallMetadata),
// and its neurons at the model's published rates, every prompt token counted.
function costOf(model: KnownModel, usage: Usage): CallMetadata {
  const input = usage.promptTokens;
  const output = usage.completionTokens;
  const cached = usage.promptTokensDetails?.cachedTokens ?? 0;
  const neurons = Math.ceil(
    (input * model.neuronsPerMillionInput + output * model.neuronsPerMillionOutput) / PER_MILLION,
  );
  return { ...ONE_REQUEST, tokens: input + output - cached, neurons };
}

function retryAfterMs(headers: Headers): number {
  const seconds = headers.get('retry-after') ?? '';
  return SECONDS.test(seconds) && Number(seconds) > 0 ? Number(seconds) * MS_PER_SECOND : MINUTE_MS;
}

// Why a refused call gave no answer, from its status and the errors of its body.
function errorOf({ status, headers, text }: Reply): LanguageModelError {
  const failure = failureSchema.safeParse(parsedJson(text));
  const errors = failure.success ? failure.data.errors : [];
  if (errors.some(({ message }) => JSON_MODE_NOT_MET.test(message))) {
    return { kind: 'schema_not_met' };
  }
  if (status === TOO_MANY_REQUESTS) {
    return errors.some(({ code }) => code === NEURONS_USED_UP)
      ? { kind: 'quota_refused' }
      : { kind: 'rate_limited', retryAfterMs: retryAfterMs(headers) };
  }
  return status === REQUEST_TIMEOUT ? TIMEOUT : UNAVAILABLE;
}

// The model's answer, refused as schema_not_met when it holds no JSON, since the model
// does not guarantee an answer that meets the schema (JSON mode).
function outcomeOf(model: KnownModel, reply: Reply): ProviderOutcome {
  if (!reply.succeeded) {
    return { ok: false, error: errorOf(reply), call: ONE_REQUEST };
  }
  const answer = answerSchema.safeParse(camelCased(parsedJson(reply.text)));
  if (!answer.success) {
    return { ok: false, error: { kind: 'malformed' }, call: ONE_REQUEST };
  }
  const { choices, usage } = answer.data.result;
  const { content } = choices[0].message;
  const call = costOf(model, usage);
  return content === null || parsedJson(content) === undefined
    ? { ok: false, error: { kind: 'schema_not_met' }, call }
    : { ok: true, value: content, call };
}

// The body of a request: the messages that every provider sends, static part first, then
// the answer's bound and its JSON schema in strict mode, and nothing else (DET-14, TRV-16).
// Its keys are those of the model's input schema, in snake_case; the schema itself is sent as given.
function bodyOf(request: ClassificationRequest): string {
  const { name, schema } = request.schema;
  const format = Object.fromEntries<unknown>([
    ['type', 'json_schema'],
    ['json_schema', { name, schema, strict: true }],
  ]);
  return JSON.stringify(
    Object.fromEntries<unknown>([
      ['messages', messagesOf(request)],
      ['max_completion_tokens', MAX_COMPLETION_TOKENS],
      ['response_format', format],
    ]),
  );
}

// One POST that ends at the call's deadline or when its signal cancels it.
async function send(
  config: WorkersAiConfig,
  ctx: CallContext,
  request: ClassificationRequest,
): Promise<Result<Reply, LanguageModelError>> {
  const timeLeft = AbortSignal.timeout(Math.max(0, ctx.deadline - now()));
  const signal = AbortSignal.any([ctx.signal, timeLeft]);
  try {
    const requestHeaders = {
      authorization: `Bearer ${config.token.reveal()}`,
      'content-type': 'application/json',
    };
    const url = `${API}/${config.accountId}/ai/run/${config.model}`;
    const response = await config.fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: bodyOf(request),
      signal,
    });
    const text = await response.text();
    const { ok: succeeded, status, headers } = response;
    return ok({ succeeded, status, headers, text });
  } catch {
    return err(signal.aborted ? TIMEOUT : UNAVAILABLE);
  }
}

/**
 * The Workers AI provider of the chain, `workersAi` (module map §5, detection-model
 * sheet), or a refusal of a model whose neuron rates it does not know. Each call sends
 * only the request's public data, static part first and articles after it, with the
 * answer's JSON schema in strict mode (DET-12, DET-14, TRV-16), the token in its
 * authorization header alone (TRV-64); it returns the model's raw answer, or
 * schema_not_met for one that holds no JSON, with its tokens and the neurons of the
 * model's published rates. The daily neuron allowance used up is quota_refused (TRV-06),
 * another 429 rate_limited, the deadline, a cancellation or a 408 timeout, and any other
 * refusal or network error unavailable.
 */
export function createWorkersAiProvider(
  config: WorkersAiConfig,
): Result<LanguageModelProvider, WorkersAiConfigError> {
  const model = KNOWN_MODELS.get(config.model);
  if (model === undefined) {
    return err({ kind: 'unknown_model', model: config.model });
  }
  const complete = async (
    ctx: CallContext,
    request: ClassificationRequest,
  ): Promise<ProviderOutcome> => {
    if (ctx.signal.aborted || now() >= ctx.deadline) {
      return { ok: false, error: TIMEOUT, call: NO_COST };
    }
    const reply = await send(config, ctx, request);
    return reply.ok
      ? outcomeOf(model, reply.value)
      : { ok: false, error: reply.error, call: ONE_REQUEST };
  };
  return ok({
    name: 'workersAi',
    model: config.model,
    requestCeilingTokens: model.contextTokens,
    complete,
  });
}
