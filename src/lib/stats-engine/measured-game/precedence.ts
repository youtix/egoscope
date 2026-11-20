// The precedence of a historical event's sources over its measured game (IMP-18,
// CL-IMP-17): whether its sources show the fact public before the game it is measured
// on, its tip-off being the game's scheduled start as last known (CL-SEN-23). The import
// preview classifies it as soon as the first game after the event is known; the
// attachment classifies it against the game its walk reaches, before any shift, and an
// uncertain precedence moves the event once to a later game (SEN-44, CL-SEN-07).

import type { EpochMs, IsoDate } from '../types';

/** The precedence of a historical event (IMP-18, SEN-44), as it is stored. */
export type Precedence = 'established' | 'uncertain' | 'not_established' | 'to_verify';

/**
 * A source of a historical event as precedence reads it (CL-IMP-09): its publication
 * date as written and, when that date had a time, its instant.
 */
export type PrecedenceSource = Readonly<{
  publicationDateOn: IsoDate;
  publicationAt: EpochMs | null;
}>;

/**
 * A game as precedence reads it: its scheduled start, the deemed start while its time
 * is to be determined (CL-SEN-23, CL-STA-14), and its US date (CL-TRV-03).
 */
export type PrecedenceGame = Readonly<{ scheduledStartAt: EpochMs; gameDayOn: IsoDate }>;

/** A precedence classified against a known game, which is never to verify. */
type ClassifiedPrecedence = Exclude<Precedence, 'to_verify'>;

/**
 * Whether `source` precedes `game` (CL-IMP-17): a timed source published before its
 * scheduled start, a date-only source dated before its US date.
 */
function doesPrecede(source: PrecedenceSource, game: PrecedenceGame): boolean {
  return source.publicationAt === null
    ? source.publicationDateOn < game.gameDayOn
    : source.publicationAt < game.scheduledStartAt;
}

/** Whether `source` is dated on the US date of `game` with no time (CL-IMP-17). */
function isSameDayUndated(source: PrecedenceSource, game: PrecedenceGame): boolean {
  return source.publicationAt === null && source.publicationDateOn === game.gameDayOn;
}

/**
 * The precedence of `sources` over the measured game `game` (IMP-18, CL-IMP-17), from
 * every source: established when one precedes it, otherwise uncertain when one is dated
 * on its US date without a time, otherwise not established.
 */
export function precedenceOver(
  sources: readonly PrecedenceSource[],
  game: PrecedenceGame,
): ClassifiedPrecedence {
  if (sources.some((source) => doesPrecede(source, game))) {
    return 'established';
  }
  return sources.some((source) => isSameDayUndated(source, game)) ? 'uncertain' : 'not_established';
}

/**
 * The precedence of a historical event's `sources` (IMP-18, CL-IMP-17, SEN-44). Against
 * the measured game, once known, before any shift: established when a timed source
 * precedes its scheduled start, the deemed start of a game whose time is to be
 * determined (CL-STA-14), or a date-only source its US date; uncertain when none does
 * and a date-only source is dated on that US date; not established otherwise. Until the
 * measured game is known, established as soon as a source precedes the first official
 * game of the player's teams after the reference instant, which then precedes the
 * measured game whatever it turns out to be, and to verify while it is unknown or no
 * source precedes it.
 */
export function classifyPrecedence(
  sources: readonly PrecedenceSource[],
  games: Readonly<{ measuredGame: PrecedenceGame | null; firstTeamGame: PrecedenceGame | null }>,
): Precedence {
  const { measuredGame, firstTeamGame } = games;
  if (measuredGame !== null) {
    return precedenceOver(sources, measuredGame);
  }
  const isDecided =
    firstTeamGame !== null && sources.some((source) => doesPrecede(source, firstTeamGame));
  return isDecided ? 'established' : 'to_verify';
}
