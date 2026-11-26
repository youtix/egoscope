import { describe, expect, it, vi } from 'vitest';

import { now, toEpochMs, toIsoDate } from '@/lib/time';

import { STATS_SOURCE_CONTRACT } from './contract';
import { listsDirectory } from './contract-games';
import { readOf } from './contract-support';
import { createFakeStatsSource } from './fake';

import type { ContractFault, StatsSourceHarness } from './contract-support';
import type { FakeFault } from './fake';
import type { StatsSource, StatsSourceOutcome } from './port';
import type {
  CallContext,
  ConditionalRead,
  DirectoryEntry,
  SeasonBoxScoresRead,
  SeasonGames,
} from './types';

const SEASON = '2025-26';
// A season that the broken adapter below refuses, which it names as its first covered one.
const NEVER_HELD = '1990-91';
const NEVER_PLAYED = toIsoDate('2000-01-01');
const DEADLINE_MS = 5000;
const RELEASED = 'p08';

type BoxScoresOutcome = Awaited<ReturnType<StatsSource['getSeasonBoxScores']>>;
type LinesRead = Extract<SeasonBoxScoresRead, { kind: 'read' }>;

/** The fault of the fake that meets the contract's `fault` at the next read of the season's games. */
function fakeFaultOf(fault: ContractFault): FakeFault {
  switch (fault) {
    case 'outage':
    case 'slow': {
      return { kind: fault, times: 1 };
    }
    case 'rate_limited': {
      return { kind: fault, afterCalls: 0, retryAfterMs: null };
    }
    case 'schema_changed': {
      return { kind: fault, resource: 'season_games', season: SEASON };
    }
  }
}

function fakeHarness(): StatsSourceHarness {
  const fake = createFakeStatsSource();
  return {
    source: fake,
    season: SEASON,
    currentSeason: '2026-27',
    missingSeason: '2022-23',
    players: ['p01', 'p02'],
    formerPlayer: 'p06',
    releasedPlayer: RELEASED,
    playerWithoutLine: { player: 'p02', game: '2025-26:r01:h3', isHome: true },
    unknownPlayer: 'p99',
    inject: (fault) => {
      fake.clearFaults();
      fake.inject(fakeFaultOf(fault));
    },
  };
}

// The broken adapter ignores its call context, the versions and the seasons asked.
const anyContext = (): CallContext => ({
  deadline: toEpochMs(now() + DEADLINE_MS),
  signal: new AbortController().signal,
});

/** `outcome` with the data of its read changed by `change`. */
function changed<T>(
  outcome: StatsSourceOutcome<ConditionalRead<T>>,
  change: (data: T) => T,
): StatsSourceOutcome<ConditionalRead<T>> {
  return outcome.ok && outcome.value.kind === 'read'
    ? { ...outcome, value: { ...outcome.value, data: change(outcome.value.data) } }
    : outcome;
}

/** `outcome` with its box-score read changed by `change`. */
function changedRead(
  outcome: BoxScoresOutcome,
  change: (read: LinesRead) => LinesRead,
): BoxScoresOutcome {
  return outcome.ok && outcome.value.kind === 'read'
    ? { ...outcome, value: change(outcome.value) }
    : outcome;
}

// Loses its first game, and holds back its second while it lists it.
const brokenSchedule = ({ games, coverage }: SeasonGames): SeasonGames => ({
  games: games
    .slice(1)
    .map((game) => ({ ...game, season: 'another', gameDay: toIsoDate('2000-01-01'), score: null })),
  teams: [],
  coverage,
  heldBack: games.slice(1, 2).map(({ game }) => ({ game, status: 'Unknown' })),
});

// Starts every team of the directory on a day of none of its box scores.
const startsNeverPlayed = (directory: readonly DirectoryEntry[]): readonly DirectoryEntry[] =>
  directory.map((entry) => ({
    ...entry,
    teams: entry.teams.map((team) => ({ ...team, firstGameDay: NEVER_PLAYED })),
  }));

// Answers every call as an outage, whatever it asks, an aborted call included.
const unavailable = vi.fn<() => Promise<StatsSourceOutcome<never>>>().mockResolvedValue({
  ok: false,
  error: { kind: 'unavailable' },
  call: { httpRequests: 1, bytesReceived: 0, fileRequests: 0 },
});

/** An adapter that fails every call as an outage. */
function failingHarness(): StatsSourceHarness {
  return {
    ...fakeHarness(),
    source: {
      checkHealth: unavailable,
      getPublication: unavailable,
      getSeasonGames: unavailable,
      getSeasonBoxScores: unavailable,
      getSeasonPlayers: unavailable,
      getPlayerRecords: unavailable,
      firstCoveredSeason: () => NEVER_HELD,
    },
  };
}

/** An adapter that breaks every case of the contract, to prove that each case finds it. */
function brokenHarness(): StatsSourceHarness {
  const harness = fakeHarness();
  const { source, season, currentSeason, unknownPlayer } = harness;
  const allPlayers = ['p01', 'p02', 'p03', 'p04', 'p05', 'p08', 'p09', 'p10'];
  return {
    ...harness,
    inject: () => {
      // Meets no fault.
    },
    source: {
      checkHealth: async () => ({
        ...(await source.checkHealth(anyContext())),
        call: { httpRequests: 2, bytesReceived: 0, fileRequests: 0 },
      }),
      getPublication: async () => source.getPublication(anyContext(), { knownVersion: null }),
      getSeasonGames: async (_ctx, request) =>
        request.season === NEVER_HELD
          ? {
              ok: false,
              error: { kind: 'unavailable' },
              call: { httpRequests: 1, bytesReceived: 0, fileRequests: 0 },
            }
          : changed(
              await source.getSeasonGames(anyContext(), { season, knownVersion: null }),
              brokenSchedule,
            ),
      getSeasonBoxScores: async () =>
        changedRead(
          await source.getSeasonBoxScores(anyContext(), {
            season,
            players: allPlayers,
            knownVersion: null,
          }),
          (read) => ({
            ...read,
            data: read.data.map((line) => ({ ...line, isHome: !line.isHome })),
            sidesWithLines: [],
          }),
        ),
      getSeasonPlayers: async () =>
        changed(
          await source.getSeasonPlayers(anyContext(), { season, knownVersion: null }),
          startsNeverPlayed,
        ),
      getPlayerRecords: async (_ctx, { players }) =>
        changed(
          await source.getPlayerRecords(anyContext(), {
            season: currentSeason,
            players: players.filter((player) => player !== unknownPlayer),
            knownVersion: null,
          }),
          (records) =>
            records.map((record) => ({ ...record, currentTeam: { kind: 'not_listed' } })),
        ),
      firstCoveredSeason: () => NEVER_HELD,
    },
  };
}

/** The fake with its directory alone broken, against its intact schedule and box scores. */
function brokenDirectoryHarness(): StatsSourceHarness {
  const harness = fakeHarness();
  const { source } = harness;
  return {
    ...harness,
    source: {
      checkHealth: async (ctx) => source.checkHealth(ctx),
      getPublication: async (ctx, request) => source.getPublication(ctx, request),
      getSeasonGames: async (ctx, request) => source.getSeasonGames(ctx, request),
      getSeasonBoxScores: async (ctx, request) => source.getSeasonBoxScores(ctx, request),
      getSeasonPlayers: async (ctx, request) =>
        changed(await source.getSeasonPlayers(ctx, request), startsNeverPlayed),
      getPlayerRecords: async (ctx, request) => source.getPlayerRecords(ctx, request),
      firstCoveredSeason: () => source.firstCoveredSeason(),
    },
  };
}

/** The operations that a wrong adapter answers instead of the fake's. */
type WrongSource = (source: StatsSource) => Partial<StatsSource>;

/** Every problem that the cases of the contract find, each in a fresh fake with the operations of `wrong`. */
async function contractProblems(wrong: WrongSource): Promise<readonly string[]> {
  const problems = await Promise.all(
    STATS_SOURCE_CONTRACT.map(async ({ check }) => {
      const harness = fakeHarness();
      return check({ ...harness, source: { ...harness.source, ...wrong(harness.source) } });
    }),
  );
  return problems.flat();
}

// Gives the released player his old team.
const givesReleasedHisOldTeam: WrongSource = (source) => ({
  getPlayerRecords: async (ctx, request) =>
    changed(await source.getPlayerRecords(ctx, request), (records) =>
      records.map((record) =>
        record.player === RELEASED
          ? { ...record, currentTeam: { kind: 'team', team: '4' } }
          : record,
      ),
    ),
});

// Flags the sides of each game by the lines asked alone.
const flagsAskedSidesOnly: WrongSource = (source) => ({
  getSeasonBoxScores: async (ctx, request) =>
    changedRead(await source.getSeasonBoxScores(ctx, request), (read) => ({
      ...read,
      sidesWithLines: read.data.map(({ game, isHome }) => ({
        game,
        home: isHome,
        away: !isHome,
      })),
    })),
});

// Flags the home side alone of each game that holds lines.
const flagsHomeSidesOnly: WrongSource = (source) => ({
  getSeasonBoxScores: async (ctx, request) =>
    changedRead(await source.getSeasonBoxScores(ctx, request), (read) => ({
      ...read,
      sidesWithLines: read.sidesWithLines.map(({ game }) => ({ game, home: true, away: false })),
    })),
});

// Flags both sides of every game of the season, played or not.
const flagsEverySide: WrongSource = (source) => ({
  getSeasonBoxScores: async (ctx, request) => {
    const { games } = readOf(
      await source.getSeasonGames(ctx, { season: request.season, knownVersion: null }),
    ) ?? { games: [] };
    return changedRead(await source.getSeasonBoxScores(ctx, request), (read) => ({
      ...read,
      sidesWithLines: games.map(({ game }) => ({ game, home: true, away: true })),
    }));
  },
});

describe('[STA-05] [STA-08] [STA-26] [STA-29] [STA-31] [STA-42] [CL-TRV-03] [CL-STA-04] [CL-STA-27] [CL-STA-31] the fake against the stats-source contract', () => {
  it.each(STATS_SOURCE_CONTRACT)('$title', async ({ check }) => {
    await expect(check(fakeHarness())).resolves.toStrictEqual([]);
  });
});

describe('the stats-source contract against adapters that break it', () => {
  it.each(STATS_SOURCE_CONTRACT)(
    'finds the rule that a wrong adapter breaks: $title',
    async ({ check }) => {
      await expect(check(brokenHarness())).resolves.not.toHaveLength(0);
    },
  );

  it.each(STATS_SOURCE_CONTRACT)(
    'finds the rule that a failing adapter breaks: $title',
    async ({ check }) => {
      await expect(check(failingHarness())).resolves.not.toHaveLength(0);
    },
  );

  it('[STA-26] [CL-STA-27] [CL-STA-31] finds by the released player alone an adapter that gives him his old team', async () => {
    await expect(contractProblems(givesReleasedHisOldTeam)).resolves.toStrictEqual([
      'released players not answered without_team: [{"releasedPlayer":"p08","teams":[{"kind":"team","team":"4"}]}]',
    ]);
  });

  it('[STA-08] [CL-STA-04] finds by the side of a player without a line an adapter that flags the sides by the lines asked only', async () => {
    await expect(contractProblems(flagsAskedSidesOnly)).resolves.toStrictEqual([
      'home sides holding lines of players not asked that are not flagged: [{"game":"2025-26:r01:h3","home":false,"away":false}]',
      'away sides holding lines of players not asked that are not flagged: [{"game":"2025-26:r01:h3","home":false,"away":false}]',
    ]);
  });

  it('[STA-08] [CL-STA-04] finds by the other side of the game an adapter that flags the home sides only', async () => {
    await expect(contractProblems(flagsHomeSidesOnly)).resolves.toStrictEqual([
      'away sides holding lines of players not asked that are not flagged: [{"game":"2025-26:r01:h3","home":true,"away":false}]',
    ]);
  });

  it('[STA-08] [CL-STA-04] finds by its games not played yet an adapter that flags both sides of every game', async () => {
    const problems = await contractProblems(flagsEverySide);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^games not played yet with a side that holds lines: \[\{"game":"2026-27:/u,
    );
  });

  it('[STA-03] [JOU-13] finds by its first and last game days alone a directory whose teams start on a day of none of their box scores', async () => {
    const problems = await listsDirectory(brokenDirectoryHarness());
    const rule =
      'directory teams whose first or last game day is the day of none of his box scores';

    expect(problems).not.toHaveLength(0);
    expect(problems.filter((found) => !found.startsWith(rule))).toStrictEqual([]);
  });
});
