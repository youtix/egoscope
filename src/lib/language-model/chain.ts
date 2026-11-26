// The provider chain of the language-model port (module map §5, and §10 point 10): the
// providers in order, each through the caller's budget, every answer through the caller's
// validator, an unusable answer sent once more to the next provider.
import { now } from '@/lib/time';

import { hasAnswer } from './errors';

import type {
  CallContext,
  ChainStep,
  Classification,
  ClassificationRequest,
  ClassifyOptions,
  LanguageModel,
  LanguageModelProvider,
  ProviderName,
} from './types';

/** The first provider from position `start` on, in a circle, that the chain has not passed by. */
function nextOpen(
  providers: readonly LanguageModelProvider[],
  passedBy: ReadonlySet<ProviderName>,
  start: number,
): LanguageModelProvider | undefined {
  const from = start % providers.length;
  return [...providers.slice(from), ...providers.slice(0, from)].find(
    ({ name }) => !passedBy.has(name),
  );
}

/** What one classification runs with: its call context, its request and the caller's options. */
type Run<T, E> = Readonly<{
  ctx: CallContext;
  request: ClassificationRequest;
  options: ClassifyOptions<T, E>;
}>;

/** One call of `provider` through the budget, read by the validator. */
async function tryProvider<T, E>(
  provider: LanguageModelProvider,
  { ctx, request, options: { budget, validate } }: Run<T, E>,
): Promise<Classification<T, E> | ChainStep<E>> {
  const { name, model } = provider;
  const admitted = await budget(name, async () => provider.complete(ctx, request));
  if (!admitted.ok) {
    return { provider: name, model, kind: 'deferred', availableAt: admitted.error.availableAt };
  }
  const outcome = admitted.value;
  if (!outcome.ok) {
    return { provider: name, model, kind: 'failed', error: outcome.error };
  }
  const answer = { raw: outcome.value, provider: name, model, call: outcome.call };
  const read = validate(answer);
  return read.ok
    ? { ok: true, value: read.value, answer }
    : { provider: name, model, kind: 'unusable', answer, reason: read.error };
}

const hasUsedAttempt = <E>(step: ChainStep<E>): boolean =>
  step.kind === 'unusable' || (step.kind === 'failed' && hasAnswer(step.error));

// Whether the call's bounds are gone, so that no further step can finish: its signal
// cancelled it, or its deadline has come.
const isOver = ({ deadline, signal }: CallContext): boolean => signal.aborted || now() >= deadline;

/**
 * Classifies `request` through `providers` in order (DET-22, CL-DET-03, module map §5):
 * each provider is called through the caller's budget, and passed by for the rest of the
 * classification when its budget defers the call or the call fails without an answer,
 * which uses no attempt (DET-08); an unusable answer, refused by the validator or by the
 * provider itself, uses one, and the same request goes to the next provider, or to the
 * same one when it is alone, until `attempts` are used. Once the call is cancelled or its
 * deadline has come, no further provider is called, nor its budget asked, and the
 * classification is `unanswered` with the steps so far.
 */
export function createChain(providers: readonly LanguageModelProvider[]): LanguageModel {
  async function classify<T, E>(
    ctx: CallContext,
    request: ClassificationRequest,
    options: ClassifyOptions<T, E>,
  ): Promise<Classification<T, E>> {
    const steps: ChainStep<E>[] = [];
    const passedBy = new Set<ProviderName>();
    let used = 0;
    let provider = nextOpen(providers, passedBy, 0);
    while (provider !== undefined && used < options.attempts && !isOver(ctx)) {
      const step = await tryProvider(provider, { ctx, request, options });
      if ('ok' in step) {
        return step;
      }
      steps.push(step);
      if (hasUsedAttempt(step)) {
        used += 1;
      } else {
        passedBy.add(provider.name);
      }
      provider = nextOpen(providers, passedBy, providers.indexOf(provider) + 1);
    }
    const kind = used >= options.attempts ? 'attempts_exhausted' : 'unanswered';
    return { ok: false, error: { kind, steps } };
  }
  return { providers, classify };
}
