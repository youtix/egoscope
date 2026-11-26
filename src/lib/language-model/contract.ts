// The behavior every provider of the language-model chain shares, the fakes and each real
// adapter alike (module map §2.3, §5): the port's own tests run each case against the
// fakes, and against the recorded answers of each real adapter, and expect what it
// observed to equal what the port promises. Never re-exported by index.ts.
import { now, toEpochMs } from '@/lib/time';

import type {
  CallContext,
  ClassificationRequest,
  LanguageModelProvider,
  ProviderOutcome,
} from './types';

/** A fault that the harness makes the provider's next call meet. */
export type ContractFault = 'quotaRefused' | 'minuteLimit' | 'slow';

/** A provider under test, and how to make its next call meet a fault. */
export type ProviderHarness = Readonly<{
  provider: LanguageModelProvider;
  inject: (fault: ContractFault) => void;
}>;

// What a case observed, and what the port promises: the test that runs the case asserts they are equal.
type ContractCheck = Readonly<{ observed: unknown; promised: unknown }>;

type ContractCase = (harness: ProviderHarness) => Promise<ContractCheck>;

/** A deadline that no answer under test comes near. */
const DEADLINE_MS = 10_000;
/** A deadline that a slow answer outlasts. */
const SHORT_DEADLINE_MS = 20;
/** How long after its start a slow call is cancelled, well before its deadline. */
const CANCEL_AFTER_MS = 20;
// How much later than its deadline a timed-out call may end: timers fire late under load.
const LATENESS_MS = 1000;
const ARTICLES = ['article-1', 'article-2'];

const REQUEST: ClassificationRequest = {
  staticPart: {
    instructions: 'Report the facts that each article tells of each recognized player.',
    typeSheets: 'Type sheets: none.',
    doNotRepropose: 'Do not repropose: none.',
  },
  articles: ARTICLES.map((id) => ({ id, text: `Title and excerpt of ${id}.` })),
  schema: { name: 'classification', schema: { type: 'object', additionalProperties: false } },
};

function context(deadlineMs = DEADLINE_MS): CallContext {
  return { deadline: toEpochMs(now() + deadlineMs), signal: new AbortController().signal };
}

// The identifiers of the request's articles that an answer names, none when it is not JSON.
function namedArticles(outcome: ProviderOutcome): readonly string[] {
  if (!outcome.ok) {
    return [];
  }
  try {
    const text = JSON.stringify(JSON.parse(outcome.value));
    return ARTICLES.filter((id) => text.includes(JSON.stringify(id)));
  } catch {
    return [];
  }
}

const kindOf = (outcome: ProviderOutcome): string => (outcome.ok ? 'answer' : outcome.error.kind);

async function namesEachArticle({ provider }: ProviderHarness): Promise<ContractCheck> {
  const outcome = await provider.complete(context(), REQUEST);
  return { observed: namedArticles(outcome), promised: ARTICLES };
}

async function reportsItsCost({ provider }: ProviderHarness): Promise<ContractCheck> {
  const { call } = await provider.complete(context(), REQUEST);
  return {
    observed: [call.httpRequests, call.tokens > 0, call.neurons >= 0],
    promised: [1, true, true],
  };
}

async function reportsQuotaRefusal({ provider, inject }: ProviderHarness): Promise<ContractCheck> {
  inject('quotaRefused');
  const outcome = await provider.complete(context(), REQUEST);
  return { observed: kindOf(outcome), promised: 'quota_refused' };
}

async function reportsMinuteLimit({ provider, inject }: ProviderHarness): Promise<ContractCheck> {
  inject('minuteLimit');
  const outcome = await provider.complete(context(), REQUEST);
  const delay =
    !outcome.ok && outcome.error.kind === 'rate_limited' ? outcome.error.retryAfterMs : null;
  return {
    observed: [kindOf(outcome), delay !== null && delay > 0],
    promised: ['rate_limited', true],
  };
}

async function timesOut({ provider, inject }: ProviderHarness): Promise<ContractCheck> {
  inject('slow');
  const ctx = context(SHORT_DEADLINE_MS);
  const outcome = await provider.complete(ctx, REQUEST);
  return {
    observed: [kindOf(outcome), now() <= ctx.deadline + LATENESS_MS],
    promised: ['timeout', true],
  };
}

async function endsWhenCancelled({ provider, inject }: ProviderHarness): Promise<ContractCheck> {
  inject('slow');
  const controller = new AbortController();
  const startedAt = now();
  setTimeout(() => {
    controller.abort();
  }, CANCEL_AFTER_MS);
  const outcome = await provider.complete({ ...context(), signal: controller.signal }, REQUEST);
  return {
    observed: [kindOf(outcome), now() <= startedAt + CANCEL_AFTER_MS + LATENESS_MS],
    promised: ['timeout', true],
  };
}

async function endsAfterDeadline({ provider }: ProviderHarness): Promise<ContractCheck> {
  const outcome = await provider.complete(context(-1), REQUEST);
  return {
    observed: [kindOf(outcome), outcome.call.httpRequests],
    promised: ['timeout', 0],
  };
}

/** The ceiling of one request is a positive whole number of tokens. */
async function declaresCeiling({ provider }: ProviderHarness): Promise<ContractCheck> {
  await Promise.resolve();
  const ceiling = provider.requestCeilingTokens;
  return { observed: Number.isSafeInteger(ceiling) && ceiling > 0, promised: true };
}

/**
 * The behaviors that every provider of the chain shows, by title (module map §2.3, §5):
 * one answer that names each article of the request (DET-12); its request and tokens
 * reported; a refusal for quota reported as such, before the declared limit
 * included (TRV-06); a minute limit with the delay to wait; a timeout at the deadline,
 * at once when the call's signal cancels it, and without sending the request when the
 * deadline has come before the call; and the ceiling of one request in tokens, by which
 * callers size their batches.
 */
export const LANGUAGE_MODEL_CONTRACT: Readonly<Record<string, ContractCase>> = {
  '[DET-12] answers a request of several articles with JSON that names each one': namesEachArticle,
  'reports the one request and the tokens that its call cost': reportsItsCost,
  '[TRV-06] reports a refusal for quota as quota_refused': reportsQuotaRefusal,
  'reports a minute limit as rate_limited, with the delay to wait': reportsMinuteLimit,
  'answers timeout when its answer outlasts the deadline, without waiting past it': timesOut,
  'answers timeout at once when its signal cancels the call, without waiting for the answer':
    endsWhenCancelled,
  'sends nothing and answers timeout once the deadline has come': endsAfterDeadline,
  'declares the ceiling in tokens of one request': declaresCeiling,
};
