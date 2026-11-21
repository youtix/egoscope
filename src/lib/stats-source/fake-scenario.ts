// The short scenario of the invented league, data/fixtures/stats-source/world/scenario.json,
// typed, with the calendar helpers that its generator shares (fake-schedule.ts for each
// season's games, fake-world.ts for the box scores, directories and player files).
import { compareIsoDates, gameDay, localOccurrenceInstant, toEpochMs, toIsoDate } from '@/lib/time';
import scenario from '@data/fixtures/stats-source/world/scenario.json';

import type { Birthday, BoxScoreCount, HeldBackRow, SourceTeam } from './types';
import type { IsoDate } from '@/lib/time';

/** A stretch of a player's career with one team, its last day included; open while it lasts. */
export type Stint = Readonly<{ team: string; from: string; to?: string }>;

/** An invented player: names, birthday, career, and the days on which he did not play. */
export type Player = Readonly<{
  id: string;
  name: string;
  shortName: string;
  birthday: Birthday | null;
  stints: readonly Stint[];
  didNotPlay?: readonly string[];
}>;

type Duel = Readonly<{ home: string; away: string; winner: string }>;
type Series = Readonly<{ round: string; high: string; low: string; winners: readonly string[] }>;

/** What the scenario says of a season: its start, its postseason and what the source holds of it. */
export type Schedule = Readonly<{
  season: string;
  start: string;
  hasBoxScores: boolean;
  hasWholeMinutes: boolean;
  /** In the season in progress, the day from which games are still to be played. */
  playedBefore?: string;
  allStarDay?: string;
  /** The day of a play-in game whose teams are not known yet: a placeholder (CL-STA-14). */
  playInToBeDeterminedOn?: string;
  playIn?: Duel;
  /** The series in the order they are played; the higher seed hosts games 1 and 3. */
  series?: readonly Series[];
}>;

/** One of the box-score lines that the players' box scores take in turn. */
type Line = Readonly<Record<'minutes' | 'seconds' | BoxScoreCount, number>>;

type TeamNames = Omit<SourceTeam, 'team'> & Readonly<{ from: string }>;

type Scenario = Readonly<{
  firstCoveredSeason: string;
  refresh: Readonly<{ on: string; time: string }>;
  calendar: Readonly<{
    tipOff: string;
    tipOffAbroad: string;
    daysBetweenRounds: number;
    daysBetweenPostseasonGames: number;
  }>;
  scores: readonly Readonly<{ home: number; away: number }>[];
  lines: readonly Line[];
  teams: readonly Readonly<{ id: string; names: readonly TeamNames[] }>[];
  seasons: readonly Schedule[];
  games: Readonly<{
    overtimes: Readonly<Record<string, number>>;
    abroad: readonly string[];
    withoutBoxScores: readonly string[];
    timeToBeDetermined: readonly string[];
    postponed: readonly Readonly<{ game: string; makeUpOn: string }>[];
    heldBack: readonly HeldBackRow[];
  }>;
  players: readonly Player[];
}>;

/** The scenario, which the type checks as it is imported. */
export const LEAGUE: Scenario = scenario;

/** The league's zone: its schedule's times and dates are US Eastern (CL-TRV-03). */
export const EASTERN = 'America/New_York';

const NOON = '12:00';
const MS_PER_DAY = 86_400_000;

/** The element at `index`, which the scenario must hold: a missing one is a bug of the scenario. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) {
    throw new RangeError(`The invented league lacks item ${String(index)} of a list.`);
  }
  return item;
}

/** The day `days` after `day`, counted from noon US Eastern, which no clock change moves to another day (CL-TRV-03). */
export function dayAfter(day: string, days: number): IsoDate {
  const noon = localOccurrenceInstant(toIsoDate(day), NOON, EASTERN);
  return gameDay(toEpochMs(noon + days * MS_PER_DAY));
}

/** Says whether `day` comes before `other`, both written `YYYY-MM-DD`. */
export const isBefore = (day: string, other: string): boolean =>
  compareIsoDates(toIsoDate(day), toIsoDate(other)) < 0;
