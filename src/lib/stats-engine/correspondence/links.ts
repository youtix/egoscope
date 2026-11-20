// The link cleaning of COL-28, built in Lot 1 for the link comparison of the import
// (CL-IMP-14) and reused in Lot 2 by collection, which stores, shows and deduplicates
// cleaned links (COL-28, COL-30) and compares feed addresses with them (CL-COL-18). A
// link is read by hand as RFC 3986 writes it: the pure core has no URL parser, and one
// would also rewrite what the rulings keep as written, such as percent-encodings, dot
// segments and host names.

/**
 * The ad-tracking parameters that the cleaning removes from the query of a link
 * (CL-COL-23): every parameter whose name starts with the prefix, and the click
 * identifiers named, names compared without regard to case. The list is closed, so
 * that two links to different articles are never taken for one: extending it is a
 * change of this constant, never a setting.
 */
const AD_TRACKING_PARAMETERS: Readonly<{ namePrefix: string; names: ReadonlySet<string> }> = {
  namePrefix: 'utm_',
  names: new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']),
};

/** The default port of each scheme, as it ends an authority that names it (CL-IMP-14). */
const DEFAULT_PORTS: readonly Readonly<{ scheme: string; suffix: string }>[] = [
  { scheme: 'http', suffix: ':80' },
  { scheme: 'https', suffix: ':443' },
];

// The scheme that starts a link (RFC 3986, section 3.1: a letter, then letters, digits,
// `+`, `.` or `-`), then `://` and the authority, up to the path.
const SCHEME_AND_AUTHORITY = /^([a-z][\d+.a-z-]*):\/\/([^/]*)/iu;

// `text` before the first `separator`, and what follows it, undefined when it holds none.
function splitAt(text: string, separator: string): readonly [string, string | undefined] {
  const index = text.indexOf(separator);
  return index === -1
    ? [text, undefined]
    : [text.slice(0, index), text.slice(index + separator.length)];
}

// Whether a parameter of a query, `name=value` or a name alone, tracks a campaign or a
// click (CL-COL-23).
function isAdTracking(parameter: string): boolean {
  const [name] = splitAt(parameter, '=');
  const lowerName = name.toLowerCase();
  return (
    lowerName.startsWith(AD_TRACKING_PARAMETERS.namePrefix) ||
    AD_TRACKING_PARAMETERS.names.has(lowerName)
  );
}

// The query without its ad-tracking parameters and its empty ones, the empty pieces
// between, before or after its `&`, as in `?&id=7`, `?id=7&&page=2` or `?id=7&`; the
// others in their order with their values, behind its `?` unless none remains, as after
// a `?` alone; nothing without a query.
function cleanQuery(query: string | undefined): string {
  if (query === undefined) {
    return '';
  }
  const kept = query.split('&').filter((parameter) => parameter !== '' && !isAdTracking(parameter));
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
}

// A host and its port without the default port of the scheme.
function withoutDefaultPort(hostAndPort: string, scheme: string): string {
  const defaultPort = DEFAULT_PORTS.find(
    (port) => port.scheme === scheme && hostAndPort.endsWith(port.suffix),
  );
  return defaultPort === undefined ? hostAndPort : hostAndPort.slice(0, -defaultPort.suffix.length);
}

// An authority with its host in lowercase and without the default port of the scheme.
// The user information, up to its last `@`, keeps its case.
function cleanAuthority(authority: string, scheme: string): string {
  const hostStart = authority.lastIndexOf('@') + 1;
  const hostAndPort = authority.slice(hostStart).toLowerCase();
  return authority.slice(0, hostStart) + withoutDefaultPort(hostAndPort, scheme);
}

// The link before its query, its scheme and authority cleaned and its path as written.
// A link that does not start with a scheme and `://` has no host to read: it stays as
// written.
function cleanAddress(address: string): string {
  return address.replace(
    SCHEME_AND_AUTHORITY,
    (_start: string, scheme: string, authority: string) => {
      const lowerScheme = scheme.toLowerCase();
      return `${lowerScheme}://${cleanAuthority(authority, lowerScheme)}`;
    },
  );
}

/**
 * A link cleaned as COL-28 and CL-COL-23 say: the ad-tracking parameters removed from
 * its query, and its empty parameters too, the empty pieces of the query split at each
 * `&`, as in `?&id=7`, `?id=7&&page=2` or `?id=7&`; the other parameters kept in their
 * order with their values, and the `?` dropped when none remains, as after a `?` alone;
 * its scheme and host in lowercase; the default port of its scheme, 80 for http and 443
 * for https, and its fragment removed (CL-IMP-14). Nothing else changes: the path and
 * the remaining parameters stay exactly as written, `http` and `https` differ, a `www.`
 * prefix makes another host and a trailing slash another path. A link that does not
 * start with a scheme and `://` only loses its tracking and empty parameters and its
 * fragment. It is the form in which the import compares links (IMP-25) and in which
 * collection keeps, shows and deduplicates them in Lot 2 (COL-28, CL-COL-18).
 */
export function cleanLink(url: string): string {
  const [beforeFragment] = splitAt(url, '#');
  const [address, query] = splitAt(beforeFragment, '?');
  return cleanAddress(address) + cleanQuery(query);
}

/**
 * Whether two links designate the same article for the import's correspondence
 * (IMP-25, CL-IMP-14), or the same feed for collection in Lot 2 (CL-COL-18): they are
 * identical once cleaned by `cleanLink`.
 */
export function isSameLink(url: string, otherUrl: string): boolean {
  return cleanLink(url) === cleanLink(otherUrl);
}
