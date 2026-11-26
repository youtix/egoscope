// The expected failures of the press-feeds port, which every adapter maps the
// answers of a feed's server to (module map §5).

/**
 * Why a read failed (COL-02, COL-41):
 * - `unreachable`: no answer — a network error, a host that does not resolve, or a call
 *   past its deadline or stopped by its signal;
 * - `http_error`: an error status, which it gives;
 * - `requires_identification`: the feed asks for an account or a subscription (COL-02);
 * - `not_a_feed`: a readable answer in no standard syndication format, such as a web page;
 * - `unreadable`: a feed whose content cannot be read, such as broken XML.
 */
export type PressFeedsError =
  | Readonly<{ kind: 'unreachable' }>
  | Readonly<{ kind: 'http_error'; status: number }>
  | Readonly<{ kind: 'requires_identification' }>
  | Readonly<{ kind: 'not_a_feed' }>
  | Readonly<{ kind: 'unreadable' }>;

/** The kind of a press-feeds failure. */
export type PressFeedsErrorKind = PressFeedsError['kind'];
