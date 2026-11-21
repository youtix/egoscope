// What crosses the link-check port (module map §5): an address to open, and what
// came of opening it. Only "not found" is ever stored by the caller (CL-IMP-25).
import type { EpochMs } from '@/lib/time';

/** The deadline and abort signal of one call, inside the budget of its tick (module map §5). */
export type CallContext = Readonly<{ deadline: EpochMs; signal: AbortSignal }>;

/** What one probe cost: every HTTP request it made, each redirect followed included. */
export type CallMetadata = Readonly<{ httpRequests: number }>;

/**
 * What opening a link showed (IMP-17, CL-IMP-25): `not_found` for a final 404 or
 * 410, or a host name that does not resolve; `reachable` for a page that answered;
 * `unreachable` for any other outcome — another status, a timeout, a connection or
 * certificate failure, too many redirects, an address that is not a web address.
 */
export type LinkVerdict = 'reachable' | 'not_found' | 'unreachable';

/** A probe's verdict, with the final HTTP status, or null when no answer came. */
export type LinkProbe = Readonly<{ verdict: LinkVerdict; status: number | null }>;

/** The link to open, and how long its whole probe may last, redirects included, in milliseconds. */
export type ProbeRequest = Readonly<{ url: string; timeoutMs: number }>;
