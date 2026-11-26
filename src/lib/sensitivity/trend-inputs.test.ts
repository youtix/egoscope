import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  caseManualDecisions,
  cases,
  caseTriggeredCriteria,
  createTestDatabase,
  games,
  parameterOverrides,
  tallyExits,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { buildTrendInput } from './trend-inputs';

import type { TrendInput } from './trend-inputs';
import type { Database } from '@/lib/db';

const P01 = leaguePlayerId('p01');
const P07 = leaguePlayerId('p07');
const TRADE_RUMOR = 'trade-rumor';
const CONTRACT = 'contract-signing';
// Sunday 8 November 2026, noon in New York.
const NOW = toEpochMs(Date.UTC(2026, 10, 8, 17, 0));
// Two instants of manual decisions, the second a day later.
const FIRST_DECISION = Date.UTC(2026, 10, 1, 15, 0);
const SECOND_DECISION = Date.UTC(2026, 10, 2, 15, 0);
// A day before the first of them.
const DAY_BEFORE_DECISIONS = Date.UTC(2026, 9, 31, 15, 0);
// What a measured or excluded case holds beside its gap (cases_measured_check).
const MEASUREMENT = {
  status: 'measured',
  performanceIndex: 0.6,
  baselineSeason: '2025-26',
  baselinePhase: 'regular_season',
  baselineGameCount: 9,
  baselineMean: 0.45,
  baselineStandardDeviation: 0.2,
  baselineStatus: 'final',
  baselineIsPartial: false,
  gapStatus: 'final',
} as const;

type CaseValues = Partial<typeof cases.$inferInsert> &
  Readonly<{ playerId: string; measuredGameId: number | null }>;

type World = Readonly<{
  db: Database;
  games: Readonly<Record<'g1' | 'g2' | 'g3' | 'g4' | 'g5', number>>;
  imports: Readonly<Record<string, number>>;
  startOf: ReadonlyMap<number, number>;
}>;

function firstOf<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the row looked for is missing');
  }
  return row;
}

/** Writes a case of the media storm, measured unless `values` say otherwise. */
async function caseOf(db: Database, values: CaseValues): Promise<number> {
  const rows = await db
    .insert(cases)
    .values({
      eventTypeId: MEDIA_STORM,
      origin: 'historical',
      referenceInstantAt: new Date(NOW),
      referenceInstantOrigin: 'date_only',
      ...MEASUREMENT,
      normalizedGap: 0.8,
      ...values,
    })
    .returning({ id: cases.id });
  return firstOf(rows).id;
}

/** Writes a historical media storm of the player in the case `caseId`. */
async function eventIn(
  world: World,
  { playerId, caseId }: Readonly<{ playerId: string; caseId: number }>,
  researchConfidence: 'high' | 'medium' | 'low',
): Promise<void> {
  const originImportId = world.imports[playerId] ?? 0;
  await insertHistoricalEvent(world.db, {
    playerId,
    originImportId,
    overrides: { caseId, researchConfidence },
  });
}

/** A manual exclusion of `caseId`, made on `measuredGameId` at `decidedAt`. */
function exclusion(caseId: number, measuredGameId: number, decidedAt = FIRST_DECISION) {
  return {
    caseId,
    kind: 'exclude',
    exclusionReason: 'opponent_strength',
    previousStatus: 'measured',
    measuredGameId,
    decidedAt: new Date(decidedAt),
  } as const;
}

/** A reinstatement of `caseId`, made on `measuredGameId` at `decidedAt`. */
function reinstatement(caseId: number, measuredGameId: number, decidedAt: number) {
  return {
    ...exclusion(caseId, measuredGameId, decidedAt),
    kind: 'reinstate',
    exclusionReason: null,
    reinstatementReason: 'incorrect_context_indication',
    previousStatus: 'excluded',
  } as const;
}

/** The invented league's 2025-26 season, its two players, and three types. */
async function buildWorld(db: Database): Promise<World> {
  await insertLeagueSeason(db, '2025-26');
  await insertPlayer(db);
  await insertPlayer(db, { source: 'p07' });
  await insertEventType(db);
  await insertEventType(db, { id: TRADE_RUMOR, name: 'Trade rumor' });
  await insertEventType(db, {
    id: CONTRACT,
    name: 'Contract signing',
    status: 'withdrawn',
    withdrawalReasonKind: 'entered',
    withdrawalReason: 'Contracts are signed on the schedule of the league.',
  });
  const ofP01 = await insertImport(db, { request: await insertRequest(db, { playerId: P01 }) });
  const ofP07 = await insertImport(db, { request: await insertRequest(db, { playerId: P07 }) });
  const starts = await db
    .select({ id: games.id, at: games.scheduledStartAt })
    .from(games)
    .orderBy(asc(games.id));
  const startOf = new Map(starts.map(({ id, at }) => [id, at.getTime()]));
  const at = (index: number) => firstOf(starts.slice(index)).id;
  const ofGames = { g1: at(0), g2: at(1), g3: at(2), g4: at(3), g5: at(4) };
  return { db, games: ofGames, imports: { [P01]: ofP01.id, [P07]: ofP07.id }, startOf };
}

describe('the input of a type’s trend', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let world: World;
  let ids: Readonly<Record<'measured' | 'excluded' | 'withdrawnPlayers' | 'reinstated', number>>;
  let pending: Readonly<Record<'awaiting' | 'unmeasurable' | 'dismissed', number>>;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(NOW));
    world = await buildWorld(db);
    const { g1, g2, g3, g4, g5 } = world.games;
    ids = {
      measured: await caseOf(db, { playerId: P01, measuredGameId: g1 }),
      excluded: await caseOf(db, {
        playerId: P01,
        measuredGameId: g2,
        origin: 'tracked',
        status: 'excluded',
        normalizedGap: -1.2,
        gapStatus: 'provisional',
      }),
      withdrawnPlayers: await caseOf(db, {
        playerId: P07,
        measuredGameId: g1,
        status: 'excluded',
        normalizedGap: 0.3,
      }),
      reinstated: await caseOf(db, { playerId: P01, measuredGameId: g3, normalizedGap: 1.5 }),
    };
    pending = {
      awaiting: await caseOf(db, {
        playerId: P01,
        measuredGameId: null,
        status: 'awaiting_game',
        statusReason: 'precedence_to_verify',
      }),
      unmeasurable: await caseOf(db, {
        playerId: P01,
        measuredGameId: g4,
        status: 'not_measurable',
        statusReason: 'box_score_unavailable',
      }),
      dismissed: await caseOf(db, { playerId: P01, measuredGameId: g5, normalizedGap: 2 }),
    };
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** His events in each case, the cases of the other types, the criteria and decisions. */
  async function fillCases(): Promise<void> {
    const { g1, g2, g3, g4 } = world.games;
    await eventIn(world, { playerId: P01, caseId: ids.measured }, 'high');
    await eventIn(world, { playerId: P01, caseId: ids.measured }, 'medium');
    await insertDetectedEvent(db, { playerId: P01, overrides: { caseId: ids.excluded } });
    await eventIn(world, { playerId: P07, caseId: ids.withdrawnPlayers }, 'low');
    await eventIn(world, { playerId: P01, caseId: ids.reinstated }, 'high');
    await eventIn(world, { playerId: P01, caseId: pending.awaiting }, 'medium');
    await eventIn(world, { playerId: P01, caseId: pending.unmeasurable }, 'low');
    const dismissal = { detectedStatus: 'dismissed', dismissalReason: 'old_fact' } as const;
    await insertDetectedEvent(db, {
      playerId: P01,
      overrides: { caseId: pending.dismissed, ...dismissal, dismissedAt: new Date(NOW) },
    });
    // A case of another validated type of his on the same game, and of a withdrawn one of p07's.
    await caseOf(db, { playerId: P01, measuredGameId: g1, eventTypeId: TRADE_RUMOR });
    await caseOf(db, { playerId: P07, measuredGameId: g1, eventTypeId: CONTRACT });
    await db.insert(caseTriggeredCriteria).values([
      { caseId: ids.excluded, criterion: 'opponent_strength', triggeringValues: {} },
      { caseId: ids.excluded, criterion: 'manual', triggeringValues: {} },
      { caseId: ids.withdrawnPlayers, criterion: 'manual', triggeringValues: {} },
    ]);
    await db.insert(caseManualDecisions).values([
      // Made on the game the case was measured at before; none rules it now.
      exclusion(ids.measured, g2),
      exclusion(ids.excluded, g2),
      exclusion(ids.withdrawnPlayers, g1),
      exclusion(ids.reinstated, g3),
      reinstatement(ids.reinstated, g3, SECOND_DECISION),
      exclusion(pending.unmeasurable, g4),
    ]);
  }

  async function trendOf(eventTypeId: string): Promise<TrendInput> {
    const built = await buildTrendInput(db, eventTypeId);
    if (!built.ok) {
      throw new Error('the type looked for exists');
    }
    return built.value;
  }

  it('[SEN-19] [SEN-20] [SEN-21] [SEN-28] [SEN-06] [SEN-48] [H-JOU-07] [CL-SEN-19] gives the stored outcome of every player’s case of the type with its events that count and its co-occurrence, and none for a case whose events were all dismissed', async () => {
    await fillCases();
    const { g1, g2, g3 } = world.games;
    const { input } = await trendOf(MEDIA_STORM);
    const startOf = (gameId: number) => world.startOf.get(gameId);
    expect(input.cases).toStrictEqual([
      {
        caseId: ids.measured,
        playerId: P01,
        origin: 'historical',
        events: [{ researchConfidence: 'high' }, { researchConfidence: 'medium' }],
        isCoOccurring: true,
        status: 'measured',
        measuredGameScheduledStartAt: startOf(g1),
        normalizedGap: 0.8,
        gapStatus: 'final',
      },
      {
        caseId: ids.excluded,
        playerId: P01,
        origin: 'tracked',
        events: [{ researchConfidence: null }],
        isCoOccurring: false,
        status: 'excluded',
        triggeredCriteria: ['opponent_strength', 'manual'],
        measuredGameScheduledStartAt: startOf(g2),
        normalizedGap: -1.2,
        gapStatus: 'provisional',
      },
      {
        caseId: ids.withdrawnPlayers,
        playerId: P07,
        origin: 'historical',
        events: [{ researchConfidence: 'low' }],
        isCoOccurring: false,
        status: 'excluded',
        triggeredCriteria: ['manual'],
        measuredGameScheduledStartAt: startOf(g1),
        normalizedGap: 0.3,
        gapStatus: 'final',
      },
      {
        caseId: ids.reinstated,
        playerId: P01,
        origin: 'historical',
        events: [{ researchConfidence: 'high' }],
        isCoOccurring: false,
        status: 'measured',
        measuredGameScheduledStartAt: startOf(g3),
        normalizedGap: 1.5,
        gapStatus: 'final',
      },
      {
        caseId: pending.awaiting,
        playerId: P01,
        origin: 'historical',
        events: [{ researchConfidence: 'medium' }],
        isCoOccurring: false,
        status: 'awaiting_game',
        statusReason: 'precedence_to_verify',
      },
      {
        caseId: pending.unmeasurable,
        playerId: P01,
        origin: 'historical',
        events: [{ researchConfidence: 'low' }],
        isCoOccurring: false,
        status: 'not_measurable',
        statusReason: 'box_score_unavailable',
      },
    ]);
    expect(input.typeStatus).toBe('validated');
  });

  it('[SEN-17] [SEN-27] [CL-SEN-12] gives each measured or excluded case that a decision made on its game rules, with the status its automatic criteria give it, measured once an exclusion made by hand is undone', async () => {
    await fillCases();
    const { input } = await trendOf(MEDIA_STORM);
    expect(input.manuallyDecidedCases).toStrictEqual([
      { caseId: ids.excluded, statusWithoutDecision: 'excluded' },
      { caseId: ids.withdrawnPlayers, statusWithoutDecision: 'measured' },
      { caseId: ids.reinstated, statusWithoutDecision: 'measured' },
    ]);
  });

  it('[SEN-17] [SEN-27] [CL-SEN-12] gives a reinstated case the status it had before the first decision made on its game, by instant then by id, whatever was decided on another game', async () => {
    const { g1, g2, g3 } = world.games;
    const undone = await caseOf(db, { playerId: P07, measuredGameId: g2 });
    const overridden = await caseOf(db, { playerId: P07, measuredGameId: g3 });
    // Recorded before the exclusion it undoes, and after a reinstatement on another game.
    await db
      .insert(caseManualDecisions)
      .values([
        reinstatement(undone, g1, DAY_BEFORE_DECISIONS),
        reinstatement(undone, g2, SECOND_DECISION),
        exclusion(undone, g2, FIRST_DECISION),
      ]);
    // Automatically excluded, reinstated, excluded at the same instant, then reinstated again.
    await db
      .insert(caseManualDecisions)
      .values([
        reinstatement(overridden, g3, FIRST_DECISION),
        exclusion(overridden, g3, FIRST_DECISION),
        reinstatement(overridden, g3, SECOND_DECISION),
      ]);
    const { input } = await trendOf(MEDIA_STORM);
    expect(input.manuallyDecidedCases).toStrictEqual([
      { caseId: undone, statusWithoutDecision: 'measured' },
      { caseId: overridden, statusWithoutDecision: 'excluded' },
    ]);
  });

  it('[SEN-33] [CL-SEN-19] gives the reasons of the type’s events that left the tally, every player’s, and a withdrawn type with no case that counts', async () => {
    await fillCases();
    await db.insert(tallyExits).values([
      { playerId: P01, eventTypeId: MEDIA_STORM, exitReason: 'merged' },
      { playerId: P01, eventTypeId: TRADE_RUMOR, exitReason: 'merged' },
      { playerId: P07, eventTypeId: MEDIA_STORM, exitReason: 'erased' },
    ]);
    const storms = await trendOf(MEDIA_STORM);
    const contracts = await trendOf(CONTRACT);
    expect(storms.input.exitReasons).toStrictEqual(['merged', 'erased']);
    expect(contracts.input).toStrictEqual({
      typeStatus: 'withdrawn',
      cases: [],
      exitReasons: [],
      manuallyDecidedCases: [],
    });
  });

  it('[TRV-35] refuses a type that does not exist, and gives the calculation parameters in force', async () => {
    const unknown = await buildTrendInput(db, 'unknown-type');
    expect(unknown).toStrictEqual({ ok: false, error: { kind: 'type_not_found' } });
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'sensitivity.minValidCases', value: 6 });
    const { params } = await trendOf(MEDIA_STORM);
    expect(params.sensitivity.minValidCases).toBe(6);
  });

  it('[SEN-10] refuses to read an excluded case that holds no criterion, which its status requires', async () => {
    await eventIn(world, { playerId: P01, caseId: ids.excluded }, 'high');
    await expect(buildTrendInput(db, MEDIA_STORM)).rejects.toThrow(
      'A case holds no criterion, which its status requires',
    );
  });
});
