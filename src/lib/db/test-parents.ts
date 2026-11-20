import 'server-only';

import { sql } from 'drizzle-orm';

import { backtestRequests, imports } from './schema/backtests';
import { events } from './schema/events';
import { games, seasons, teams } from './schema/games';
import { parameterSnapshots } from './schema/params';
import { followedPlayers } from './schema/players';
import { cases } from './schema/sensitivity';
import { eventTypes } from './schema/taxonomy';
import { typeSheetVersions } from './schema/taxonomy-sheets';

import type { Database } from './types';

/**
 * The identifiers of the rows that `insertParents` writes into a test's own database,
 * whose identity columns all start at 1; a followed player's identifier is a random
 * UUID (CL-JOU-09), written here.
 */
export const PARENTS = {
  playerId: '5b0d2f8e-3c41-4f6a-9d7e-2a1c8b9e4f60',
  otherPlayerId: 'c3a91f07-6d2e-4b85-8f14-0e7d5a2b9c36',
  gameId: 1,
  requestId: 1,
  importId: 1,
  eventId: 1,
  caseId: 1,
  parameterSnapshotId: 1,
} as const;

// The instant of every parent row, which no test built on them reads.
const NOW = sql`now()`;
// The items of a sheet that a validated type has complete (TAX-01).
const SHEET = {
  origin: 'scoping',
  status: 'validated',
  currentVersionNumber: 1,
  definition: 'Wide coverage of one player in a short time.',
  inclusionCriteria: 'Three outlets within two days.',
  exclusionCriteria: 'The routine coverage of a game.',
  datingRule: 'The day of the first article.',
  genericExample: 'A player leads every sports page for two days.',
  documentationDifficulty: 'medium',
} as const;
// Two research types and the birthday type, each validated under its first version.
const TYPES = [
  { ...SHEET, id: 'media-storm', name: 'Media storm' },
  { ...SHEET, id: 'bereavement', name: 'Death of a loved one' },
  {
    ...SHEET,
    id: 'birthday',
    name: "Player's birthday",
    knownInAdvance: true,
    calendarDerivation: 'birthday',
  },
] as const;
/** A scheduled game of the regular season between two invented teams. */
export const SCHEDULED_GAME = {
  statsSource: 'sportsdataverse_espn',
  sourceGameRef: '401700001',
  season: '2024-25',
  phase: 'regular_season',
  status: 'scheduled',
  scheduledStartAt: NOW,
  gameDayOn: '2025-01-14',
  homeTeamId: 1,
  awayTeamId: 2,
  lastFetchedAt: NOW,
  scheduleChangedAt: NOW,
} as const;
// Two invented followed players.
const PLAYERS = [
  {
    id: PARENTS.playerId,
    displayName: 'Tobin Marlowe',
    displayNameNormalized: 'tobin marlowe',
  },
  {
    id: PARENTS.otherPlayerId,
    displayName: 'Emeric Holloway',
    displayNameNormalized: 'emeric holloway',
  },
] as const;
// A first request to do for the first player, whose prompt was produced.
const REQUEST = {
  reference: 'REQ-2026-0001',
  playerId: PARENTS.playerId,
  kind: 'initial',
  trigger: 'manual_action',
  createdOn: '2026-11-02',
  promptText: 'Research the public events of the player.',
  promptProducedAt: NOW,
} as const;
// The first import of that request.
const IMPORT = {
  sequenceNumber: 1,
  backtestRequestId: PARENTS.requestId,
  playerId: PARENTS.playerId,
  mode: 'first_import',
} as const;
/** A detected media storm of the first player, dated by its earliest source. */
export const DETECTED_EVENT = {
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  sheetEventTypeId: 'media-storm',
  sheetVersionNumber: 1,
  origin: 'detected',
  referenceAt: NOW,
  referenceDatePrecision: 'exact',
  description: 'Every outlet covered the player on the same day.',
  detectedStatus: 'detected',
  referenceDateRule: 'earliest_source',
  classificationOrigin: 'model',
} as const;
// The tracked case of that event, which waits for its game.
const PENDING_CASE = {
  playerId: PARENTS.playerId,
  eventTypeId: 'media-storm',
  origin: 'tracked',
  status: 'awaiting_game',
  statusReason: 'game_not_played_yet',
  referenceInstantAt: NOW,
  referenceInstantOrigin: 'known_instant',
} as const;

// The valid-case threshold in force at a calculation (sensitivity.minValidCases).
const VALID_CASE_THRESHOLD = 5;

/**
 * The calculation of an empty tally under the first parameter snapshot: every count 0
 * and the verdicts inconclusive, as a player without a recorded birthday has it on the
 * birthday profile (CL-SEN-26).
 */
export const EMPTY_CALCULATION = {
  eventCount: 0,
  caseCount: 0,
  groupedEventCount: 0,
  awaitingCount: 0,
  validCount: 0,
  excludedCount: 0,
  manuallyExcludedCount: 0,
  notMeasurableCount: 0,
  coOccurringCount: 0,
  provisionalGapCount: 0,
  historicalValidCount: 0,
  trackedValidCount: 0,
  tallyReasons: {},
  exitCounts: {},
  lowResearchConfidenceCount: 0,
  aboveZeroCount: 0,
  belowZeroCount: 0,
  verdictLevel: 'inconclusive',
  isFragile: false,
  profileConfidence: 'low',
  controlCaseCount: 0,
  controlVerdictLevel: 'inconclusive',
  dependsOnManualExclusions: false,
  validCaseThreshold: VALID_CASE_THRESHOLD,
  parameterSnapshotId: 1,
  computedAt: NOW,
} as const;

/**
 * Writes into a test's own database the rows that the tables of the events, backtests,
 * imports, sensitivity and calendar-events modules reference, under the identifiers
 * of `PARENTS`: two invented followed players, two validated research types and the
 * birthday type with their first sheet versions, a final game between two invented
 * teams, a request to do for the first player with its first import, a detected event
 * of his with the case that waits for its game, and a snapshot of parameter values,
 * so that each test of the schema proves the model's rules on rows of its own
 * (TRV-76).
 */
export async function insertParents(db: Database): Promise<void> {
  await db
    .insert(seasons)
    .values({ season: SCHEDULED_GAME.season, statsSource: SCHEDULED_GAME.statsSource });
  await db.insert(teams).values([
    { abbreviation: 'NPG', name: 'Northport Gulls' },
    { abbreviation: 'RWF', name: 'Redwater Foxes' },
  ]);
  await db.insert(games).values(SCHEDULED_GAME);
  await db.insert(followedPlayers).values([...PLAYERS]);
  await db.insert(eventTypes).values([...TYPES]);
  await db
    .insert(typeSheetVersions)
    .values(
      TYPES.map(
        ({ id }) =>
          ({ eventTypeId: id, versionNumber: 1, kind: 'validation', content: {} }) as const,
      ),
    );
  await db.insert(backtestRequests).values(REQUEST);
  await db.insert(imports).values(IMPORT);
  await db.insert(events).values(DETECTED_EVENT);
  await db.insert(cases).values(PENDING_CASE);
  await db.insert(parameterSnapshots).values({ values: {}, valuesHash: 'parameters-1' });
}
