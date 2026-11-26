// The stored cases of a profile or a trend as the engine counts them, and the values it
// computes from them, which the profile factories write (SEN-19 to SEN-30).
import { and, asc, eq, inArray } from 'drizzle-orm';

import { cases, caseTriggeredCriteria, events, games } from '@/lib/db';
import {
  generalTrend,
  profileChecks,
  profileConfidence,
  profileVerdict,
  runRobustnessTest,
  tallyProfile,
} from '@/lib/stats-engine';
import { toEpochMs } from '@/lib/time';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { firstRow, present } from '../rows';
import { MEDIA_STORM } from './taxonomy';

import type { Database } from '@/lib/db';
import type {
  EngineParams,
  GeneralTrendValues,
  ProfileCase,
  ProfileView,
  TallyExitReason,
  TrendCase,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

/** The values of a profile: those of a trend but its players' counts (SEN-20 to SEN-27). */
export type ProfileValues = Omit<
  GeneralTrendValues,
  'distinctPlayerCount' | 'topContributorValidCount'
>;

/**
 * What the profile factories compute from (SEN-19 to SEN-30): the stored cases of a type,
 * the media storm by default, in a view, all cases by default, only those of `caseIds`
 * when it is given; the reasons of the events that left the tally; the engine's
 * parameters, at their defaults unless given; and the instant of the calculation, now by
 * default.
 */
export type CalculationScope = Readonly<{
  eventTypeId?: string;
  view?: ProfileView;
  caseIds?: readonly number[];
  exits?: readonly TallyExitReason[];
  params?: EngineParams;
  computedAt?: EpochMs;
}>;

/** The engine's parameters at their default values, those of the parameter registry. */
export const DEFAULT_PARAMS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};
// The reasons of each status that has some, as the engine's cases name them (CL-SEN-05).
type AwaitingReason = Extract<ProfileCase, { status: 'awaiting_game' }>['statusReason'];
type NotMeasurableReason = Extract<ProfileCase, { status: 'not_measurable' }>['statusReason'];
const AWAITING_REASONS: readonly AwaitingReason[] = [
  'game_not_played_yet',
  'statistics_pending',
  'mapping_not_established',
  'baseline_building',
  'precedence_to_verify',
  'dating_to_verify',
];
const NOT_MEASURABLE_REASONS: readonly NotMeasurableReason[] = [
  'no_game_within_window',
  'box_score_incomplete',
  'box_score_suspect',
  'box_score_unavailable',
  'insufficient_baseline',
  'season_not_covered',
  'precedence_not_established',
  'derived_game_missed',
];
/** The origin of the cases of a view, none for the default one, which counts both (SEN-21). */
function originOf(view: ProfileView) {
  if (view === 'historical_only') {
    return 'historical';
  }
  return view === 'tracked_only' ? 'tracked' : undefined;
}

/** `value` as one of `values`, or a bug of the caller, which is thrown. */
function oneOf<V extends string>(value: string | null, values: readonly V[]): V {
  return firstRow(
    values.filter((item) => item === value),
    `one of ${values.join(', ')}`,
  );
}

type StoredCase = Readonly<{ row: typeof cases.$inferSelect; startsAt: Date | null }>;
type Related = Readonly<{ confidences: ProfileCase['events']; criteria: readonly string[] }>;

/** A stored case as the engine counts it, with its events' research confidence and its criteria (SEN-07, SEN-20). */
function profileCaseOf({ row, startsAt }: StoredCase, related: Related): TrendCase {
  const counted = {
    caseId: row.id,
    playerId: row.playerId,
    events: related.confidences,
    isCoOccurring: false,
  };
  if (row.status === 'awaiting_game') {
    const statusReason = oneOf(row.statusReason, AWAITING_REASONS);
    return { ...counted, status: row.status, statusReason };
  }
  if (row.status === 'not_measurable') {
    const statusReason = oneOf(row.statusReason, NOT_MEASURABLE_REASONS);
    return { ...counted, status: row.status, statusReason };
  }
  const gap = {
    measuredGameScheduledStartAt: toEpochMs(present(startsAt, 'its measured game').getTime()),
    normalizedGap: present(row.normalizedGap, 'its gap'),
    gapStatus: present(row.gapStatus, 'its gap status'),
  };
  if (row.status === 'measured') {
    return { ...counted, ...gap, status: row.status };
  }
  const known = caseTriggeredCriteria.criterion.enumValues;
  const criteria = related.criteria.map((criterion) => oneOf(criterion, known));
  const triggeredCriteria = [firstRow(criteria, 'a criterion'), ...criteria.slice(1)] as const;
  return { ...counted, ...gap, status: row.status, triggeredCriteria };
}

/**
 * The stored cases of a scope, a player's when one is named, as the engine counts them,
 * each with its events' research confidence and its criteria, none co-occurring; and how
 * many of the valid ones are historical (SEN-07, SEN-20, SEN-21).
 */
export async function casesOf(
  db: Database,
  scope: CalculationScope & Readonly<{ playerId?: string }>,
): Promise<Readonly<{ counted: readonly TrendCase[]; historicalValidCount: number }>> {
  const origin = originOf(scope.view ?? 'all_cases');
  const stored = await db
    .select({ row: cases, startsAt: games.scheduledStartAt })
    .from(cases)
    .leftJoin(games, eq(games.id, cases.measuredGameId))
    .where(
      and(
        eq(cases.eventTypeId, scope.eventTypeId ?? MEDIA_STORM),
        scope.playerId === undefined ? undefined : eq(cases.playerId, scope.playerId),
        origin === undefined ? undefined : eq(cases.origin, origin),
        scope.caseIds === undefined ? undefined : inArray(cases.id, [...scope.caseIds]),
      ),
    )
    .orderBy(asc(cases.id));
  const ids = stored.map(({ row }) => row.id);
  const confidences = await db
    .select({ caseId: events.caseId, researchConfidence: events.researchConfidence })
    .from(events)
    .where(inArray(events.caseId, ids))
    .orderBy(asc(events.id));
  const criteria = await db
    .select()
    .from(caseTriggeredCriteria)
    .where(inArray(caseTriggeredCriteria.caseId, ids));
  const counted = stored.map((item) => {
    const ofEvents = confidences.filter(({ caseId }) => caseId === item.row.id);
    const ofCase = criteria.filter(({ caseId }) => caseId === item.row.id);
    return profileCaseOf(item, {
      confidences: [firstRow(ofEvents, 'an event of the case'), ...ofEvents.slice(1)],
      criteria: ofCase.map(({ criterion }) => criterion),
    });
  });
  const historical = stored.filter(
    ({ row }) => row.status === 'measured' && row.origin === 'historical',
  );
  return { counted, historicalValidCount: historical.length };
}

/** A profile's values as the engine computes them from its cases, under the profile's rules, no manual decision ruling them (SEN-20 to SEN-27). */
export function profileValues(
  counted: readonly TrendCase[],
  exits: readonly TallyExitReason[],
  params: EngineParams,
): ProfileValues {
  const tally = tallyProfile(counted, exits);
  const verdictValues = profileVerdict(counted, params);
  const { isFragile } = runRobustnessTest(counted, verdictValues.verdict, params);
  const gapDispersion = verdictValues.quantities?.gapDispersion ?? null;
  return {
    tally,
    ...verdictValues,
    isFragile,
    ...profileConfidence({ ...tally, gapDispersion, isFragile }, params),
    ...profileChecks({ cases: counted, manuallyDecidedCases: [] }, params),
  };
}

/** A trend's values as the engine computes them from every player's cases, under the trend's rules (SEN-28 to SEN-30). */
export function trendValues(
  counted: readonly TrendCase[],
  exits: readonly TallyExitReason[],
  params: EngineParams,
): GeneralTrendValues {
  return generalTrend({ cases: counted, exitReasons: exits, manuallyDecidedCases: [] }, params);
}
