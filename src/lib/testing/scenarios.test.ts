import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkEvents, checkLeadsAndLimitations, readResult } from '@/lib/ai-exchange';
import {
  backtestCoveragePeriods,
  backtestRequests,
  boxScores,
  cases,
  createTestDatabase,
  events as eventRows,
  eventTypes,
  followedPlayers,
} from '@/lib/db';
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

import type { EventCheckContext, ResearchResult } from '@/lib/ai-exchange';
import type { Database } from '@/lib/db';

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
      db.select({ status: backtestRequests.status }).from(backtestRequests),
    ).resolves.toStrictEqual([{ status: 'imported' }]);
    await expect(
      db
        .select({
          importId: backtestCoveragePeriods.importId,
          type: backtestCoveragePeriods.eventTypeId,
        })
        .from(backtestCoveragePeriods),
    ).resolves.toStrictEqual([{ importId: imported.id, type: MEDIA_STORM }]);
    await expect(
      db.select().from(boxScores).where(eq(boxScores.playerId, player.id)),
    ).resolves.toHaveLength(10);
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
      db.select({ id: eventTypes.id }).from(eventTypes).orderBy(asc(eventTypes.id)),
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
