// The correspondence of two events (IMP-25), one rule for the import, which looks for
// duplicates and possible duplicates among the saved events and the other events of
// the result (IMP-25, IMP-26), and in Lot 2 for detection, which looks for the
// historical event that a new fact corresponds to (DET-58). Two events of one player
// are close when their reference dates lie within the correspondence window, measured
// as CL-IMP-12 says, or when they cite a common cleaned link (CL-IMP-14). Close events
// of one type correspond, and are duplicates; close events of different types are a
// possible duplicate (CL-IMP-13). A calendar-derived event is close to none (CL-IMP-29).

import { dayCount, MS_PER_DAY } from '../calendar-days';

import type { EpochMs, EventTypeId, IsoDate, PlayerId } from '../types';

/** The origin of an event, the glossary's `EventOrigin`, fixed at creation (DSN-06, CL-VUE-12). */
export type EventOrigin = 'calendar' | 'detected' | 'historical';

/**
 * The reference date of an event as the correspondence reads it (IMP-25, CL-IMP-12):
 * the calendar date as written (`on`) of a value without a time, or the instant (`at`)
 * of a timed one, a historical event's timed public date or a detected event's
 * reference date, which is always an instant (DET-30). The date that a timed value is
 * written with is not read: its instant stands for the dates it has in every zone.
 */
export type ReferenceDate = Readonly<{ on: IsoDate; at?: undefined }> | Readonly<{ at: EpochMs }>;

/**
 * An event as the correspondence compares it (IMP-25): its player, its type, its
 * origin, its reference date, which is a historical event's public date and a detected
 * event's reference date, and the links of its sources once cleaned by `cleanLink`
 * (CL-IMP-14), such as the `cleaned_url` of its saved sources.
 */
export type ComparedEvent = Readonly<{
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  origin: EventOrigin;
  referenceDate: ReferenceDate;
  cleanedUrls: readonly string[];
}>;

/**
 * What one event is to another (IMP-25, CL-IMP-13): a duplicate, the same fact twice,
 * when they correspond; a possible duplicate, which the owner judges, when they are
 * close but of different types; none otherwise.
 */
export type DuplicateKind = 'duplicate' | 'none' | 'possible_duplicate';

const MS_PER_HOUR = 3_600_000;
// The zones furthest west and furthest east (CL-IMP-12): between them, an instant has
// every calendar date it has anywhere, two or three consecutive ones.
const WESTMOST_OFFSET_HOURS = -12;
const EASTMOST_OFFSET_HOURS = 14;

// The calendar days that a reference date stands for, as day numbers counted from
// 1970-01-01, both included.
type DaySpan = Readonly<{ first: number; last: number }>;

// The day number of the UTC date of an instant.
function dayOf(instant: EpochMs): number {
  return Math.floor(instant / MS_PER_DAY);
}

// A date without a time stands for its own day; an instant, for the dates it has from
// UTC−12 to UTC+14, whatever date it was written with (CL-IMP-12).
function daySpan(date: ReferenceDate): DaySpan {
  if (date.at === undefined) {
    const day = dayCount(date.on);
    return { first: day, last: day };
  }
  return {
    first: dayOf(date.at + WESTMOST_OFFSET_HOURS * MS_PER_HOUR),
    last: dayOf(date.at + EASTMOST_OFFSET_HOURS * MS_PER_HOUR),
  };
}

// Whether two reference dates lie within the window (CL-IMP-12): two instants at most
// the window times 24 hours apart; otherwise the nearest days that the two stand for at
// most the window apart, a day in common being no distance at all.
function isWithinWindow(date: ReferenceDate, other: ReferenceDate, windowDays: number): boolean {
  if (date.at !== undefined && other.at !== undefined) {
    return Math.abs(date.at - other.at) <= windowDays * MS_PER_DAY;
  }
  const span = daySpan(date);
  const otherSpan = daySpan(other);
  return Math.max(otherSpan.first - span.last, span.first - otherSpan.last) <= windowDays;
}

// Whether two events cite a common link, compared once cleaned (CL-IMP-14).
function haveCommonLink(event: ComparedEvent, other: ComparedEvent): boolean {
  return event.cleanedUrls.some((url) => other.cleanedUrls.includes(url));
}

// Whether two events are close (IMP-25): of one player, neither derived from the
// calendar (CL-IMP-29), with reference dates within the window or a common link.
function areClose(event: ComparedEvent, other: ComparedEvent, windowDays: number): boolean {
  return (
    event.playerId === other.playerId &&
    event.origin !== 'calendar' &&
    other.origin !== 'calendar' &&
    (isWithinWindow(event.referenceDate, other.referenceDate, windowDays) ||
      haveCommonLink(event, other))
  );
}

/**
 * What `event` is to `other`, in either order (IMP-25, CL-IMP-13): a duplicate when the
 * two correspond, that is when they are of one player and one type, with reference
 * dates within the window or a cleaned link in common; a possible duplicate when they
 * only differ by their types; none otherwise. A calendar-derived event is none to any
 * other (CL-IMP-29). The window is the correspondence window,
 * `imports.duplicateMaxDateGapDays` (CL-IMP-34), in days: two instants match when at
 * most the window times 24 hours apart; otherwise an instant stands for its dates from
 * UTC−12 to UTC+14, and the nearest days must be at most the window apart (CL-IMP-12).
 * The import compares a result event with each saved event; detection, in Lot 2, a new
 * fact at its reference instant with the player's historical events (DET-58).
 */
export function classify(
  event: ComparedEvent,
  other: ComparedEvent,
  windowDays: number,
): DuplicateKind {
  if (!areClose(event, other, windowDays)) {
    return 'none';
  }
  return event.eventTypeId === other.eventTypeId ? 'duplicate' : 'possible_duplicate';
}

/**
 * The duplicates among the events of one result, given in the order of its list
 * (IMP-26): the first of two corresponding events is kept, and the later one is its
 * duplicate, not added. Each event is compared, in turn, with the events kept before
 * it: it duplicates the first one it corresponds to, or is kept. A kept event is
 * compared by its own links and by those of the events already found to be its
 * duplicates in the result, whose sources join it (IMP-26), whether or not the import
 * attaches them within the maximum number of sources: a later event of its player and
 * type is its duplicate when it corresponds to it, by its date or by a common link, or
 * when it shares a link with one of those duplicates, whose own links then join it in
 * turn. The chain goes through links only, never through dates: an event close in date
 * to a duplicate alone, without a common link, is kept. Two events of different types
 * never duplicate each other, even with a common link: both are added (CL-IMP-13). For
 * each event, the index in `events` of the event it duplicates, or `undefined` when it
 * is kept.
 */
export function duplicatesInResult(
  events: readonly ComparedEvent[],
  windowDays: number,
): readonly (number | undefined)[] {
  // Each kept event with its own links and those of its duplicates so far.
  const kept: Readonly<{ index: number; event: ComparedEvent }>[] = [];
  return events.map((event, index) => {
    const position = kept.findIndex(
      (candidate) => classify(candidate.event, event, windowDays) === 'duplicate',
    );
    const original = kept[position];
    if (original === undefined) {
      kept.push({ index, event });
    } else {
      const cleanedUrls = [...original.event.cleanedUrls, ...event.cleanedUrls];
      kept[position] = { index: original.index, event: { ...original.event, cleanedUrls } };
    }
    return original?.index;
  });
}
