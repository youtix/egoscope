// The season a date belongs to (STA-48, CL-STA-28), and the span of each stored season,
// which tells it. A season runs from its first regular-season game to its last playoff
// game, and a date between two seasons belongs to the next one (H-STA-17). A game takes
// its season from its day in the same way, never from the file it came from, as when the
// 1999-2000 files list games of 1998-99. A season is named by its two years, written
// `2024-25` (glossary), and its last game falls in the second of them: a date belongs
// either to the season that ends in its year or to the season that starts in it, and
// only their stored spans tell which. No calendar rule stands in for a missing span: a
// Finals has ended as late as 11 October, and other seasons have opened in October of
// their first year.

import type { IsoDate } from '../types';

/**
 * A season of the stored schedule (STA-48): its name, written `2024-25`; the US date of
 * its first regular-season game; and the US date of its last game once it has closed,
 * null while it may still be in progress. `seasonSpan` builds it.
 */
export type SeasonSpan = Readonly<{
  season: string;
  firstGameOn: IsoDate;
  lastGameOn: IsoDate | null;
}>;

/**
 * The answer `season_not_read`, when the stored spans cannot tell the season of a date
 * (STA-48, CL-STA-28): its `candidates` are the season that ends in the date's year, then
 * the season that starts in it. A rule that cannot go on without that season gives it as
 * its own answer.
 */
export type SeasonNotRead = Readonly<{
  ok: false;
  error: Readonly<{ kind: 'season_not_read'; candidates: readonly [string, string] }>;
}>;

/**
 * The season of a date (STA-48), or `season_not_read` when the stored spans cannot tell
 * it (CL-STA-28).
 */
export type SeasonOfDateResult = Readonly<{ ok: true; season: string }> | SeasonNotRead;

/**
 * What the games module reads of a season whose schedule is stored to build its span
 * (STA-48): a few aggregates of its games, never the games themselves. Each day is a
 * game's US Eastern date (CL-TRV-03), read from the season's stored games, all official
 * since the games that never count are never stored (CL-STA-16), less those that no rule
 * counts: the canceled games and the postponed games without a make-up (CL-STA-17).
 */
export type SeasonSpanInput = Readonly<{
  /** The season, written `2024-25`. */
  season: string;
  /** The day of its first regular-season game, null when it has none. */
  firstRegularSeasonGameOn: IsoDate | null;
  /** The day of its last final playoff game, null when none is final. */
  lastPlayoffGameOn: IsoDate | null;
  /** The day of its last game, of any phase. */
  lastGameOn: IsoDate;
  /** Whether its Finals are over, as `phaseState` says of a team of the Finals. */
  isFinalsOver: boolean;
  /** Whether a game of a later season is stored. */
  hasLaterSeasonGame: boolean;
}>;

// A date is written `YYYY-MM-DD`: its year is its first four characters.
const YEAR_LENGTH = 4;
// A season's second year is written by its last two digits: 1999-00, 2000-01.
const CENTURY = 100;

/** The name of the season whose first year is `year`: 2024 gives `2024-25`. */
function seasonStartingIn(year: number): string {
  return `${String(year)}-${String((year + 1) % CENTURY).padStart(2, '0')}`;
}

/**
 * The season of `date` (STA-48, H-STA-17, CL-STA-28), from the spans of the stored
 * seasons. `date` is a day: a game's US Eastern date and, for an instant such as an
 * event's reference instant, its US Eastern date too, as for a game (CL-TRV-03). Of the
 * two seasons a date can belong to, the season that starts in its year holds it when that
 * season's span is stored and the date is on or after its first game, checked first so
 * that a past season whose end was never found cannot take the next season's dates.
 * Otherwise, when the span of the season that ends in its year is stored, that season
 * holds the date while it is in progress or up to its last game, both days included, and
 * the season that starts in its year holds it after that game, stored or not: 2021-08-12,
 * between the 2020-21 Finals and the first game of 2021-22, belongs to 2021-22
 * (CA-STA-17). Otherwise the season is not known, `season_not_read`, and the result
 * names both candidates: no calendar rule replaces a missing span.
 */
export function seasonOfDate(date: IsoDate, seasons: readonly SeasonSpan[]): SeasonOfDateResult {
  const year = Number(date.slice(0, YEAR_LENGTH));
  const ending = seasonStartingIn(year - 1);
  const starting = seasonStartingIn(year);
  const spanOf = (season: string): SeasonSpan | undefined =>
    seasons.find((span) => span.season === season);
  const startingSpan = spanOf(starting);
  if (startingSpan !== undefined && date >= startingSpan.firstGameOn) {
    return { ok: true, season: starting };
  }
  const endingSpan = spanOf(ending);
  if (endingSpan === undefined) {
    return { ok: false, error: { kind: 'season_not_read', candidates: [ending, starting] } };
  }
  const isHeld = endingSpan.lastGameOn === null || date <= endingSpan.lastGameOn;
  return { ok: true, season: isHeld ? ending : starting };
}

/** The day a season closes, or null while it may still be in progress. */
function closingDayOf(input: SeasonSpanInput): IsoDate | null {
  if (input.isFinalsOver) {
    return input.lastPlayoffGameOn;
  }
  return input.hasLaterSeasonGame ? input.lastGameOn : null;
}

/**
 * The span of a season whose schedule is stored (STA-48, CL-STA-16, CL-STA-30), built
 * from what the games module reads of it, `SeasonSpanInput`: from the day of its first
 * regular-season game to the day it closes. A season closes when its Finals are over, on
 * its last playoff game, or once a game of a later season is stored, on its last game, so
 * that a past season whose last playoff games the source does not list closes all the
 * same. Until then it may be in progress, and its last day is null. A season without a
 * regular-season game has no span: null.
 */
export function seasonSpan(input: SeasonSpanInput): SeasonSpan | null {
  if (input.firstRegularSeasonGameOn === null) {
    return null;
  }
  return {
    season: input.season,
    firstGameOn: input.firstRegularSeasonGameOn,
    lastGameOn: closingDayOf(input),
  };
}
