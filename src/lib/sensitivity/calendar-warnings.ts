// The warnings of a calendar-derived profile, and the first covered season that they
// name (CL-STA-22, CL-STA-24, CL-JOU-16, CL-JOU-18).
import { sql } from 'drizzle-orm';

import { seasons } from '@/lib/db';

import type { ProfileWarning } from './calculation-values';
import type { Database, Transaction } from '@/lib/db';

type Reader = Database | Transaction;

/**
 * What the calendar-derived warnings of a profile read (CL-STA-24, CL-JOU-16, CL-JOU-18):
 * the type's calendar derivation, none for a type that is not calendar-derived; the
 * month of the player's birthday, null while it is not recorded; the season of his first
 * NBA game, null while it is unknown; and the first covered season, null while no season
 * is stored.
 */
export type CalendarFacts = Readonly<{
  calendarDerivation: 'birthday' | 'former_team' | null;
  birthdayMonth: number | null;
  firstNbaSeason: string | null;
  firstCoveredSeason: string | null;
}>;

/**
 * The first covered season (CL-STA-22, CL-STA-12, games-and-statistics 1.10), or null
 * while no season is stored: the earliest season row that is not "not covered". A row is
 * written from the service sheet's first season on, 1993-94, as soon as the app meets the
 * season, every covered season's directory at the installation included (CL-STA-29). A
 * season pending, its games not read yet, is covered, and so is one whose games have
 * lines. A season read without any line is not covered once it has ended, which a later
 * season's row shows: the latest season, which may not have ended, stays covered.
 */
export async function firstCoveredSeason(db: Reader): Promise<string | null> {
  const [found] = await db
    .select({ season: sql<string | null>`min(${seasons.season})` })
    .from(seasons)
    .where(
      sql`${seasons.coverageFetchedAt} IS NULL
        OR cardinality(${seasons.phasesWithLines}) > 0
        OR ${seasons.season} = (SELECT max(${seasons.season}) FROM ${seasons})`,
    );
  return found?.season ?? null;
}

/**
 * The warnings of a calendar-derived profile (CL-STA-24, CL-JOU-16, CL-JOU-18): on a
 * birthday profile, "birthday not recorded" while the day and month are missing, else the
 * season from which birthday games are counted when his career may start before it, his
 * first NBA game earlier or unknown; on a former-team profile, the season with which its
 * team history starts. None for another type, nor while no season is stored.
 */
export function calendarWarnings(facts: CalendarFacts): ProfileWarning[] {
  const { calendarDerivation, firstCoveredSeason: season } = facts;
  if (calendarDerivation === 'birthday' && facts.birthdayMonth === null) {
    return [{ kind: 'birthday_not_recorded' }];
  }
  if (calendarDerivation === null || season === null) {
    return [];
  }
  if (calendarDerivation === 'former_team') {
    return [{ kind: 'team_history_from', season }];
  }
  const isEarlier = facts.firstNbaSeason === null || facts.firstNbaSeason < season;
  return isEarlier ? [{ kind: 'birthday_counted_from', season }] : [];
}
