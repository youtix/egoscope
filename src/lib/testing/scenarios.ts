import { and, asc, eq, sql } from 'drizzle-orm';

import {
  backtestRequests,
  boxScores,
  cases as caseRows,
  events as eventRows,
  games,
  imports,
} from '@/lib/db';
import { err, ok } from '@/lib/result';
import { seedCandidateTypes } from '@/lib/taxonomy';
import { gameDay, now, toEpochMs } from '@/lib/time';

import { insertImport, insertRequest } from './factories/backtests';
import { insertHistoricalEvent } from './factories/events';
import { insertBoxScores, insertLeagueSeason } from './factories/games';
import { insertPlayer } from './factories/players';
import { insertValidCase } from './factories/sensitivity';
import { insertCalendarType, insertEventType, MEDIA_STORM } from './factories/taxonomy';
import { firstRow, present } from './rows';

import type { ImportRow, RequestRow } from './factories/backtests';
import type { EventRow } from './factories/events';
import type { PlayerRow } from './factories/players';
import type { CaseRow } from './factories/sensitivity';
import type { EventTypeRow } from './factories/taxonomy';
import type { Database } from '@/lib/db';
import type { Result } from '@/lib/result';

/** A named situation of the specs, which writes its rows into a database that may already hold others. */
export type Scenario = (db: Database) => Promise<unknown>;

/** The scenarios of one area and lot, by name. */
export type World = Readonly<Record<string, Scenario>>;

// The season of the invented league in which the profiled player's cases were measured.
const MEASURED_SEASON = '2024-25';
// How many valid cases the profiled player has: seven, of one type.
const VALID_CASES = 7;
const DAY_MS = 86_400_000;
// The day of the profiled player's request, and the period of the media storm it asks
// and its import covers: from his first season to that day.
const PROFILED_REQUEST_ON = '2025-06-02';
const PROFILED_PERIOD = [
  { eventTypeId: MEDIA_STORM, startOn: '2023-10-24', endOn: PROFILED_REQUEST_ON },
] as const;

/**
 * A player without backtest, the glossary's unprofiled player (TRV-76): an invented
 * player of the league followed, his mapping to the source established, and no request
 * made for him.
 */
export async function playerWithoutBacktest(db: Database): Promise<PlayerRow> {
  return insertPlayer(db, { source: 'p04' });
}

/** What `profiledPlayer` wrote. */
export type ProfiledPlayer = Readonly<{
  player: PlayerRow;
  request: RequestRow;
  imported: ImportRow;
  cases: readonly CaseRow[];
  events: readonly EventRow[];
}>;

/** What `profiledPlayer` wrote when it ran before on `db`: the rows of the import of his request, or null. */
async function profiledAlready(db: Database, player: PlayerRow): Promise<ProfiledPlayer | null> {
  const [imported] = await db
    .select()
    .from(imports)
    .where(eq(imports.playerId, player.id))
    .orderBy(asc(imports.id))
    .limit(1);
  if (imported === undefined) {
    return null;
  }
  return {
    player,
    request: firstRow(
      await db
        .select()
        .from(backtestRequests)
        .where(eq(backtestRequests.id, imported.backtestRequestId)),
      'the request imported',
    ),
    imported,
    cases: await db
      .select()
      .from(caseRows)
      .where(eq(caseRows.playerId, player.id))
      .orderBy(asc(caseRows.id)),
    events: await db
      .select()
      .from(eventRows)
      .where(eq(eventRows.originImportId, imported.id))
      .orderBy(asc(eventRows.id)),
  };
}

/**
 * Writes the profiled player's seven cases and their events (SEN-01, SEN-07): a media
 * storm known by the day before each of his first seven games of the measured season,
 * which `imported` recorded, and its case, measured at that game.
 */
async function measureFirstGames(db: Database, imported: ImportRow): Promise<void> {
  const { playerId } = imported;
  const measured = await db
    .select({ id: games.id, tipOff: games.scheduledStartAt })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(and(eq(boxScores.playerId, playerId), eq(games.season, MEASURED_SEASON)))
    .orderBy(asc(games.scheduledStartAt))
    .limit(VALID_CASES);
  for (const game of measured) {
    const eventOn = gameDay(toEpochMs(game.tipOff.getTime() - DAY_MS));
    const measuredCase = await insertValidCase(db, { playerId, measuredGameId: game.id, eventOn });
    await insertHistoricalEvent(db, {
      playerId,
      originImportId: imported.id,
      overrides: { referenceDateOn: eventOn, caseId: measuredCase.id },
    });
  }
}

/**
 * A profiled player with seven valid cases of one type (SEN-01, SEN-07, SEN-08): the
 * first invented player, his request of 2 June 2025 imported over the media storm up to
 * that day, and seven historical media storms, each known by the day before one of his
 * first seven games of 2024-25, public at the end of that day in Pacific time, and
 * measured at that game from the season's games and his box scores as the source serves
 * them, with the minimum baseline size that the league's season sets, 9 (STA-19). Once
 * applied, it is left as it is and gives the rows it wrote, so that scenarios combine.
 */
export async function profiledPlayer(db: Database): Promise<ProfiledPlayer> {
  await insertEventType(db);
  await insertLeagueSeason(db, MEASURED_SEASON);
  const player = await insertPlayer(db, { source: 'p01' });
  await insertBoxScores(db, { playerId: player.id, source: 'p01', season: MEASURED_SEASON });
  const already = await profiledAlready(db, player);
  if (already !== null) {
    return already;
  }
  const request = await insertRequest(db, {
    playerId: player.id,
    types: PROFILED_PERIOD,
    overrides: { createdOn: PROFILED_REQUEST_ON },
  });
  const imported = await insertImport(db, { request, covered: PROFILED_PERIOD });
  await measureFirstGames(db, imported);
  return present(await profiledAlready(db, player), 'the profiled player written');
}

/**
 * A request to do whose prompt was copied (TRV-76): the ninth invented player followed,
 * his initial request asking the media storm, its prompt copied now. Once applied, it is
 * left as it is and gives his request, so that scenarios combine.
 */
export async function requestToDo(
  db: Database,
): Promise<Readonly<{ player: PlayerRow; request: RequestRow }>> {
  await insertEventType(db);
  const player = await insertPlayer(db, { source: 'p09' });
  const [written] = await db
    .select()
    .from(backtestRequests)
    .where(eq(backtestRequests.playerId, player.id))
    .orderBy(asc(backtestRequests.id))
    .limit(1);
  const request =
    written ??
    (await insertRequest(db, {
      playerId: player.id,
      overrides: { lastCopiedAt: new Date(now()) },
    }));
  return { player, request };
}

/**
 * A validated type with a calendar-derived sibling (TAX-10): the media storm, a
 * research type, and the player's birthday, derived from the calendar, both validated.
 */
export async function validatedTypeWithCalendarSibling(
  db: Database,
): Promise<Readonly<{ type: EventTypeRow; sibling: EventTypeRow }>> {
  const type = await insertEventType(db);
  const sibling = await insertCalendarType(db);
  return { type, sibling };
}

// The scenarios of the testing module itself, which the areas' own build on.
const COMMON_WORLD: World = {
  'player-without-backtest': playerWithoutBacktest,
  'profiled-player': profiledPlayer,
  'request-to-do': requestToDo,
  'validated-type-with-calendar-sibling': validatedTypeWithCalendarSibling,
};

// The worlds of the areas: one registration line per planning area and lot, each the
// world of src/lib/testing/worlds/<area>-lot<n>.ts that the area writes (module map,
// testing). An area replaces its own commented line, and touches no other.
const WORLDS: readonly World[] = [
  COMMON_WORLD,
  // players-taxonomy, Lot 1: worlds/players-taxonomy-lot1.ts
  // players-taxonomy, Lot 2: worlds/players-taxonomy-lot2.ts
  // backtest-import, Lot 1: worlds/backtest-import-lot1.ts
  // backtest-import, Lot 2: worlds/backtest-import-lot2.ts
  // statistics-sensitivity, Lot 1: worlds/statistics-sensitivity-lot1.ts
  // statistics-sensitivity, Lot 2: worlds/statistics-sensitivity-lot2.ts
  // collection-detection, Lot 2: worlds/collection-detection-lot2.ts
  // alerts-tracking-telegram, Lot 2: worlds/alerts-tracking-telegram-lot2.ts
  // interface, Lot 1: worlds/interface-lot1.ts
  // interface, Lot 2: worlds/interface-lot2.ts
  // sensitive-crosscutting, Lot 1: worlds/sensitive-crosscutting-lot1.ts
  // sensitive-crosscutting, Lot 2: worlds/sensitive-crosscutting-lot2.ts
];

/** Every named scenario of every world, which `/api/test/seed` applies by name (TRV-76). */
export const scenarios: ReadonlyMap<string, Scenario> = new Map(
  WORLDS.flatMap((world) => Object.entries(world)),
);

// The steps that load the reference data before any scenario, the installation row and
// the nine proposals of data/seeds/: F-seed's slot, one line per step. Each step runs at
// every seed and leaves the reference data that it finds as it is.
const REFERENCE_DATA: readonly Scenario[] = [
  async (db) => {
    await seedCandidateTypes(db, now());
  },
];

/** Why `applyScenarios` wrote nothing: names that no world registers. */
export type SeedError = Readonly<{ kind: 'unknown_scenarios'; names: readonly string[] }>;

// The name of the transaction-level advisory lock that serializes the seeds of one
// database, whatever process or connection sends them.
const SEED_LOCK = 'egoscope.testing.seed';

/**
 * Applies the scenarios named, in the order given, each one after the one before it has
 * ended, after the reference data (TRV-76): what `/api/test/seed` does to the in-memory
 * database of the hermetic server, so that scenarios combine. A scenario named twice, or
 * already applied, leaves its rows as they are. The seed runs in one transaction that
 * takes the seed lock first, so that two seeds sent at once, by the desktop and the phone
 * projects say, run one after the other, and a scenario that throws leaves no row of the
 * seed behind. Writes nothing when a name is unknown, and names those. `registry` holds
 * the scenarios by name, those of every world unless a test gives its own.
 */
export async function applyScenarios(
  db: Database,
  names: readonly string[],
  registry: ReadonlyMap<string, Scenario> = scenarios,
): Promise<Result<readonly string[], SeedError>> {
  const unknown = names.filter((name) => !registry.has(name));
  if (unknown.length > 0) {
    return err({ kind: 'unknown_scenarios', names: unknown });
  }
  const named = names.map((name) => registry.get(name)).filter((step) => step !== undefined);
  // No transaction configuration: the driver sends a bare BEGIN, and the lock is the
  // transaction's own, so nothing here sets the session.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${SEED_LOCK}))`);
    for (const step of [...REFERENCE_DATA, ...named]) {
      await step(tx);
    }
  });
  return ok(names);
}
