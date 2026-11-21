// The expected failures of the statistics-source port, which every adapter maps its
// provider's answers to (module map §5; statistics-source evaluation, section 12).
import type { SourcePlayerId } from './types';

/**
 * Why an operation failed:
 * - `unavailable`: an outage — a network error, a timeout, a server error or an unreadable answer (CL-STA-15);
 * - `rate_limited`: a quota answer, with the delay the source asks for when it gives one (STA-39);
 * - `not_published`: a season, or a season's file, that the source does not hold (CL-STA-22, CL-STA-30);
 * - `not_found`: requested players that no file read lists;
 * - `schema_changed`: a layout the adapter does not expect, or a game's day that disagrees with its tip-off;
 * - `unauthorized`: credentials the source refuses;
 * - `aborted`: the call context's signal stopped the call.
 */
export type StatsSourceError =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'rate_limited'; retryAfterMs: number | null }>
  | Readonly<{ kind: 'not_published' }>
  | Readonly<{ kind: 'not_found'; players: readonly SourcePlayerId[] }>
  | Readonly<{ kind: 'schema_changed' }>
  | Readonly<{ kind: 'unauthorized' }>
  | Readonly<{ kind: 'aborted' }>;

/** The kind of a statistics-source failure. */
export type StatsSourceErrorKind = StatsSourceError['kind'];
