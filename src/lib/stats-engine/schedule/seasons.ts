// The season a date belongs to (STA-48, CL-STA-28): a season runs from its first
// regular-season game to its last playoff game, and a date between two seasons belongs
// to the next one (H-STA-17), even before its schedule is stored. A game takes its
// season from its day in the same way, never from the file it came from, as when the
// 1999-2000 files list games of 1998-99. A season is named by its two years, written
// `2024-25` (glossary), and its last game falls in the second of them: a date belongs
// either to the season that ends in its year, while that season's last game is not
// past, or to the season that starts in its year. So the last game of the season that
// ends in its year decides, and, when that season is not stored, as before the first
// season the source covers, the first game of the season that starts in it.

import type { IsoDate } from '../types';

/**
 * A season of the stored schedule (STA-48): its name, written `2024-25`; the US date of
 * its first regular-season game; and the US date of its last playoff game once it has
 * ended, its Finals over, null while it is in progress.
 */
export type SeasonSpan = Readonly<{
  season: string;
  firstGameOn: IsoDate;
  lastGameOn: IsoDate | null;
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
 * The season of `date` (STA-48, H-STA-17, CL-STA-28): the season whose first
 * regular-season game and last playoff game frame it, both days included, and for any
 * other date the next season, which needs no stored schedule: 2021-08-12, between the
 * 2020-21 Finals and the first game of 2021-22, belongs to 2021-22 (CA-STA-17). A season
 * in progress holds every date from the end of the season before. `seasons` are the
 * stored seasons; a date whose year ends no stored season, as before the first season
 * the source covers, belongs to the season that starts in its year from that season's
 * first game on, when it is stored, and otherwise to the season that ends in its year.
 */
export function seasonOfDate(date: IsoDate, seasons: readonly SeasonSpan[]): string {
  const year = Number(date.slice(0, YEAR_LENGTH));
  const ending = seasonStartingIn(year - 1);
  const starting = seasonStartingIn(year);
  const endingSpan = seasons.find((span) => span.season === ending);
  if (endingSpan !== undefined) {
    const isHeld = endingSpan.lastGameOn === null || date <= endingSpan.lastGameOn;
    return isHeld ? ending : starting;
  }
  const startingSpan = seasons.find((span) => span.season === starting);
  return startingSpan !== undefined && date >= startingSpan.firstGameOn ? starting : ending;
}
