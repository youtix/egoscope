// What the cases of the statistics-source contract (contract.ts) share: call
// contexts, the reads of the harness's seasons, and the way a case names what it
// finds wrong.
import { now, toEpochMs } from '@/lib/time';

import type { Problems, StatsSourceHarness } from './contract';
import type { StatsSourceOutcome } from './port';
import type {
  CallContext,
  ConditionalRead,
  Season,
  SeasonGames,
  SourceBoxScore,
  SourceGame,
  SourcePlayerId,
  SourceVersion,
} from './types';

/** A read of one season's resource, asked with a version or without one. */
type Read = (
  knownVersion: SourceVersion | null,
) => Promise<StatsSourceOutcome<ConditionalRead<unknown>>>;

/** A deadline that no answer under test comes near. */
export const DEADLINE_MS = 10_000;

const NO_SCHEDULE: SeasonGames = {
  games: [],
  teams: [],
  coverage: { phasesWithBoxScores: [], gamesWithoutBoxScores: [] },
  heldBack: [],
};

/** A call context with `signal`, whose deadline is `deadlineMs` away. */
export const context = (signal: AbortSignal, deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal,
});

/** A call context that nothing stops. */
export const open = (): CallContext => context(new AbortController().signal);

/** The problem `rule` when it has offenders, which it names. */
export const problem = (rule: string, offenders: readonly unknown[]): Problems =>
  offenders.length === 0 ? [] : [`${rule}: ${JSON.stringify(offenders)}`];

/** What an operation answered: `read`, `not_modified`, `ok`, or the kind of its error. */
export function answerOf(outcome: StatsSourceOutcome<unknown>): string {
  if (!outcome.ok) {
    return outcome.error.kind;
  }
  const { value } = outcome;
  return typeof value === 'object' && value !== null && 'kind' in value ? String(value.kind) : 'ok';
}

/** The data of a read, or nothing for any other answer. */
export const readOf = <T>(outcome: StatsSourceOutcome<ConditionalRead<T>>): T | undefined =>
  outcome.ok && outcome.value.kind === 'read' ? outcome.value.data : undefined;

/** The version of a read, or none for any other answer. */
export const versionOf = (
  outcome: StatsSourceOutcome<ConditionalRead<unknown>>,
): SourceVersion | null =>
  outcome.ok && outcome.value.kind === 'read' ? outcome.value.version : null;

/** The source's identifiers of `games`, by which a problem names them. */
export const idsOf = (games: readonly SourceGame[]): readonly string[] =>
  games.map(({ game }) => game);

/** The schedule of `season`, empty when it cannot be read. */
export async function scheduleOf(
  { source }: StatsSourceHarness,
  season: Season,
): Promise<SeasonGames> {
  return readOf(await source.getSeasonGames(open(), { season, knownVersion: null })) ?? NO_SCHEDULE;
}

/** The schedules of the finished season and of the season in progress, with the season each was asked for. */
export async function schedulesOf(
  harness: StatsSourceHarness,
): Promise<readonly (readonly [Season, SeasonGames])[]> {
  return Promise.all(
    [harness.season, harness.currentSeason].map(
      async (season) => [season, await scheduleOf(harness, season)] as const,
    ),
  );
}

/** The problem of the seasons whose schedule gave no game, which no other rule can then judge. */
export const unreadSchedules = (schedules: readonly (readonly [Season, SeasonGames])[]): Problems =>
  problem(
    'season games not read',
    schedules.filter(([, schedule]) => schedule.games.length === 0).map(([season]) => season),
  );

/** The box scores of `players` in the harness's season, none when they cannot be read. */
export async function linesOf(
  { source, season }: StatsSourceHarness,
  players: readonly SourcePlayerId[],
): Promise<readonly SourceBoxScore[]> {
  return (
    readOf(await source.getSeasonBoxScores(open(), { season, players, knownVersion: null })) ?? []
  );
}

/** Each conditional read of `season`, by name; the player records are read for `current`. */
export function seasonReads(
  harness: StatsSourceHarness,
  season: Season,
  current: Season,
): readonly (readonly [string, Read])[] {
  const { source, players } = harness;
  return [
    ['games', async (knownVersion) => source.getSeasonGames(open(), { season, knownVersion })],
    [
      'box scores',
      async (knownVersion) => source.getSeasonBoxScores(open(), { season, players, knownVersion }),
    ],
    ['players', async (knownVersion) => source.getSeasonPlayers(open(), { season, knownVersion })],
    [
      'records',
      async (knownVersion) =>
        source.getPlayerRecords(open(), { season: current, players, knownVersion }),
    ],
  ];
}
