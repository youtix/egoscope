// The scriptable providers of the language-model port (module map §5): each answers per
// article what its script says, in a JSON layout of its own, and meets the limits, the
// refusals and the slow answers that a test injects. It sends nothing anywhere.
import { now, toEpochMs } from '@/lib/time';

import { messagesOf } from './types';

import type { LanguageModelError } from './errors';
import type {
  CallContext,
  CallMetadata,
  ClassificationRequest,
  LanguageModelProvider,
  ProviderName,
  ProviderOutcome,
} from './types';
import type { EpochMs } from '@/lib/time';

/** A fact the fake reports for one player of an article, `event` naming the recent event it is attached to. */
export type ScriptedFact = Readonly<{
  player: string;
  type: string;
  confidence: number;
  description: string;
  justification: string;
  event: string | null;
}>;

/**
 * What the fake answers for one article: its facts, none for an article without a fact;
 * a new type proposal; a fact without one of its fields; or output that breaks the schema.
 */
export type ScriptedPart =
  | Readonly<{ kind: 'facts'; facts: readonly ScriptedFact[] }>
  | Readonly<{ kind: 'proposal'; player: string; name: string; definition: string }>
  | Readonly<{ kind: 'missing_field'; fact: ScriptedFact; field: keyof ScriptedFact }>
  | Readonly<{ kind: 'schema_breaking' }>;

/** How a fake provider is made: who it plays, its ceiling, its limits, and what its answers report. */
export type FakeProviderOptions = Readonly<{
  name: ProviderName;
  model: string;
  requestCeilingTokens: number;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  /** Neurons per million input and output tokens, for a provider that counts them. */
  neuronRates: Readonly<{ input: number; output: number }> | null;
  /** Whether its answers carry the instants its requests and tokens refill, as Groq's do. */
  reportsResets: boolean;
}>;

/** A fake provider, with its script and what it received. */
export type FakeProvider = LanguageModelProvider &
  Readonly<{
    script: (article: string, part: ScriptedPart) => void;
    /** Makes the next call fail with `error`: a refusal for quota before any limit, say (TRV-06). */
    failNext: (error: LanguageModelError) => void;
    /** Makes the next call answer `delayMs` late, or `timeout` at its deadline when that comes first. */
    slowNext: (delayMs: number) => void;
    received: () => readonly ClassificationRequest[];
  }>;

// What a fake provider keeps between calls.
type FakeState = Readonly<{
  options: FakeProviderOptions;
  parts: Map<string, ScriptedPart>;
  answeredAt: EpochMs[];
}>;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const CHARS_PER_TOKEN = 4;
const PER_MILLION = 1_000_000;
const ONE_REQUEST: CallMetadata = {
  httpRequests: 1,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};
const NO_FACT: ScriptedPart = { kind: 'facts', facts: [] };

const tokensOf = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

// The start of the window of `periodMs` after the one that holds `at`, in UTC.
const nextWindow = (at: EpochMs, periodMs: number): EpochMs =>
  toEpochMs((Math.floor(at / periodMs) + 1) * periodMs);

function partText(article: string, part: ScriptedPart): string {
  switch (part.kind) {
    case 'facts': {
      return JSON.stringify({ article, facts: part.facts, proposals: [] });
    }
    case 'proposal': {
      const { player, name, definition } = part;
      return JSON.stringify({ article, facts: [], proposals: [{ player, name, definition }] });
    }
    case 'missing_field': {
      const { fact, field } = part;
      const kept = Object.fromEntries(Object.entries(fact).filter(([key]) => key !== field));
      return JSON.stringify({ article, facts: [kept], proposals: [] });
    }
    case 'schema_breaking': {
      return `{"article":${JSON.stringify(article)},"facts":[`;
    }
  }
}

// The refusal of a call at `at` above the requests of the current minute or UTC day.
function limitHit({ options, answeredAt }: FakeState, at: EpochMs): LanguageModelError | null {
  const windows = [
    [options.requestsPerMinute, MINUTE_MS],
    [options.requestsPerDay, DAY_MS],
  ] as const;
  for (const [limit, periodMs] of windows) {
    const end = nextWindow(at, periodMs);
    const used = answeredAt.filter((instant) => instant >= end - periodMs).length;
    if (limit !== null && used >= limit) {
      return { kind: 'rate_limited', retryAfterMs: end - at };
    }
  }
  return null;
}

function callOf(
  { options }: FakeState,
  at: EpochMs,
  tokens: Readonly<{ input: number; output: number }>,
): CallMetadata {
  const rates = options.neuronRates;
  const neurons =
    rates === null
      ? 0
      : Math.ceil((tokens.input * rates.input + tokens.output * rates.output) / PER_MILLION);
  const resetAt = (periodMs: number) => (options.reportsResets ? nextWindow(at, periodMs) : null);
  return {
    httpRequests: 1,
    tokens: tokens.input + tokens.output,
    neurons,
    requestsResetAt: resetAt(DAY_MS),
    tokensResetAt: resetAt(MINUTE_MS),
  };
}

function answer(state: FakeState, request: ClassificationRequest, at: EpochMs): ProviderOutcome {
  state.answeredAt.push(at);
  const parts = request.articles.map(({ id }) => partText(id, state.parts.get(id) ?? NO_FACT));
  const raw = `{"articles":[${parts.join(',')}]}`;
  const input = messagesOf(request).reduce((sum, { content }) => sum + tokensOf(content), 0);
  return { ok: true, value: raw, call: callOf(state, at, { input, output: tokensOf(raw) }) };
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A fake provider of the chain (module map §5, DET-12): it answers every article of a
 * request by its identifier, as scripted, and reports its tokens, its neurons when it
 * counts them, and its refill instants when it reports them; it refuses a call above its
 * requests a minute or a day with the delay to the next window (rate_limited), and meets
 * the failures and slow answers injected.
 */
export function createFakeProvider(options: FakeProviderOptions): FakeProvider {
  const state: FakeState = { options, parts: new Map(), answeredAt: [] };
  const failures: LanguageModelError[] = [];
  const delays: number[] = [];
  const received: ClassificationRequest[] = [];

  async function complete(
    ctx: CallContext,
    request: ClassificationRequest,
  ): Promise<ProviderOutcome> {
    received.push(request);
    const at = now();
    const error = failures.shift() ?? limitHit(state, at);
    if (error !== null) {
      return { ok: false, error, call: ONE_REQUEST };
    }
    const late = delays.shift() ?? 0;
    const left = ctx.deadline - at;
    await delay(Math.min(late, left));
    return late >= left
      ? { ok: false, error: { kind: 'timeout' }, call: ONE_REQUEST }
      : answer(state, request, at);
  }

  return {
    name: options.name,
    model: options.model,
    requestCeilingTokens: options.requestCeilingTokens,
    complete,
    script: (article, part) => state.parts.set(article, part),
    failNext: (error) => {
      failures.push(error);
    },
    slowNext: (delayMs) => {
      delays.push(delayMs);
    },
    received: () => [...received],
  };
}

// The defaults of the two providers (detection-model sheet, "Limits"): Workers AI's
// context, its 300 requests a minute and the neuron rates of its model; Groq's free plan
// of 30 requests a minute and 1,000 a day, and a request under about 7,000 tokens.
const WORKERS_AI_CONTEXT_TOKENS = 131_072;
const WORKERS_AI_REQUESTS_PER_MINUTE = 300;
const WORKERS_AI_NEURONS_PER_MILLION_INPUT = 5500;
const WORKERS_AI_NEURONS_PER_MILLION_OUTPUT = 36_400;
const WORKERS_AI_NEURON_RATES = {
  input: WORKERS_AI_NEURONS_PER_MILLION_INPUT,
  output: WORKERS_AI_NEURONS_PER_MILLION_OUTPUT,
};
const GROQ_REQUEST_CEILING_TOKENS = 7000;
const GROQ_REQUESTS_PER_MINUTE = 30;
const GROQ_REQUESTS_PER_DAY = 1000;

/** The fake chain: the primary, the fallback, and whether the fallback is configured, as GROQ_API_KEY decides. */
export type FakeLanguageModel = Readonly<{
  primary: FakeProvider;
  fallback: FakeProvider;
  setFallback: (isConfigured: boolean) => void;
  providers: () => readonly FakeProvider[];
}>;

/**
 * The two fake providers of the chain (module map §5): a Workers AI that counts neurons,
 * and a Groq that reports its refill instants, left out until `setFallback(true)`, as a
 * deployment without GROQ_API_KEY classifies with the primary alone (DET-08).
 */
export function createFakeLanguageModel(): FakeLanguageModel {
  const primary = createFakeProvider({
    name: 'workersAi',
    model: 'fake-workers-ai',
    requestCeilingTokens: WORKERS_AI_CONTEXT_TOKENS,
    requestsPerMinute: WORKERS_AI_REQUESTS_PER_MINUTE,
    requestsPerDay: null,
    neuronRates: WORKERS_AI_NEURON_RATES,
    reportsResets: false,
  });
  const fallback = createFakeProvider({
    name: 'groq',
    model: 'fake-groq',
    requestCeilingTokens: GROQ_REQUEST_CEILING_TOKENS,
    requestsPerMinute: GROQ_REQUESTS_PER_MINUTE,
    requestsPerDay: GROQ_REQUESTS_PER_DAY,
    neuronRates: null,
    reportsResets: true,
  });
  let isFallbackConfigured = false;
  return {
    primary,
    fallback,
    setFallback: (isConfigured) => {
      isFallbackConfigured = isConfigured;
    },
    providers: () => (isFallbackConfigured ? [primary, fallback] : [primary]),
  };
}
