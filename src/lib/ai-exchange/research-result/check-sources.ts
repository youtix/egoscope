// The checks of a source (IMP-14): its link is a complete article address, no home page
// once cleaned (CL-IMP-15) and on no disallowed domain (DSN-01, DSN-03), and its
// publication date exists and is not in the future (CL-IMP-10); a source that fails is
// dropped with a warning, a missing outlet or title only warns. They know no event, so
// that the illustration sources of an exploration response take them as they are
// (CL-TAX-04). What an event adds, the lead over its public date (CL-IMP-11) and the
// oldest sources kept (CL-IMP-16), is here too, for check-events.ts to apply.
import { hasPossibleCitationMarker } from './text-signals';

import type { ExchangeDate } from '../conventions';
import type { DateWarning } from './dates';
import type { ResearchSource } from './format';

/** Why a source is dropped (IMP-14, CL-IMP-07, CL-IMP-10, CL-IMP-15), the glossary's `SourceDropCause`. */
export type SourceDropCause =
  | 'incomplete_address'
  | 'home_page'
  | 'disallowed_domain'
  | 'publication_date_missing'
  | 'publication_date_malformed'
  | 'publication_date_in_future';

/**
 * A warning on a source (IMP-14), an event-scope code of the glossary's
 * `ImportWarningKind`, with the source's 1-based position in its list (CL-IMP-02).
 */
export type SourceWarning =
  | Readonly<{ kind: 'source_dropped'; position: number; cause: SourceDropCause }>
  | Readonly<{ kind: 'source_outlet_or_title_missing'; position: number }>;

/**
 * A source that its checks keep (IMP-14): its 1-based position in its list, its link and
 * its texts trimmed, the link as the injected cleaning gives it, its publication date and
 * the warning that the spelling of that date gives, if any (CL-IMP-08).
 */
export type CheckedSource = Readonly<{
  position: number;
  url: string;
  cleanedUrl: string;
  outlet: string | undefined;
  title: string | undefined;
  publicationDate: ExchangeDate;
  dateWarning: DateWarning | undefined;
}>;

/**
 * What the checks of a source take from their caller: the link cleaning of COL-28, which
 * the engine owns (CL-IMP-14); the disallowed domains, lowercase, without scheme or path
 * (`imports.disallowedSourceDomains`, H-IMP-13); and the instant of the import, or of the
 * correction (CL-IMP-10).
 */
export type SourceCheckRules = Readonly<{
  cleanLink: (url: string) => string;
  disallowedDomains: readonly string[];
  checkedAt: number;
}>;

/** The sources that their checks keep, in their order, and the warnings that they give (IMP-14). */
export type SourceChecks = Readonly<{
  kept: readonly CheckedSource[];
  warnings: readonly SourceWarning[];
}>;

type Link = Readonly<{ url: string; cleanedUrl: string }>;

// The source as its link check leaves it: its link, or why it is dropped.
type LinkCheck =
  Readonly<{ ok: true; link: Link }> | Readonly<{ ok: false; cause: SourceDropCause }>;

// A link missing, or that is not a complete address (IMP-14).
const INCOMPLETE_ADDRESS: LinkCheck = { ok: false, cause: 'incomplete_address' };

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
// The zones farthest west and east, UTC−12 and UTC+14, between which a value with a time
// stands for each calendar date it has (CL-IMP-10, CL-IMP-11).
const WESTMOST_OFFSET_HOURS = -12;
const EASTMOST_OFFSET_HOURS = 14;
const WESTMOST_OFFSET_MS = WESTMOST_OFFSET_HOURS * MS_PER_HOUR;
const EASTMOST_OFFSET_MS = EASTMOST_OFFSET_HOURS * MS_PER_HOUR;

// A complete address (IMP-14): `https://` or `http://`, then a domain name, its labels of
// letters, digits and hyphens joined by dots, the last one starting with a letter, then a
// port, if any, and the rest of the link after a `/`, a `?` or a `#`, with no space.
const COMPLETE_ADDRESS =
  /^https?:\/\/((?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]*)(?::\d+)?(?:[/?#]\S*)?$/iu;

// A home page once the link is cleaned (CL-IMP-15): no path, `/`, `/index.html`,
// `/index.htm` or `/index.php`, and no query but a bare `?` or empty parameters, which a
// link holding only tracking parameters can keep after its cleaning.
const HOME_PAGE = /^https?:\/\/[^/?]*(?:\/|\/index\.html?|\/index\.php)?(?:\?&*)?$/iu;

/**
 * The link check of IMP-14 on a link trimmed: a complete address, holding no citation
 * marker (CL-IMP-07), that is no home page once cleaned (CL-IMP-15) and lies on no
 * disallowed domain, the domain itself or one of its subdomains (DSN-01, DSN-03).
 */
function checkLink(url: string, rules: SourceCheckRules): LinkCheck {
  const address = COMPLETE_ADDRESS.exec(url);
  if (address === null || hasPossibleCitationMarker(url)) {
    return INCOMPLETE_ADDRESS;
  }
  // The domain name, the first group, which takes part in every match.
  const host = String(address[1]).toLowerCase();
  const cleanedUrl = rules.cleanLink(url);
  if (HOME_PAGE.test(cleanedUrl)) {
    return { ok: false, cause: 'home_page' };
  }
  const isDisallowed = rules.disallowedDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  return isDisallowed
    ? { ok: false, cause: 'disallowed_domain' }
    : { ok: true, link: { url, cleanedUrl } };
}

/** The epoch day of a calendar date written YYYY-MM-DD. */
function dayNumber(on: string): number {
  const [year = 0, month = 1, day = 1] = on.split('-').map(Number);
  // setUTCFullYear, unlike Date.UTC, reads the years 0 to 99 as written.
  return new Date(0).setUTCFullYear(year, month - 1, day) / MS_PER_DAY;
}

/** The epoch day of the latest calendar date that an instant has in any zone (CL-IMP-10). */
function latestDayAt(at: number): number {
  return Math.floor((at + EASTMOST_OFFSET_MS) / MS_PER_DAY);
}

/** The epoch day of the earliest calendar date that a date can name in a zone from UTC−12 to UTC+14 (CL-IMP-11). */
function earliestDay(date: ExchangeDate): number {
  return date.kind === 'instant'
    ? Math.floor((date.at + WESTMOST_OFFSET_MS) / MS_PER_DAY)
    : dayNumber(date.on);
}

/** The epoch day of the latest calendar date that a date can name in a zone from UTC−12 to UTC+14 (CL-IMP-11). */
function latestDay(date: ExchangeDate): number {
  return date.kind === 'instant' ? latestDayAt(date.at) : dayNumber(date.on);
}

/**
 * Whether a publication date is in the future (CL-IMP-10): a date and time after the
 * instant of the check, or a date after the date of that instant in UTC+14, the latest
 * calendar date anywhere then.
 */
function isInFuture(date: ExchangeDate, checkedAt: number): boolean {
  return date.kind === 'instant'
    ? date.at > checkedAt
    : dayNumber(date.on) > latestDayAt(checkedAt);
}

/** The checks of one source (IMP-14): the source kept, or why it is dropped. */
function checkSource(
  source: ResearchSource,
  position: number,
  rules: SourceCheckRules,
): Readonly<{ ok: true; source: CheckedSource }> | Readonly<{ ok: false; cause: SourceDropCause }> {
  const link = source.url === undefined ? INCOMPLETE_ADDRESS : checkLink(source.url.trim(), rules);
  if (!link.ok) {
    return link;
  }
  const date = source.publicationDate;
  if (!date.ok) {
    const cause =
      date.error.kind === 'missing' ? 'publication_date_missing' : 'publication_date_malformed';
    return { ok: false, cause };
  }
  if (isInFuture(date.date, rules.checkedAt)) {
    return { ok: false, cause: 'publication_date_in_future' };
  }
  return {
    ok: true,
    source: {
      position,
      ...link.link,
      outlet: source.outlet?.trim(),
      title: source.title?.trim(),
      publicationDate: date.date,
      dateWarning: date.warning,
    },
  };
}

/**
 * Checks the sources of an event, or the illustration sources of a proposed type, as
 * IMP-14 says (CL-TAX-04): a source is dropped, with a warning that gives its position and
 * the cause, when its link is not a complete address (`https://` or `http://`, a domain
 * name, no space, no citation marker: CL-IMP-07), is a home page once cleaned by
 * `rules.cleanLink` (CL-IMP-15), or lies on one of `rules.disallowedDomains` or a
 * subdomain of it (social networks, forums, collaborative encyclopedias, video
 * platforms: DSN-01, DSN-03, H-IMP-13); or when its publication date is missing,
 * malformed or nonexistent, or later than `rules.checkedAt` (CL-IMP-10). A kept source
 * without an outlet or a title only warns. Kept sources stay in their order, their link
 * and texts trimmed.
 */
export function checkSources(
  sources: readonly ResearchSource[],
  rules: SourceCheckRules,
): SourceChecks {
  const checks = sources.map((source, index) => checkSource(source, index + 1, rules));
  const kept = checks.flatMap((check) => (check.ok ? [check.source] : []));
  const warnings = checks.flatMap((check, index): SourceWarning[] => {
    const position = index + 1;
    if (!check.ok) {
      return [{ kind: 'source_dropped', position, cause: check.cause }];
    }
    const isIncomplete = check.source.outlet === undefined || check.source.title === undefined;
    return isIncomplete ? [{ kind: 'source_outlet_or_title_missing', position }] : [];
  });
  return { kept, warnings };
}

/**
 * Whether a source is published more than `maxLeadDays` before the public date, by the
 * smallest lead the two values allow (IMP-14, CL-IMP-11): between two instants, more than
 * that many times 24 hours; otherwise more than that many calendar days, a value with a
 * time standing for every calendar date it has in a zone from UTC−12 to UTC+14.
 */
export function isTooEarly(
  publicationDate: ExchangeDate,
  publicDate: ExchangeDate,
  maxLeadDays: number,
): boolean {
  return publicationDate.kind === 'instant' && publicDate.kind === 'instant'
    ? publicDate.at - publicationDate.at > maxLeadDays * MS_PER_DAY
    : earliestDay(publicDate) - latestDay(publicationDate) > maxLeadDays;
}

/** -1, 0 or 1 as the first value comes before, with or after the second. */
function compare(left: number | string, right: number | string): number {
  return Number(left > right) - Number(left < right);
}

/** The instant of a date with a time; for a date alone, after every instant, since it comes after the timed ones of its calendar date (CL-IMP-16). */
function instantRank(date: ExchangeDate): number {
  return date.kind === 'instant' ? date.at : Infinity;
}

/**
 * Sources from the oldest (CL-IMP-16): by calendar date, then, on one date, a source with
 * a time before one without, and sources with a time by their instants; full ties keep
 * the order of the list.
 */
export function oldestFirst(sources: readonly CheckedSource[]): readonly CheckedSource[] {
  return sources.toSorted(({ publicationDate: left }, { publicationDate: right }) => {
    const byDate = compare(left.on, right.on);
    return byDate === 0 ? compare(instantRank(left), instantRank(right)) : byDate;
  });
}
