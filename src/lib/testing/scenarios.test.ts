import { and, asc, eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkEvents, checkLeadsAndLimitations, readResult } from '@/lib/ai-exchange';
import {
  backtestCoveragePeriods,
  backtestRequests,
  backtestRequestTypes,
  boxScores,
  cases,
  createTestDatabase,
  events as eventRows,
  eventTypes,
  followedPlayers,
  games,
  installation,
  parameterOverrides,
} from '@/lib/db';
import { gameScore } from '@/lib/stats-engine';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import emptyResult from '@data/fixtures/testing/research-results/request-to-do-empty.json';
import result from '@data/fixtures/testing/research-results/request-to-do.json';

import { leaguePlayerId } from './factories/players';
import {
  applyScenarios,
  playerWithoutBacktest,
  profiledPlayer,
  requestToDo,
  scenarios,
  validatedTypeWithCalendarSibling,
} from './scenarios';
import { DATABASE_TEST_TIMEOUT_MS } from './timeouts';

import type { Scenario } from './scenarios';
import type { EventCheckContext, ResearchResult } from '@/lib/ai-exchange';
import type { Database } from '@/lib/db';
import type { GameScoreInput } from '@/lib/stats-engine';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const SCENARIO_NAMES = [
  'player-without-backtest',
  'profiled-player',
  'request-to-do',
  'validated-type-with-calendar-sibling',
];
const MEDIA_STORM = 'media-storm';
// The import's checks as the request of the request-to-do scenario calls them, with the
// parameters' default values.
const REQUESTED = { startOn: '2023-10-24', endOn: '2026-11-08' };
const MAX_TEXT_LENGTH = 300;
const CHECKS: EventCheckContext = {
  taxonomy: [{ id: MEDIA_STORM, standing: 'research', status: 'validated' }],
  requestedTypes: [{ id: MEDIA_STORM, period: REQUESTED, sheetVersion: 1 }],
  coveredTypes: [MEDIA_STORM],
  declaredPeriod: REQUESTED,
  firstNbaGameOn: '2023-10-24',
  splitChoices: [],
  maxDescriptionLength: MAX_TEXT_LENGTH,
  maxSourcesPerEvent: 3,
  maxSourceLeadDays: 1,
  sourceRules: { cleanLink: (url) => url, disallowedDomains: [], checkedAt: AT },
};

// The profiled player's request, the period it asks and its import covers.
const PROFILED_PERIOD = { startOn: '2023-10-24', endOn: '2025-06-02' };
// His seven cases: the day of each event, the instant it became public, the end of that
// day in Pacific time (SEN-01), daylight saving time until 3 November 2024, and his whole
// minutes in the game measured, the next one of his team.
const MEASURED = [
  ['2024-10-21', '2024-10-22T07:00:00.000Z', 34],
  ['2024-10-24', '2024-10-25T07:00:00.000Z', 38],
  ['2024-10-27', '2024-10-28T07:00:00.000Z', 28],
  ['2024-10-30', '2024-10-31T07:00:00.000Z', 15],
  ['2024-11-02', '2024-11-03T07:00:00.000Z', 22],
  ['2024-11-05', '2024-11-06T08:00:00.000Z', 34],
  ['2024-11-08', '2024-11-09T08:00:00.000Z', 38],
] as const;

/** A stored total, which a complete line always holds. */
const total = (value: number | null): number => value ?? NaN;

/** The twelve totals of a stored line that the Game Score reads (STA-11). */
function totalsOf(line: typeof boxScores.$inferSelect): GameScoreInput {
  return {
    points: total(line.points),
    fieldGoalsMade: total(line.fieldGoalsMade),
    fieldGoalsAttempted: total(line.fieldGoalsAttempted),
    freeThrowsMade: total(line.freeThrowsMade),
    freeThrowsAttempted: total(line.freeThrowsAttempted),
    offensiveRebounds: total(line.offensiveRebounds),
    defensiveRebounds: total(line.defensiveRebounds),
    steals: total(line.steals),
    assists: total(line.assists),
    blocks: total(line.blocks),
    personalFouls: total(line.personalFouls),
    turnovers: total(line.turnovers),
  };
}

/**
 * Each stored case beside the box score of its measured game: when its event became
 * public and whether before the tip-off, its minutes, its baseline, and whether its
 * minutes, Game Score and performance index are those of the line (STA-11, STA-12).
 */
async function casesBesideTheirLines(db: Database) {
  const rows = await db
    .select({ measured: cases, line: boxScores, tipOff: games.scheduledStartAt })
    .from(cases)
    .innerJoin(
      boxScores,
      and(eq(boxScores.gameId, cases.measuredGameId), eq(boxScores.playerId, cases.playerId)),
    )
    .innerJoin(games, eq(games.id, cases.measuredGameId))
    .orderBy(asc(cases.id));
  return rows.map(({ measured, line, tipOff }) => {
    const score = gameScore(totalsOf(line));
    const publicAt = measured.referenceInstantAt ?? tipOff;
    return {
      publicAt: publicAt.toISOString(),
      minutes: measured.measuredMinutes,
      baseline: [
        measured.baselineSeason,
        measured.baselinePhase,
        measured.baselineGameCount,
        measured.baselineStatus,
      ].join(' '),
      isPublicBeforeTipOff: publicAt < tipOff,
      agreesWithItsLine:
        measured.measuredMinutes === line.minutes &&
        measured.measuredGameScore === score &&
        measured.performanceIndex === score / total(line.minutes),
    };
  });
}

/** The research result that `fixture` holds, read by the import as the owner pastes it. */
function readFixture(fixture: unknown): ResearchResult {
  const read = readResult(JSON.stringify(fixture), [MEDIA_STORM]);
  if (!read.ok || read.resultWarnings.length > 0 || read.recovery !== undefined) {
    throw new Error(`The import does not read the fixture cleanly: ${JSON.stringify(read)}`);
  }
  return read.result;
}

describe('the scenarios', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('follows a player without backtest: no request, no coverage', async () => {
    const player = await playerWithoutBacktest(db);

    expect(player).toMatchObject({ id: leaguePlayerId('p04'), displayName: 'Corwin Ashgrove' });
    await expect(db.select().from(backtestRequests)).resolves.toStrictEqual([]);
    await expect(db.select().from(backtestCoveragePeriods)).resolves.toStrictEqual([]);
  });

  it('profiles a player: his request of 2025 imported over the type, and his box scores of the season', async () => {
    const { player, request, imported } = await profiledPlayer(db);

    expect(player).toMatchObject({ id: leaguePlayerId('p01'), displayName: 'Ansel Varga' });
    expect(request).toMatchObject({ reference: 'REQ-2025-0001', createdOn: '2025-06-02' });
    await expect(
      db
        .select({
          status: backtestRequests.status,
          startOn: backtestRequestTypes.periodStartOn,
          endOn: backtestRequestTypes.periodEndOn,
        })
        .from(backtestRequests)
        .innerJoin(
          backtestRequestTypes,
          eq(backtestRequestTypes.backtestRequestId, backtestRequests.id),
        ),
    ).resolves.toStrictEqual([{ status: 'imported', ...PROFILED_PERIOD }]);
    await expect(
      db
        .select({
          importId: backtestCoveragePeriods.importId,
          type: backtestCoveragePeriods.eventTypeId,
          startOn: backtestCoveragePeriods.startOn,
          endOn: backtestCoveragePeriods.endOn,
        })
        .from(backtestCoveragePeriods),
    ).resolves.toStrictEqual([{ importId: imported.id, type: MEDIA_STORM, ...PROFILED_PERIOD }]);
    await expect(
      db.select().from(boxScores).where(eq(boxScores.playerId, player.id)),
    ).resolves.toHaveLength(10);
  });

  it('[SEN-01] [SEN-08] [STA-12] [STA-19] measures each case of the profiled player from the box score of its game and the nine other games of his season, after the end of the day of its event in Pacific time', async () => {
    const { events } = await profiledPlayer(db);

    await expect(db.select().from(parameterOverrides)).resolves.toMatchObject([
      { parameterKey: 'games.minBaselineGames', value: 9 },
    ]);
    expect(events.map(({ referenceDateOn }) => referenceDateOn)).toStrictEqual(
      MEASURED.map(([eventOn]) => eventOn),
    );
    await expect(casesBesideTheirLines(db)).resolves.toStrictEqual(
      MEASURED.map(([, publicAt, minutes]) => ({
        publicAt,
        minutes,
        baseline: '2024-25 regular_season 9 final',
        isPublicBeforeTipOff: true,
        agreesWithItsLine: true,
      })),
    );
  });

  it('[SEN-07] gives the profiled player seven valid cases of one type, each measured at a game of his and caused by a media storm of the day before', async () => {
    const { player, cases: written, events } = await profiledPlayer(db);
    const stored = await db
      .select({ type: cases.eventTypeId, status: cases.status, game: cases.measuredGameId })
      .from(cases)
      .where(eq(cases.playerId, player.id));
    const linked = await db
      .select({ caseId: eventRows.caseId, day: eventRows.referenceDateOn })
      .from(eventRows)
      .orderBy(asc(eventRows.referenceDateOn));

    expect(stored).toHaveLength(7);
    expect(new Set(stored.map(({ type, status }) => `${type} ${status}`))).toStrictEqual(
      new Set([`${MEDIA_STORM} measured`]),
    );
    expect(new Set(stored.map(({ game }) => game)).size).toBe(7);
    expect(linked.map(({ caseId }) => caseId)).toStrictEqual(written.map(({ id }) => id));
    expect(events.map(({ referenceDateOn }) => referenceDateOn)).toStrictEqual(
      linked.map(({ day }) => day),
    );
  });

  it('writes a request to do whose prompt was copied', async () => {
    const { player, request } = await requestToDo(db);

    expect(player.id).toBe(leaguePlayerId('p09'));
    expect(request).toMatchObject({
      playerId: player.id,
      reference: 'REQ-2026-0001',
      status: 'to_do',
      lastCopiedAt: new Date(AT),
    });
  });

  it('[TAX-10] writes a validated type beside its calendar-derived sibling', async () => {
    const { type, sibling } = await validatedTypeWithCalendarSibling(db);

    expect([type, sibling]).toMatchObject([
      { id: MEDIA_STORM, status: 'validated', calendarDerivation: null },
      { id: 'birthday', status: 'validated', calendarDerivation: 'birthday' },
    ]);
  });

  it('registers each scenario of the testing module under its name', () => {
    expect(new Set(scenarios.keys())).toStrictEqual(new Set(SCENARIO_NAMES));
  });

  it.each([
    ['in the order of the list', SCENARIO_NAMES],
    ['in the reverse order', SCENARIO_NAMES.toReversed()],
  ])('applies every scenario together, %s', async (_order, names) => {
    await expect(applyScenarios(db, names)).resolves.toStrictEqual({ ok: true, value: names });

    await expect(
      db.select({ id: followedPlayers.id }).from(followedPlayers).orderBy(asc(followedPlayers.id)),
    ).resolves.toStrictEqual([
      { id: leaguePlayerId('p01') },
      { id: leaguePlayerId('p04') },
      { id: leaguePlayerId('p09') },
    ]);
    await expect(
      db
        .select({ id: eventTypes.id })
        .from(eventTypes)
        .where(ne(eventTypes.status, 'proposed'))
        .orderBy(asc(eventTypes.id)),
    ).resolves.toStrictEqual([{ id: 'birthday' }, { id: MEDIA_STORM }]);
    await expect(
      db
        .select({ reference: backtestRequests.reference, status: backtestRequests.status })
        .from(backtestRequests)
        .orderBy(asc(backtestRequests.reference)),
    ).resolves.toStrictEqual([
      { reference: 'REQ-2025-0001', status: 'imported' },
      { reference: 'REQ-2026-0001', status: 'to_do' },
    ]);
  });

  it('applies the scenarios in the order given, each one once the one before it has ended', async () => {
    const ran: string[] = [];
    const step =
      (name: string): Scenario =>
      async () => {
        ran.push(`${name} starts`);
        await Promise.resolve();
        ran.push(`${name} ends`);
      };
    const registry = new Map([
      ['first', step('first')],
      ['second', step('second')],
      ['third', step('third')],
    ]);

    await expect(applyScenarios(db, ['third', 'first', 'second'], registry)).resolves.toStrictEqual(
      { ok: true, value: ['third', 'first', 'second'] },
    );
    expect(ran).toStrictEqual([
      'third starts',
      'third ends',
      'first starts',
      'first ends',
      'second starts',
      'second ends',
    ]);
  });

  it.each([[['profiled-player', 'request-to-do']], [['request-to-do']]])(
    'applies two seeds of %j at once, one after the other, and writes their rows once',
    async (names) => {
      await expect(
        Promise.all([applyScenarios(db, names), applyScenarios(db, names)]),
      ).resolves.toStrictEqual([
        { ok: true, value: names },
        { ok: true, value: names },
      ]);

      await expect(
        db.select({ player: backtestRequests.playerId }).from(backtestRequests),
      ).resolves.toHaveLength(names.length);
      await expect(
        db.select({ id: followedPlayers.id }).from(followedPlayers),
      ).resolves.toHaveLength(names.length);
    },
  );

  it('writes nothing of a seed whose scenario throws, the scenarios before it included', async () => {
    const registry = new Map<string, Scenario>([
      ['request-to-do', requestToDo],
      [
        'broken',
        async (tx) => {
          await playerWithoutBacktest(tx);
          throw new Error('A broken scenario.');
        },
      ],
    ]);

    await expect(applyScenarios(db, ['request-to-do', 'broken'], registry)).rejects.toThrow(
      'A broken scenario.',
    );
    await expect(db.select().from(followedPlayers)).resolves.toStrictEqual([]);
    await expect(db.select().from(eventTypes)).resolves.toStrictEqual([]);
  });

  it('[SEN-07] leaves the profiled player as he is when applied again, and gives the rows it wrote', async () => {
    const written = await profiledPlayer(db);

    await expect(profiledPlayer(db)).resolves.toStrictEqual(written);
    expect(written.request.status).toBe('imported');
    await expect(db.select({ id: cases.id }).from(cases)).resolves.toHaveLength(7);
    await expect(db.select({ id: eventRows.id }).from(eventRows)).resolves.toHaveLength(7);
  });

  it('applies a scenario named twice once, and every scenario again on a database that holds them', async () => {
    await expect(applyScenarios(db, ['request-to-do', 'request-to-do'])).resolves.toStrictEqual({
      ok: true,
      value: ['request-to-do', 'request-to-do'],
    });
    await expect(applyScenarios(db, SCENARIO_NAMES)).resolves.toStrictEqual({
      ok: true,
      value: SCENARIO_NAMES,
    });
    await expect(applyScenarios(db, SCENARIO_NAMES)).resolves.toStrictEqual({
      ok: true,
      value: SCENARIO_NAMES,
    });

    await expect(
      db
        .select({ reference: backtestRequests.reference, player: backtestRequests.playerId })
        .from(backtestRequests)
        .orderBy(asc(backtestRequests.reference)),
    ).resolves.toStrictEqual([
      { reference: 'REQ-2025-0001', player: leaguePlayerId('p01') },
      { reference: 'REQ-2026-0001', player: leaguePlayerId('p09') },
    ]);
    await expect(db.select({ id: cases.id }).from(cases)).resolves.toHaveLength(7);
  });

  it('[TAX-15] loads the reference data before any scenario: the installation row and the nine candidate types, proposed, and no player', async () => {
    await expect(applyScenarios(db, [])).resolves.toStrictEqual({ ok: true, value: [] });

    await expect(db.select().from(installation)).resolves.toStrictEqual([
      { id: 1, firstStartedAt: new Date(AT) },
    ]);
    await expect(
      db
        .select({ id: eventTypes.id, status: eventTypes.status, origin: eventTypes.origin })
        .from(eventTypes)
        .orderBy(asc(eventTypes.id)),
    ).resolves.toStrictEqual(
      [
        'bereavement',
        'birthday',
        'former-team',
        'media-storm',
        'negative-record',
        'player-conflict',
        'public-humiliation',
        'racist-abuse',
        'record-approach',
      ].map((id) => ({ id, status: 'proposed', origin: 'scoping' })),
    );
    await expect(db.select().from(followedPlayers)).resolves.toStrictEqual([]);
  });

  it('[TAX-15] gives a scenario the validated types it asks for over the seeded proposals, the other seven staying proposed', async () => {
    await applyScenarios(db, ['validated-type-with-calendar-sibling']);

    await expect(
      db
        .select({
          id: eventTypes.id,
          status: eventTypes.status,
          version: eventTypes.currentVersionNumber,
        })
        .from(eventTypes)
        .where(ne(eventTypes.status, 'proposed'))
        .orderBy(asc(eventTypes.id)),
    ).resolves.toStrictEqual([
      { id: 'birthday', status: 'validated', version: 1 },
      { id: 'media-storm', status: 'validated', version: 1 },
    ]);
    await expect(db.select({ id: eventTypes.id }).from(eventTypes)).resolves.toHaveLength(9);
  });

  it('[TAX-15] leaves the types that a scenario validated, and a proposal the owner edited, as they are when it seeds again', async () => {
    await applyScenarios(db, ['validated-type-with-calendar-sibling']);
    await db
      .update(eventTypes)
      .set({ name: 'Edited name' })
      .where(eq(eventTypes.id, 'racist-abuse'));
    const before = await db.select().from(eventTypes).orderBy(asc(eventTypes.id));

    await applyScenarios(db, ['validated-type-with-calendar-sibling']);

    await expect(db.select().from(eventTypes).orderBy(asc(eventTypes.id))).resolves.toStrictEqual(
      before,
    );
    await expect(db.select().from(installation)).resolves.toHaveLength(1);
  });

  it('applies nothing when a name is unknown, and names the unknown ones', async () => {
    await expect(
      applyScenarios(db, ['request-to-do', 'a-world-nobody-wrote', 'toString']),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unknown_scenarios', names: ['a-world-nobody-wrote', 'toString'] },
    });
    await expect(db.select().from(followedPlayers)).resolves.toStrictEqual([]);
  });

  it.each([
    ['two media storms', result, 2],
    ['no event', emptyResult, 0],
  ])(
    'answers the request to do with a research result in the format 1.0 that the import takes without a warning: %s',
    async (_case, fixture, eventCount) => {
      const { player, request } = await requestToDo(db);
      const read = readFixture(fixture);

      expect(read).toMatchObject({
        reference: request.reference,
        player: { id: player.id, name: player.displayName },
        coveredTypes: [MEDIA_STORM],
        coveredPeriod: REQUESTED,
      });
      expect(checkEvents(read.events, CHECKS)).toMatchObject(
        Array.from({ length: eventCount }, () => ({ outcome: 'added', warnings: [] })),
      );
      expect(checkLeadsAndLimitations(read, [MEDIA_STORM], MAX_TEXT_LENGTH)).toMatchObject({
        warnings: [],
      });
    },
  );
});
