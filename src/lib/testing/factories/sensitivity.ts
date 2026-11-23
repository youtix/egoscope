import { cases } from '@/lib/db';
import { now } from '@/lib/time';

import { firstRow } from '../rows';
import { MEDIA_STORM } from './taxonomy';

import type { Database } from '@/lib/db';

/** A case as the database holds it. */
export type CaseRow = typeof cases.$inferSelect;

/** What `insertValidCase` takes: the player, the game measured, and the columns to write otherwise. */
export type CaseFactoryOptions = Readonly<{
  playerId: string;
  measuredGameId: number;
  overrides?: Partial<typeof cases.$inferInsert>;
}>;

// The measurement of a valid case: 34 minutes played, above the threshold of 12, and a
// game score of 12.4, his performance index, against a final baseline of 40 games of the
// regular season, of mean 10.2 and standard deviation 3.1; its normalized gap final,
// (12.4 - 10.2) / 3.1.
const PLAYING_TIME_THRESHOLD_MINUTES = 12;
const MEASURED_MINUTES = 34;
const GAME_SCORE = 12.4;
const BASELINE_GAME_COUNT = 40;
const BASELINE_MEAN = 10.2;
const BASELINE_STANDARD_DEVIATION = 3.1;
const NORMALIZED_GAP = 0.7096774193548387;
const MEASUREMENT = {
  playingTimeThresholdMinutes: PLAYING_TIME_THRESHOLD_MINUTES,
  measuredMinutes: MEASURED_MINUTES,
  hasRoundedMinutes: true,
  measuredGameScore: GAME_SCORE,
  performanceIndex: GAME_SCORE,
  baselineSeason: '2024-25',
  baselinePhase: 'regular_season',
  baselineGameCount: BASELINE_GAME_COUNT,
  baselineMean: BASELINE_MEAN,
  baselineStandardDeviation: BASELINE_STANDARD_DEVIATION,
  baselineStatus: 'final',
  baselineIsPartial: false,
  normalizedGap: NORMALIZED_GAP,
  gapStatus: 'final',
} as const;

/**
 * Writes a valid case of the player (TRV-76): a historical media storm known by its
 * day, measured at `measuredGameId` with no doubtful-case criterion met, its normalized
 * gap final. `overrides` replaces any column, the type and the measurement included.
 */
export async function insertValidCase(
  db: Database,
  { playerId, measuredGameId, overrides = {} }: CaseFactoryOptions,
): Promise<CaseRow> {
  const at = new Date(now());
  const rows = await db
    .insert(cases)
    .values({
      playerId,
      eventTypeId: MEDIA_STORM,
      origin: 'historical',
      status: 'measured',
      referenceInstantAt: at,
      referenceInstantOrigin: 'date_only',
      measuredGameId,
      ...MEASUREMENT,
      computedAt: at,
      ...overrides,
    })
    .returning();
  return firstRow(rows, 'the case written');
}
