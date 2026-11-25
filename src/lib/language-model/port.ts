import { adapterFor } from '@/lib/env';

import { createChain } from './chain';
import { createFakeLanguageModel } from './fake';

import type { FakeLanguageModel } from './fake';
import type { LanguageModel } from './types';

/** The language model that this deployment uses, or why it has none. */
export type LanguageModelAccess =
  | Readonly<{ ok: true; model: LanguageModel }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'not_configured' }> }>;

const NOT_CONFIGURED: LanguageModelAccess = { ok: false, error: { kind: 'not_configured' } };

// The fake of the whole process lives on globalThis under a registered symbol, so that
// every copy of this module (a bundle layer of the server, a reload of `next dev`)
// serves the same scripts.
const SHARED_FAKE = Symbol.for('egoscope.language-model.fake');

const isFake = (value: unknown): value is FakeLanguageModel =>
  typeof value === 'object' && value !== null && 'setFallback' in value;

/**
 * The fake chain that the whole process shares, created at its first use, which the
 * accessor serves under EGOSCOPE_FAKES and the hermetic end-to-end controls script
 * (module map §5, TRV-16).
 */
export function fakeLanguageModel(): FakeLanguageModel {
  const existing: unknown = Reflect.get(globalThis, SHARED_FAKE);
  if (isFake(existing)) {
    return existing;
  }
  const fake = createFakeLanguageModel();
  Reflect.set(globalThis, SHARED_FAKE, fake);
  return fake;
}

/**
 * The language model of this server, which `env.adapterFor` chooses (module map §5):
 * the chain of the process's fake providers, the fallback only while configured; the
 * real providers, which this build does not hold yet, are "not configured" meanwhile, so
 * that classification waits without calling anything (DET-08).
 */
export function languageModel(): LanguageModelAccess {
  return adapterFor('language-model') === 'fake'
    ? { ok: true, model: createChain(fakeLanguageModel().providers()) }
    : NOT_CONFIGURED;
}
