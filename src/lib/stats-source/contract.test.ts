import { describe, expect, it, vi } from 'vitest';

import { now, toEpochMs, toIsoDate } from '@/lib/time';

import { STATS_SOURCE_CONTRACT } from './contract';
import { createFakeStatsSource } from './fake';

import type { ContractFault, StatsSourceHarness } from './contract';
import type { FakeFault } from './fake';
import type { StatsSourceOutcome } from './port';
import type { CallContext, ConditionalRead, SeasonGames } from './types';

const SEASON = '2025-26';
// A season that the broken adapter below refuses, which it names as its first covered one.
const NEVER_HELD = '1990-91';
const DEADLINE_MS = 5000;

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

// Loses its first game, and holds back its second while it lists it.
const brokenSchedule = ({ games, coverage }: SeasonGames): SeasonGames => ({
  games: games
    .slice(1)
    .map((game) => ({ ...game, season: 'another', gameDay: toIsoDate('2000-01-01'), score: null })),
  teams: [],
  coverage,
  heldBack: games.slice(1, 2).map(({ game }) => ({ game, status: 'Unknown' })),
});

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
        changed(
          await source.getSeasonBoxScores(anyContext(), {
            season,
            players: allPlayers,
            knownVersion: null,
          }),
          (lines) => lines.map((line) => ({ ...line, isHome: !line.isHome })),
        ),
      getSeasonPlayers: async () =>
        changed(
          await source.getSeasonPlayers(anyContext(), { season, knownVersion: null }),
          () => [],
        ),
      getPlayerRecords: async (_ctx, { players }) =>
        changed(
          await source.getPlayerRecords(anyContext(), {
            season: currentSeason,
            players: players.filter((player) => player !== unknownPlayer),
            knownVersion: null,
          }),
          (records) =>
            records.map((record) => ({ ...record, currentTeam: { kind: 'without_team' } })),
        ),
      firstCoveredSeason: () => NEVER_HELD,
    },
  };
}

describe('[STA-05] [STA-08] [STA-29] [STA-31] [STA-42] [CL-TRV-03] [CL-STA-27] the fake against the stats-source contract', () => {
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
});
