// The engineering constants of the scheduler (module map §6, "Not parameters"), all
// derived from the host's function limit that the hosting sheet records.

/** The longest a function may run on the host: 300 seconds on Vercel Hobby (hosting sheet). */
const FUNCTION_LIMIT_MS = 300_000;

// A pass starts no chunk past this share of the function limit, so that the chunk it
// runs and the end of the pass fit in what is left.
const TICK_BUDGET_SHARE = 0.8;

/** The time a pass may spend starting chunks (TRV-30). */
export const PASS_BUDGET_MS = FUNCTION_LIMIT_MS * TICK_BUDGET_SHARE;

/**
 * Twice the function limit: a lease older than this is taken over, and a run without a
 * progress mark for this long is stale (CL-TRV-07).
 */
export const STALE_AFTER_MS = 2 * FUNCTION_LIMIT_MS;

/** A minute, in which the trigger's expected interval is set. */
export const MINUTE_MS = 60_000;

/** An hour: the plan's safety age, and the fallback's one database pass per instance (module map §1.9). */
export const HOUR_MS = 3_600_000;
