// What the log says of a call that threw inside a pass: a handler or a ready guard.
import type { LogFields } from '@/lib/log';

/**
 * What the log says of what a handler or a ready guard threw, whose run is recorded as
 * failed (CL-TRV-07): the error's name and, for a failed query, the driver's SQL state, never
 * its message, which for a query holds every bound parameter and so the owner's text (module
 * map §2.1 `log`).
 */
export function thrownFacts(thrown: unknown): LogFields {
  if (!(thrown instanceof Error)) {
    return { error: typeof thrown };
  }
  const { cause } = thrown;
  const code: unknown = cause instanceof Object && 'code' in cause ? cause.code : null;
  return typeof code === 'string' ? { error: thrown.name, code } : { error: thrown.name };
}
