import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { err, ok } from '@/lib/result';
import { now, toEpochMs } from '@/lib/time';

import { createChain } from './chain';
import { createFakeLanguageModel } from './fake';

import type {
  Budget,
  CallContext,
  CallMetadata,
  ClassificationRequest,
  LanguageModelProvider,
  ModelAnswer,
  ProviderName,
  ProviderOutcome,
} from './types';
import type { Result } from '@/lib/result';

const DEADLINE_MS = 10_000;
const RESUMES_AT = toEpochMs(Date.UTC(2026, 10, 26));
const CALL: CallMetadata = {
  httpRequests: 1,
  tokens: 1,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};
const REQUEST: ClassificationRequest = {
  staticPart: {
    instructions: 'Instructions.',
    typeSheets: 'Type sheets.',
    doNotRepropose: 'None.',
  },
  articles: [{ id: 'article-1', text: 'Title and excerpt.' }],
  schema: { name: 'classification', schema: { type: 'object' } },
};

const context = (): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal: new AbortController().signal,
});

// Lets every call through, as a budget with room left does.
const open: Budget = async (_provider, call) => ok(await call());

// Reads an answer as usable when it is JSON.
function parses({ raw }: ModelAnswer): Result<unknown, 'not_json'> {
  try {
    return ok(JSON.parse(raw));
  } catch {
    return err('not_json');
  }
}

/** What a scripted call meets: its budget's deferral, a failure, or an answer the validator takes or refuses. */
const OUTCOMES = [
  'deferred',
  'quota_refused',
  'rate_limited',
  'unavailable',
  'timeout',
  'schema_not_met',
  'malformed',
  'unusable',
  'usable',
] as const;
type Scripted = (typeof OUTCOMES)[number];
const USES_ATTEMPT: ReadonlySet<Scripted> = new Set([
  'schema_not_met',
  'malformed',
  'unusable',
  'usable',
]);

// What the provider answers to a call that meets each outcome; a deferred call never reaches it.
const USABLE: ProviderOutcome = { ok: true, value: 'usable', call: CALL };
const ANSWERS: ReadonlyMap<Scripted, ProviderOutcome> = new Map<Scripted, ProviderOutcome>([
  ['quota_refused', { ok: false, error: { kind: 'quota_refused' }, call: CALL }],
  ['rate_limited', { ok: false, error: { kind: 'rate_limited', retryAfterMs: null }, call: CALL }],
  ['unavailable', { ok: false, error: { kind: 'unavailable' }, call: CALL }],
  ['timeout', { ok: false, error: { kind: 'timeout' }, call: CALL }],
  ['schema_not_met', { ok: false, error: { kind: 'schema_not_met' }, call: CALL }],
  ['malformed', { ok: false, error: { kind: 'malformed' }, call: CALL }],
  ['unusable', { ok: true, value: 'unusable', call: CALL }],
]);

/** Providers and a budget that meet `script` call after call, and the log of the calls in order. */
function scriptedChain(names: readonly ProviderName[], script: readonly Scripted[]) {
  const pending = [...script];
  const log: (readonly [ProviderName, Scripted])[] = [];
  const providers: LanguageModelProvider[] = names.map((name) => ({
    name,
    model: `model-${name}`,
    requestCeilingTokens: 1,
    complete: async () => {
      await Promise.resolve();
      const met = log.at(-1)?.[1];
      return (met === undefined ? undefined : ANSWERS.get(met)) ?? USABLE;
    },
  }));
  const budget: Budget = async (provider, call) => {
    const next = pending.shift() ?? 'usable';
    log.push([provider, next]);
    return next === 'deferred'
      ? err({ kind: 'deferred', availableAt: RESUMES_AT })
      : ok(await call());
  };
  return { chain: createChain(providers), budget, log };
}

/**
 * The providers that the chain must have called, given what each call met: the primary
 * first; after each call, the other provider while it is open, else the same one; a
 * provider that was deferred or failed without an answer never again.
 */
function replay(
  providers: readonly ProviderName[],
  log: readonly (readonly [ProviderName, Scripted])[],
) {
  const passedBy = new Set<ProviderName>();
  const order: (ProviderName | undefined)[] = [];
  let next: ProviderName | undefined = providers[0];
  for (const [, outcome] of log) {
    const current = next;
    order.push(current);
    if (current === undefined) {
      break;
    }
    if (!USES_ATTEMPT.has(outcome)) {
      passedBy.add(current);
    }
    const other = providers.find((name) => name !== current && !passedBy.has(name));
    next = other ?? (passedBy.has(current) ? undefined : current);
  }
  return { order, passedBy };
}

const validate = ({ raw }: ModelAnswer): Result<string, string> =>
  raw === 'usable' ? ok(raw) : err(raw);

describe('createChain', () => {
  it('[DET-22] [DET-08] [CL-DET-03] passes by a deferred or failing provider, resends an unusable answer to the next open one, and never exceeds the attempts', async () => {
    const names = fc.constantFrom<readonly ProviderName[]>(['workersAi'], ['workersAi', 'groq']);
    const script = fc.array(fc.constantFrom(...OUTCOMES), { minLength: 1, maxLength: 12 });
    await fc.assert(
      fc.asyncProperty(
        names,
        script,
        fc.integer({ min: 1, max: 5 }),
        async (providers, outcomes, attempts) => {
          const { chain, budget, log } = scriptedChain(providers, outcomes);
          const result = await chain.classify(context(), REQUEST, { budget, validate, attempts });
          const used = log.filter(([, outcome]) => USES_ATTEMPT.has(outcome)).length;
          const { order, passedBy } = replay(providers, log);
          const isAnswered = log.at(-1)?.[1] === 'usable';
          const isExhausted = used === attempts;

          expect(log.map(([provider]) => provider)).toStrictEqual(order);
          expect(used).toBeLessThanOrEqual(attempts);
          expect(isAnswered || isExhausted || passedBy.size === providers.length).toBe(true);
          expect(
            result.ok ? 'answered' : [result.error.kind, result.error.steps.length],
          ).toStrictEqual(
            isAnswered
              ? 'answered'
              : [isExhausted ? 'attempts_exhausted' : 'unanswered', log.length],
          );
        },
      ),
    );
  });

  it('[DET-22] [CL-DET-03] sends the request of an unusable answer once more, to the next provider, and returns its answer with who gave it', async () => {
    const fakes = createFakeLanguageModel();
    fakes.setFallback(true);
    fakes.primary.script('article-1', { kind: 'schema_breaking' });
    const result = await createChain(fakes.providers()).classify(context(), REQUEST, {
      budget: open,
      validate: parses,
      attempts: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { articles: [{ article: 'article-1', facts: [], proposals: [] }] },
      answer: { provider: 'groq', model: 'fake-groq' },
    });
    expect(fakes.fallback.received()).toStrictEqual(fakes.primary.received());
  });

  it('[DET-08] [CL-DET-04] with no fallback configured, classifies with the primary alone and gives it the further attempt', async () => {
    const fakes = createFakeLanguageModel();
    fakes.primary.failNext({ kind: 'malformed' });
    const chain = createChain(fakes.providers());
    const result = await chain.classify(context(), REQUEST, {
      budget: open,
      validate: parses,
      attempts: 2,
    });

    expect(chain.providers.map(({ name }) => name)).toStrictEqual(['workersAi']);
    expect(fakes.primary.received()).toStrictEqual([REQUEST, REQUEST]);
    expect(result).toMatchObject({
      ok: true,
      answer: { provider: 'workersAi', model: 'fake-workers-ai' },
    });
  });

  it('[DET-08] [CL-DET-03] keeps a classification unanswered, using no attempt, when every budget defers', async () => {
    const fakes = createFakeLanguageModel();
    fakes.setFallback(true);
    const asked: ProviderName[] = [];
    const deferred: Budget = async (provider) => {
      asked.push(provider);
      await Promise.resolve();
      return err({ kind: 'deferred', availableAt: RESUMES_AT });
    };
    const result = await createChain(fakes.providers()).classify(context(), REQUEST, {
      budget: deferred,
      validate: parses,
      attempts: 2,
    });

    expect(asked).toStrictEqual(['workersAi', 'groq']);
    expect(fakes.primary.received()).toStrictEqual([]);
    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: 'unanswered',
        steps: [
          {
            provider: 'workersAi',
            model: 'fake-workers-ai',
            kind: 'deferred',
            availableAt: RESUMES_AT,
          },
          { provider: 'groq', model: 'fake-groq', kind: 'deferred', availableAt: RESUMES_AT },
        ],
      },
    });
  });
});
