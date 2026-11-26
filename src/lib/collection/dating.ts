// The reading and dating rules of a feed item (COL-17 to COL-22): its checks, its
// retained publication instant and that instant's precision under the prudence
// principle, the date anomaly, the admitted-age test and the oldest item of a feed
// for the gap test; and the dating of a source the owner supplies (CL-DET-26). Every
// comparison is between instants, and every zone is resolved by `@/lib/time`.
import {
  endOfLocalDay,
  latestLocalInstant,
  localOccurrenceInstant,
  startOfLocalDay,
  toEpochMs,
} from '@/lib/time';

import type { ArticleRow, PressSourceRow } from './types';
import type { FeedItem } from '@/lib/press-feeds';
import type { EpochMs, IsoDate, ParsedTimestamp } from '@/lib/time';

/** The precision of a retained instant: exact, approximate or none (`DatePrecision`, COL-20). */
export type DatePrecision = ArticleRow['retainedPublishedAtPrecision'];
/** A language the collection keeps, `en` or `fr` (`Language`, COL-05, COL-17). */
export type Language = PressSourceRow['language'];

/** What the checks of COL-17 and COL-18 make of a feed item. */
export type ItemCheck =
  | Readonly<{ ok: true; language: Language }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'incomplete' | 'unsupported_language' }> }>;

/** The dates of a feed item that dating reads (COL-19). */
export type DatedItem = Pick<FeedItem, 'publishedAt' | 'updatedAt'>;

/**
 * A retained publication instant with its precision, and whether the item is a date
 * anomaly, which the run counts (COL-19 to COL-22, CL-COL-03).
 */
export type RetainedInstant = Readonly<{
  at: EpochMs;
  precision: DatePrecision;
  dateAnomaly: boolean;
}>;

/** A publication date that the owner gives, with its time `HH:MM` and its zone if known. */
export type OwnerSourceDate = Readonly<{ on: IsoDate; time: string | null; zone: string | null }>;

/**
 * An instant dated from a date, never of precision « absente » (COL-20): a collected
 * item's candidate, or the instant of a source the owner supplies (CL-DET-26).
 */
export type OwnerSourceInstant = Readonly<{
  at: EpochMs;
  precision: Exclude<DatePrecision, 'none'>;
}>;

/** The age test of COL-24: an instant, the instant of the read, and the admitted age. */
export type AdmittedAgeTest = Readonly<{
  retainedAt: EpochMs;
  readAt: EpochMs;
  admittedAgeMs: number;
}>;

// The zone where a calendar day ends the latest, UTC−12, and where it starts the
// earliest, UTC+14: fixed offsets, whose IANA names invert the sign (CL-COL-02, CL-COL-03).
const LATEST_ZONE = 'Etc/GMT+12';
const EARLIEST_ZONE = 'Etc/GMT-14';
// The last millisecond of a day is one before the start of the next (CL-COL-02).
const LAST_MILLISECOND = 1;
// A language tag names its language first, before a region or a script: `en-US`, `fr_CA`.
const SUBTAG_SEPARATOR = /[-_]/u;
const SUPPORTED_LANGUAGES: ReadonlyMap<string, Language> = new Map([
  ['en', 'en'],
  ['fr', 'fr'],
]);

const isBlank = (text: string | null): boolean => text === null || text.trim() === '';

/** The language a declared tag names, when the collection keeps it. */
function supportedLanguage(tag: string): Language | undefined {
  const [primary = ''] = tag.trim().toLowerCase().split(SUBTAG_SEPARATOR);
  return SUPPORTED_LANGUAGES.get(primary);
}

/**
 * Checks a feed item before it is dated: an item without a link or a title is
 * `incomplete` (COL-18); otherwise its language is the one it declares, else its
 * source's (COL-17), and an item declared in a language other than English or French
 * is `unsupported_language`. A tag counts by its primary subtag (`en-US` is `en`);
 * nothing detects the language of the text (CL-COL-11). Both are counted, not stored.
 */
export function checkItem(
  item: Pick<FeedItem, 'link' | 'title' | 'language'>,
  sourceLanguage: Language,
): ItemCheck {
  if (isBlank(item.link) || isBlank(item.title)) {
    return { ok: false, error: { kind: 'incomplete' } };
  }
  if (item.language === null || item.language.trim() === '') {
    return { ok: true, language: sourceLanguage };
  }
  const language = supportedLanguage(item.language);
  return language === undefined
    ? { ok: false, error: { kind: 'unsupported_language' } }
    : { ok: true, language };
}

/** 23:59:59.999 of `day` in `zone`, the last instant of that day (CL-COL-02). */
function lastInstantOfDay(day: IsoDate, zone: string): EpochMs {
  return toEpochMs(endOfLocalDay(day, zone) - LAST_MILLISECOND);
}

/**
 * The cautious candidate of COL-21, before the first-collection cap, with its precision
 * (COL-20, CL-COL-02): an instant with its offset as it is, exact; a date alone at the
 * end of that day in the outlet's zone, else at UTC−12, approximate; a wall time in the
 * outlet's zone, exact, else at UTC−12, approximate, the later instant when it occurs
 * twice and moved forward by the gap when a clock change skips it.
 */
function cautiousInstant(
  timestamp: ParsedTimestamp,
  outletZone: string | null,
): OwnerSourceInstant {
  switch (timestamp.kind) {
    case 'instant': {
      return { at: timestamp.at, precision: 'exact' };
    }
    case 'date': {
      return {
        at: lastInstantOfDay(timestamp.on, outletZone ?? LATEST_ZONE),
        precision: 'approximate',
      };
    }
    case 'no_offset': {
      return {
        at: latestLocalInstant(timestamp.on, timestamp.time, outletZone ?? LATEST_ZONE),
        precision: outletZone === null ? 'approximate' : 'exact',
      };
    }
  }
}

/**
 * The earliest instant compatible with an item's date, which decides a date anomaly
 * (CL-COL-03): an instant with its offset as it is; for a date alone, 00:00 of that
 * date; for a wall time, its first occurrence; the last two in the outlet's zone when
 * the source declares one, otherwise at UTC+14, where a day starts the earliest.
 */
export function earliestCompatibleInstant(
  timestamp: ParsedTimestamp,
  outletZone: string | null,
): EpochMs {
  const zone = outletZone ?? EARLIEST_ZONE;
  switch (timestamp.kind) {
    case 'instant': {
      return timestamp.at;
    }
    case 'date': {
      return startOfLocalDay(timestamp.on, zone);
    }
    case 'no_offset': {
      return localOccurrenceInstant(timestamp.on, timestamp.time, zone);
    }
  }
}

/** The date that dates an item: its publication date, else its update date (COL-19). */
const itemDate = (item: DatedItem): ParsedTimestamp | null => item.publishedAt ?? item.updatedAt;

/**
 * The retained publication instant of a feed item and its precision (COL-19 to
 * COL-22): from its publication date, else its update date, dated cautiously in the
 * outlet's zone `outletZone` when the source declares one (CL-COL-02), and never later
 * than `firstCollectedAt`. An item whose earliest compatible instant is already after
 * its first collection is a date anomaly: it takes the first-collection instant,
 * approximate, and is counted; a cautious candidate alone past the first collection
 * takes it too, approximate, without being counted (CL-COL-03). An undated item takes
 * the first-collection instant, of precision none. A detected event uses this instant
 * as it is, never re-dated by SEN-01 (CL-SEN-02).
 */
export function retainedInstant(
  item: DatedItem,
  outletZone: string | null,
  firstCollectedAt: EpochMs,
): RetainedInstant {
  const timestamp = itemDate(item);
  if (timestamp === null) {
    return { at: firstCollectedAt, precision: 'none', dateAnomaly: false };
  }
  if (earliestCompatibleInstant(timestamp, outletZone) > firstCollectedAt) {
    return { at: firstCollectedAt, precision: 'approximate', dateAnomaly: true };
  }
  const candidate = cautiousInstant(timestamp, outletZone);
  return candidate.at > firstCollectedAt
    ? { at: firstCollectedAt, precision: 'approximate', dateAnomaly: false }
    : { ...candidate, dateAnomaly: false };
}

/**
 * The instant of a feed's oldest item for the gap test (COL-46, CL-COL-13): the
 * earliest cautious instant of COL-19 to COL-21 among its dated items, recorded or
 * not, before the first-collection cap; null when no item is dated, and the feed
 * then gets no gap test.
 */
export function oldestItemInstant(
  items: readonly DatedItem[],
  outletZone: string | null,
): EpochMs | null {
  let oldest: EpochMs | null = null;
  for (const item of items) {
    const timestamp = itemDate(item);
    const at = timestamp === null ? null : cautiousInstant(timestamp, outletZone).at;
    if (at !== null && (oldest === null || at < oldest)) {
      oldest = at;
    }
  }
  return oldest;
}

/**
 * Whether an item is young enough to be stored (COL-24, COL-45): its retained
 * instant is no older, at `readAt`, than the admitted age, the maximum age or, during
 * a catch-up, the maximum age plus the time since the source's reference instant
 * (CL-COL-04), which the caller passes in.
 */
export function isWithinAdmittedAge(test: AdmittedAgeTest): boolean {
  return test.readAt - test.retainedAt <= test.admittedAgeMs;
}

/**
 * The publication instant of a public source that the owner adds to a detected
 * event (DET-48, CL-DET-26), dated as a collected item is (COL-21, CL-COL-02): a date
 * and a time in a zone, `zone` an IANA zone that `isTimeZone` accepts, give that wall
 * time, exact, its later instant when it occurs twice; without the time, the end of
 * that day; without the zone, at UTC−12; both approximate.
 */
export function ownerSourceInstant(source: OwnerSourceDate): OwnerSourceInstant {
  const timestamp: ParsedTimestamp =
    source.time === null
      ? { kind: 'date', on: source.on }
      : { kind: 'no_offset', on: source.on, time: source.time };
  return cautiousInstant(timestamp, source.zone);
}
