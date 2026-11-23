// What each guarded service's call used, read from its port's outcome by a reader of its
// own, since the ports report their metadata in shapes of their own (module map §5).
import { toEpochMs } from '@/lib/time';

import type { Measure, QuotaService } from './limits';
import type { BackupStorageOutcome } from '@/lib/backup-storage';
import type { StatsSourceOutcome } from '@/lib/stats-source';
import type { EpochMs } from '@/lib/time';

/**
 * What a language-model call reports, which the outcome of that Lot 2 port carries
 * (module map §5, language-model): its requests, its tokens (cached ones not counted),
 * Workers AI's neurons, and the instants that Groq's `x-ratelimit-reset-requests` and
 * `x-ratelimit-reset-tokens` headers report (CL-TRV-12).
 */
export type ModelCallMetadata = Readonly<{
  httpRequests: number;
  tokens: number;
  neurons: number;
  requestsResetAt: EpochMs | null;
  tokensResetAt: EpochMs | null;
}>;

/** What a Telegram call reports, which the outcome of that Lot 2 port carries: the messages it sent. */
export type TelegramCallMetadata = Readonly<{ httpRequests: number; messages: number }>;

/** A failure of a Lot 2 port: a refusal for quota carries the delay its provider asks for. */
type Lot2Failure = Readonly<{ kind: string; retryAfterMs?: number | null }>;

/** The outcome of a Lot 2 port with its call metadata `M`. */
type Lot2Outcome<M> = Readonly<{ ok: true; call: M } | { ok: false; error: Lot2Failure; call: M }>;

/** The outcome of each guarded service's port, which its reader reads. */
export type OutcomeOf = Readonly<{
  statsSource: StatsSourceOutcome<unknown>;
  workersAi: Lot2Outcome<ModelCallMetadata>;
  groq: Lot2Outcome<ModelCallMetadata>;
  backupStorage: BackupStorageOutcome<unknown>;
  telegram: Lot2Outcome<TelegramCallMetadata>;
}>;

/**
 * What a call used: its amounts by measure, the reset instants its provider reported
 * by measure, and its refusal for quota with the instant it may be retried (TRV-03,
 * TRV-06, CL-TRV-12).
 */
export type CallUsage = Readonly<{
  amounts: Readonly<Partial<Record<Measure, number>>>;
  resets: Readonly<Partial<Record<Measure, EpochMs>>>;
  refusal: Readonly<{ retryAt: EpochMs | null }> | null;
}>;

// The failures that are a refusal for quota, of the stats source, the language models
// and Telegram (CL-STA-15, module map §5).
const QUOTA_FAILURES: ReadonlySet<string> = new Set(['rate_limited', 'quota_refused']);

/** The refusal of a failure that asks to wait `retryAfterMs` from `at`, if it is one for quota. */
function refusalOf(error: Lot2Failure | null, at: EpochMs): CallUsage['refusal'] {
  if (error === null || !QUOTA_FAILURES.has(error.kind)) {
    return null;
  }
  const delay = error.retryAfterMs ?? null;
  return { retryAt: delay === null ? null : toEpochMs(at + delay) };
}

const failureOf = (outcome: Readonly<{ ok: boolean; error?: Lot2Failure }>) =>
  outcome.ok ? null : (outcome.error ?? null);

/** The reset instants a provider reported, by measure, without those it did not. */
function reported(entries: readonly (readonly [Measure, EpochMs | null])[]): CallUsage['resets'] {
  const resets: Partial<Record<Measure, EpochMs>> = {};
  for (const [measure, resetsAt] of entries) {
    if (resetsAt !== null) {
      resets[measure] = resetsAt;
    }
  }
  return resets;
}

function modelUsage(outcome: OutcomeOf['groq'], at: EpochMs): CallUsage {
  const { call } = outcome;
  return {
    amounts: { requests: call.httpRequests, tokens: call.tokens, neurons: call.neurons },
    resets: reported([
      ['requests', call.requestsResetAt],
      ['tokens', call.tokensResetAt],
    ]),
    refusal: refusalOf(failureOf(outcome), at),
  };
}

type Readers = { [S in QuotaService]: (outcome: OutcomeOf[S], at: EpochMs) => CallUsage };

const READERS: Readers = {
  // The file requests the source's ceilings count and the bytes received (CL-STA-15).
  statsSource: (outcome, at) => ({
    amounts: { requests: outcome.call.fileRequests, bytes: outcome.call.bytesReceived },
    resets: {},
    refusal: refusalOf(failureOf(outcome), at),
  }),
  workersAi: modelUsage,
  groq: modelUsage,
  // GitHub's requests and the reset its `x-ratelimit-reset` header reports, which a
  // refusal waits for: a header's reset, not a retry-after (backup storage sheet).
  backupStorage: (outcome) => {
    const isRefused = !outcome.ok && outcome.error.kind === 'rate_limited';
    return {
      amounts: { requests: outcome.call.httpRequests },
      resets: reported([['requests', outcome.call.rateLimitResetsAt]]),
      refusal: isRefused ? { retryAt: null } : null,
    };
  },
  telegram: (outcome, at) => ({
    amounts: { messages: outcome.call.messages },
    resets: {},
    refusal: refusalOf(failureOf(outcome), at),
  }),
};

/** What the call to `service` that answered `outcome` at `at` used (TRV-03). */
export function usageOf<S extends QuotaService>(
  service: S,
  outcome: OutcomeOf[S],
  at: EpochMs,
): CallUsage {
  const read: (outcome: OutcomeOf[S], at: EpochMs) => CallUsage = READERS[service];
  return read(outcome, at);
}
