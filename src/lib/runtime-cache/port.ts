import { adapterFor } from '@/lib/env';

import { createFakeRuntimeCache } from './fake';
import { vercelRuntimeCache } from './vercel';

import type { FakeRuntimeCache } from './fake';
import type { RuntimeCache } from './types';

// The fake that serves this process lives on globalThis under a registered symbol,
// so that every copy of this module shares it: `next dev` evaluates a module again
// when it reloads it, and the requests of one process must see one store.
const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');

type ProcessFakes = Map<'process', FakeRuntimeCache>;

const isProcessFakes = (value: unknown): value is ProcessFakes => value instanceof Map;

/**
 * The fake Runtime Cache of this process, shared by all its requests (module map §5;
 * TRV-12): the one that `runtimeCache()` returns while EGOSCOPE_FAKES names the port,
 * which the tests and the hermetic mode drive to play the cache's faults (TRV-31) and
 * to measure its traffic against the allowance (TRV-04).
 */
export function processFakeRuntimeCache(): FakeRuntimeCache {
  const existing: unknown = Reflect.get(globalThis, PROCESS_FAKE);
  const fakes = isProcessFakes(existing) ? existing : new Map<'process', FakeRuntimeCache>();
  Reflect.set(globalThis, PROCESS_FAKE, fakes);
  const fake = fakes.get('process') ?? createFakeRuntimeCache();
  fakes.set('process', fake);
  return fake;
}

/**
 * The Runtime Cache that `env.adapterFor` chooses (module map §2.3; TRV-12): the
 * process's fake while EGOSCOPE_FAKES names `runtime-cache`, Vercel's otherwise. Nothing
 * is reached until an operation is called. It holds the wake plan, the tick records,
 * the inbound filter and the counters that let a tick or a refused call skip the
 * database (TRV-25, TRV-65, CL-TRV-25).
 */
export function runtimeCache(): RuntimeCache {
  return adapterFor('runtime-cache') === 'fake' ? processFakeRuntimeCache() : vercelRuntimeCache;
}
