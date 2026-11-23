import { asc, eq } from 'drizzle-orm';

import { boxScores, games } from '@/lib/db';
import { err, ok } from '@/lib/result';
import { gameDay, now, toEpochMs } from '@/lib/time';

import { insertImport, insertRequest } from './factories/backtests';
import { insertHistoricalEvent } from './factories/events';
import { insertBoxScores, insertLeagueSeason } from './factories/games';
import { insertPlayer } from './factories/players';
import { insertValidCase } from './factories/sensitivity';
import { insertCalendarType, insertEventType } from './factories/taxonomy';

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

/**
 * A profiled player with seven valid cases of one type (SEN-07): the first invented
 * player, his request of June 2025 imported over the media storm, and seven historical
 * media storms, each published the day before one of his first seven games of 2024-25
 * and measured at it, with the season's games and his box scores as the source serves
 * them.
 */
export async function profiledPlayer(db: Database): Promise<ProfiledPlayer> {
  await insertEventType(db);
  await insertLeagueSeason(db, MEASURED_SEASON);
  const player = await insertPlayer(db, { source: 'p01' });
  await insertBoxScores(db, { playerId: player.id, source: 'p01', season: MEASURED_SEASON });
  const request = await insertRequest(db, {
    playerId: player.id,
    overrides: { createdOn: '2025-06-02' },
  });
  const imported = await insertImport(db, { request });
  const measured = await db
    .select({ id: games.id, tipOff: games.scheduledStartAt })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(eq(boxScores.playerId, player.id))
    .orderBy(asc(games.scheduledStartAt))
    .limit(VALID_CASES);
  const cases: CaseRow[] = [];
  const events: EventRow[] = [];
  for (const game of measured) {
    const publishedAt = toEpochMs(game.tipOff.getTime() - DAY_MS);
    const measuredCase = await insertValidCase(db, {
      playerId: player.id,
      measuredGameId: game.id,
      overrides: { referenceInstantAt: new Date(publishedAt) },
    });
    cases.push(measuredCase);
    events.push(
      await insertHistoricalEvent(db, {
        playerId: player.id,
        originImportId: imported.id,
        overrides: { referenceDateOn: gameDay(publishedAt), caseId: measuredCase.id },
      }),
    );
  }
  return { player, request, imported, cases, events };
}

/**
 * A request to do whose prompt was copied (TRV-76): the ninth invented player followed,
 * his initial request asking the media storm, its prompt copied now.
 */
export async function requestToDo(
  db: Database,
): Promise<Readonly<{ player: PlayerRow; request: RequestRow }>> {
  await insertEventType(db);
  const player = await insertPlayer(db, { source: 'p09' });
  const request = await insertRequest(db, {
    playerId: player.id,
    overrides: { lastCopiedAt: new Date(now()) },
  });
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
const REFERENCE_DATA: readonly Scenario[] = [];

/** Why `applyScenarios` wrote nothing: names that no world registers. */
export type SeedError = Readonly<{ kind: 'unknown_scenarios'; names: readonly string[] }>;

/**
 * Applies the scenarios named, in the order given, after the reference data (TRV-76):
 * what `/api/test/seed` does to the in-memory database of the hermetic server, so that
 * scenarios combine. Writes nothing when a name is unknown, and names those.
 */
export async function applyScenarios(
  db: Database,
  names: readonly string[],
): Promise<Result<readonly string[], SeedError>> {
  const unknown = names.filter((name) => !scenarios.has(name));
  if (unknown.length > 0) {
    return err({ kind: 'unknown_scenarios', names: unknown });
  }
  const named = names.map((name) => scenarios.get(name)).filter((step) => step !== undefined);
  for (const step of [...REFERENCE_DATA, ...named]) {
    await step(db);
  }
  return ok(names);
}
