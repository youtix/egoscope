/**
 * Why the cache gave no answer: it failed, or it is paused for the rest of the month
 * after its allowance (module map §5).
 */
export type RuntimeCacheError = Readonly<{ kind: 'unavailable' }>;

/** The cache failed: the operation did nothing that the caller may count on. */
export type CacheFailure = Readonly<{ ok: false; error: RuntimeCacheError }>;

/**
 * The answer of every operation while the cache fails or is paused for the month,
 * after which an idle tick falls back to the hourly database check (module map §1.9;
 * TRV-25, TRV-31).
 */
export const UNAVAILABLE: CacheFailure = { ok: false, error: { kind: 'unavailable' } };
