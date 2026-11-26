import type { LanguageModelError } from './errors';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/** The bounds of one call inside the tick budget: the instant it must end by, and the signal that cancels it. */
export type CallContext = Readonly<{ deadline: EpochMs; signal: AbortSignal }>;

/** A provider of the chain, by the name of its quota service (module map §5). */
export type ProviderName = 'workersAi' | 'groq';

/**
 * What one call cost, which `quotas.withQuota` records (TRV-03, CL-TRV-12): its
 * requests, its tokens (cached ones not counted), Workers AI's neurons, and the instants
 * its requests and its tokens refill when the provider reports them (Groq's
 * `x-ratelimit-reset-requests` and `x-ratelimit-reset-tokens`).
 */
export type CallMetadata = Readonly<{
  httpRequests: number;
  tokens: number;
  neurons: number;
  requestsResetAt: EpochMs | null;
  tokensResetAt: EpochMs | null;
}>;

/** One article of a request, by the identifier its answer is traced to (DET-12). */
export type RequestArticle = Readonly<{ id: string; text: string }>;

/**
 * One classification request (DET-12, DET-14): the static part, the same byte for byte
 * across calls so that the provider's prompt cache applies, then one or several
 * articles, and the JSON schema of the answer, sent in strict mode.
 */
export type ClassificationRequest = Readonly<{
  staticPart: Readonly<{ instructions: string; typeSheets: string; doNotRepropose: string }>;
  articles: readonly RequestArticle[];
  schema: Readonly<{ name: string; schema: Readonly<Record<string, unknown>> }>;
}>;

/** A message of the conversation that a provider receives. */
export type RequestMessage = Readonly<{ role: 'system' | 'user'; content: string }>;

const PART_SEPARATOR = '\n\n';

/**
 * The messages that every provider sends for `request`, and nothing else (DSN-05,
 * TRV-66): first the static part, instructions, type sheets and do-not-repropose list
 * in that order, then the articles, each with its identifier (DET-12, DET-14).
 */
export function messagesOf({
  staticPart,
  articles,
}: ClassificationRequest): readonly RequestMessage[] {
  const { instructions, typeSheets, doNotRepropose } = staticPart;
  return [
    { role: 'system', content: [instructions, typeSheets, doNotRepropose].join(PART_SEPARATOR) },
    { role: 'user', content: JSON.stringify({ articles }) },
  ];
}

/** A provider's answer, the raw text of the model or why it gave none, with what the call cost. */
export type ProviderOutcome = Readonly<
  | { ok: true; value: string; call: CallMetadata }
  | { ok: false; error: LanguageModelError; call: CallMetadata }
>;

/**
 * One provider of the chain: its name, its model ID and the most tokens one request may
 * hold with its maximum output, by which callers size their batches (detection-model
 * sheet: about 7,000 for Groq).
 */
export type LanguageModelProvider = Readonly<{
  name: ProviderName;
  model: string;
  requestCeilingTokens: number;
  complete: (ctx: CallContext, request: ClassificationRequest) => Promise<ProviderOutcome>;
}>;

/** What a provider answered, with who answered (DET-53, DET-56) and what it cost. */
export type ModelAnswer = Readonly<{
  raw: string;
  provider: ProviderName;
  model: string;
  call: CallMetadata;
}>;

/** A call that the caller's budget did not let through, with the instant it may be made. */
export type BudgetDeferral = Readonly<{ kind: 'deferred'; availableAt: EpochMs | null }>;

/** How the caller lets a provider's call through, `quotas.withQuota` on its own service. */
export type Budget = (
  provider: ProviderName,
  call: () => Promise<ProviderOutcome>,
) => Promise<Result<ProviderOutcome, BudgetDeferral>>;

/** What the chain did with one provider: deferred by its budget, failed, or answered unusably. */
export type ChainStep<E> = Readonly<{ provider: ProviderName; model: string }> &
  Readonly<
    | { kind: 'deferred'; availableAt: EpochMs | null }
    | { kind: 'failed'; error: LanguageModelError }
    | { kind: 'unusable'; answer: ModelAnswer; reason: E }
  >;

/** How the caller runs one classification: its budget, its validator and its number of attempts (DET-22). */
export type ClassifyOptions<T, E> = Readonly<{
  budget: Budget;
  validate: (answer: ModelAnswer) => Result<T, E>;
  attempts: number;
}>;

/**
 * Why a classification has no usable answer, with every step in order: its attempts all
 * gave unusable answers (DET-22), `attempts_exhausted`; or `unanswered`, when no provider
 * was left to try, or the call was cancelled or reached its deadline, before the attempts
 * were all used. An `unanswered` classification may have used attempts already, an
 * unusable answer of the primary followed by a deferred fallback, say, and detection
 * applies CL-DET-03 to it from its steps: the refused or unanswered calls use no
 * attempt, and the item keeps waiting (DET-08).
 */
export type ClassifyFailure<E> = Readonly<{
  kind: 'attempts_exhausted' | 'unanswered';
  steps: readonly ChainStep<E>[];
}>;

/** A classification's usable answer, which the validator read as `value`, or why it has none. */
export type Classification<T, E> = Readonly<
  { ok: true; value: T; answer: ModelAnswer } | { ok: false; error: ClassifyFailure<E> }
>;

/** The language model of this deployment: its providers in order, and the chain that classifies through them. */
export type LanguageModel = Readonly<{
  providers: readonly LanguageModelProvider[];
  classify: <T, E>(
    ctx: CallContext,
    request: ClassificationRequest,
    options: ClassifyOptions<T, E>,
  ) => Promise<Classification<T, E>>;
}>;
