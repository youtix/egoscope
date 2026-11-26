import { describe, expect, it } from 'vitest';

import { LANGUAGE_MODEL_CONTRACT } from './contract';
import { createFakeLanguageModel } from './fake';

import type { ContractFault, ProviderHarness } from './contract';
import type { FakeProvider } from './fake';
import type { CallMetadata, LanguageModelProvider, ProviderOutcome } from './types';

// Longer than the short deadline of the contract and than the wait that its cancellation
// case allows (20 ms, then 1,000 ms of lateness), so that a fake that ignores its call's
// signal fails that case.
const SLOW_MS = 2000;
const MINUTE_DELAY_MS = 30_000;
const CALL: CallMetadata = {
  httpRequests: 1,
  tokens: 0,
  neurons: 0,
  requestsResetAt: null,
  tokensResetAt: null,
};

function fakeHarness(
  pick: (fakes: ReturnType<typeof createFakeLanguageModel>) => FakeProvider,
): ProviderHarness {
  const provider = pick(createFakeLanguageModel());
  const faults: Readonly<Record<ContractFault, () => void>> = {
    quotaRefused: () => provider.failNext({ kind: 'quota_refused' }),
    minuteLimit: () => provider.failNext({ kind: 'rate_limited', retryAfterMs: MINUTE_DELAY_MS }),
    slow: () => provider.slowNext(SLOW_MS),
  };
  return { provider, inject: (fault) => faults[fault]() };
}

/** A harness whose provider answers every call with `answer`, whatever was injected. */
function harnessAnswering(
  answer: (fault: ContractFault | null) => ProviderOutcome,
  requestCeilingTokens: number,
): ProviderHarness {
  let injected: ContractFault | null = null;
  const provider: LanguageModelProvider = {
    name: 'groq',
    model: 'broken',
    requestCeilingTokens,
    complete: async () => {
      await Promise.resolve();
      const fault = injected;
      injected = null;
      return answer(fault);
    },
  };
  return {
    provider,
    inject: (fault) => {
      injected = fault;
    },
  };
}

// Names no article, counts two requests and no token, and reads every fault wrongly.
const BROKEN: Readonly<Record<ContractFault | 'none', ProviderOutcome>> = {
  none: { ok: true, value: '{"articles":[]}', call: { ...CALL, httpRequests: 2 } },
  quotaRefused: { ok: false, error: { kind: 'unavailable' }, call: CALL },
  minuteLimit: { ok: false, error: { kind: 'rate_limited', retryAfterMs: null }, call: CALL },
  slow: { ok: true, value: '{"articles":[]}', call: CALL },
};

describe('the Workers AI fake against the language-model contract', () => {
  it.each(Object.entries(LANGUAGE_MODEL_CONTRACT))('%s', async (_title, run) => {
    const { observed, promised } = await run(fakeHarness(({ primary }) => primary));

    expect(observed).toStrictEqual(promised);
  });
});

describe('the Groq fake against the language-model contract', () => {
  it.each(Object.entries(LANGUAGE_MODEL_CONTRACT))('%s', async (_title, run) => {
    const { observed, promised } = await run(fakeHarness(({ fallback }) => fallback));

    expect(observed).toStrictEqual(promised);
  });
});

describe('the language-model contract against providers that break it', () => {
  it.each(Object.entries(LANGUAGE_MODEL_CONTRACT))(
    'fails a provider that answers every call unavailable: %s',
    async (_title, run) => {
      const harness = harnessAnswering(
        () => ({ ok: false, error: { kind: 'unavailable' }, call: CALL }),
        0,
      );
      const { observed, promised } = await run(harness);

      expect(observed).not.toStrictEqual(promised);
    },
  );

  it.each(Object.entries(LANGUAGE_MODEL_CONTRACT))(
    'fails a provider that answers wrongly: %s',
    async (_title, run) => {
      const { observed, promised } = await run(
        harnessAnswering((fault) => BROKEN[fault ?? 'none'], 0.5),
      );

      expect(observed).not.toStrictEqual(promised);
    },
  );
});
