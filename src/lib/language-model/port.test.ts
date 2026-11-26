import { beforeEach, describe, expect, it, vi } from 'vitest';

// Where the process keeps its one fake.
const SHARED_FAKE = Symbol.for('egoscope.language-model.fake');

/** The port of a server whose configuration holds `variables`: its modules load afresh. */
async function portWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./port');
}

describe('languageModel', () => {
  beforeEach(() => {
    // Each test is a fresh process, which holds no fake yet.
    vi.stubGlobal(SHARED_FAKE, undefined);
  });

  it('[DET-08] answers "not configured" while no real provider serves, so that nothing is called', async () => {
    const { languageModel } = await portWith({});

    expect(languageModel()).toStrictEqual({ ok: false, error: { kind: 'not_configured' } });
  });

  it("[DET-08] serves the chain of the process's fakes when EGOSCOPE_FAKES names the port, the fallback once configured", async () => {
    const { fakeLanguageModel, languageModel } = await portWith({
      EGOSCOPE_FAKES: 'language-model',
    });
    const alone = languageModel();
    fakeLanguageModel().setFallback(true);
    const chained = languageModel();

    expect(alone.ok && alone.model.providers.map(({ name }) => name)).toStrictEqual(['workersAi']);
    expect(chained.ok && chained.model.providers).toStrictEqual([
      fakeLanguageModel().primary,
      fakeLanguageModel().fallback,
    ]);
  });

  it('gives one fake to every copy of the module', async () => {
    const first = await portWith({ EGOSCOPE_FAKES: 'all' });
    const second = await portWith({ EGOSCOPE_FAKES: 'all' });

    expect(second).not.toBe(first);
    expect(second.fakeLanguageModel()).toBe(first.fakeLanguageModel());
  });
});
