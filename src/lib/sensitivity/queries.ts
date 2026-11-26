// The reads of the profiles and trends for the screens (module map, section 2.4): a
// pair's profile and a type's trend with what is derived from them on read, the filtered
// profile list with the verdicts chance alone would produce, the verdict history and
// the historical-only values in force at an instant.
import { and, countDistinct, eq } from 'drizzle-orm';

import {
  cases,
  events,
  eventTypes,
  followedPlayers,
  games,
  generalTrends,
  parameterSnapshots,
  playerIndicators,
  sensitivityProfiles,
} from '@/lib/db';
import { lastCalculationChange } from '@/lib/params';

import {
  calculationValues,
  casesWithoutWhichVerdictChanges,
  isAllExcludedForUnusualStakes,
  noticesOf,
  originOfView,
  switchWarnings,
} from './calculation-values';
import { calendarWarnings, firstCoveredSeason } from './calendar-warnings';
import { isProfileRecalculating } from './profile-recalculation';
import { isRecalculating } from './recalculate';

import type {
  CalculationValues,
  ProfileNotice,
  ProfileWarning,
  SwitchableCriterion,
} from './calculation-values';
import type { CalendarFacts } from './calendar-warnings';
import type { Database, Transaction } from '@/lib/db';
import type { CalculationChange } from '@/lib/params';
import type { CaseId, ProfileView } from '@/lib/stats-engine';

type Reader = Database | Transaction;

/** A player's profile of a type in one view, the default view, all cases, unless another is named (SEN-19, SEN-21). */
export type ProfileKey = Readonly<{ playerId: string; eventTypeId: string; view?: ProfileView }>;

/**
 * A type's general trend in one view (SEN-28 to SEN-30): its stored values, its players
 * with a valid case and the valid cases of the one who brings the most, its cases on an
 * earlier sheet version, counted on read over every player (SEN-46, CL-TAX-07), its
 * notices and its warning of a switched-off criterion.
 */
export type TrendSummary = Readonly<{
  id: number;
  eventTypeId: string;
  values: CalculationValues;
  distinctPlayerCount: number;
  topContributorValidCount: number;
  earlierVersionCaseCount: number;
  notices: readonly ProfileNotice[];
  warnings: readonly ProfileWarning[];
}>;

/** A trend with the cases without which its fragile verdict changes and the last change of a calculation parameter (SEN-26, SEN-37). */
export type TrendDetail = TrendSummary &
  Readonly<{
    casesWithoutWhichVerdictChanges: readonly CaseId[];
    lastCalculationChange: CalculationChange | null;
  }>;

/**
 * A player's profile of a type in one view (SEN-19 to SEN-27, SEN-31, SEN-33, SEN-38,
 * IHM-24): its stored values, its cases on an earlier sheet version counted on read
 * (SEN-46, CL-TAX-07), the cases without which its fragile verdict changes (SEN-26), its
 * notices and warnings, the type's trend in the same view, and the last change of a
 * calculation parameter (SEN-37, CL-IHM-12).
 */
export type ProfileDetail = Readonly<{
  id: number;
  playerId: string;
  eventTypeId: string;
  values: CalculationValues;
  earlierVersionCaseCount: number;
  casesWithoutWhichVerdictChanges: readonly CaseId[];
  notices: readonly ProfileNotice[];
  warnings: readonly ProfileWarning[];
  trend: TrendSummary | null;
  lastCalculationChange: CalculationChange | null;
}>;

// The nil uuid, which no followed player has: asked for it, isRecalculating answers for
// the trend alone.
const NO_PLAYER = '00000000-0000-0000-0000-000000000000';
const DEFAULT_VIEW: ProfileView = 'all_cases';

/** Its cases holding an event of an earlier sheet version, marked to requalify (SEN-46, TAX-25, CL-TAX-07). */
async function earlierVersionCaseCount(
  db: Reader,
  subject: Readonly<{ playerId: string | null; eventTypeId: string; view: ProfileView }>,
): Promise<number> {
  const origin = originOfView(subject.view);
  const counted = await db
    .select({ count: countDistinct(cases.id) })
    .from(cases)
    .innerJoin(events, eq(events.caseId, cases.id))
    .where(
      and(
        eq(cases.eventTypeId, subject.eventTypeId),
        eq(events.typeLinkMark, 'to_requalify'),
        subject.playerId === null ? undefined : eq(cases.playerId, subject.playerId),
        origin === null ? undefined : eq(cases.origin, origin),
      ),
    );
  return counted.reduce((total, { count }) => total + count, 0);
}

/** The trend of a type in a view, with the values of its parameter snapshot, or null. */
async function trendOf(db: Reader, eventTypeId: string, view: ProfileView) {
  const [found] = await db
    .select({
      trend: generalTrends,
      snapshotValues: parameterSnapshots.values,
      typeStatus: eventTypes.status,
      switchedOffCriterion: eventTypes.switchedOffCriterion,
    })
    .from(generalTrends)
    .innerJoin(parameterSnapshots, eq(parameterSnapshots.id, generalTrends.parameterSnapshotId))
    .innerJoin(eventTypes, eq(eventTypes.id, generalTrends.eventTypeId))
    .where(and(eq(generalTrends.eventTypeId, eventTypeId), eq(generalTrends.view, view)));
  if (found === undefined) {
    return null;
  }
  const values = calculationValues(found.trend);
  const summary: TrendSummary = {
    id: found.trend.id,
    eventTypeId,
    values,
    distinctPlayerCount: found.trend.distinctPlayerCount,
    topContributorValidCount: found.trend.topContributorValidCount,
    earlierVersionCaseCount: await earlierVersionCaseCount(db, {
      playerId: null,
      eventTypeId,
      view,
    }),
    notices: noticesOf(values, {
      isArchived: found.typeStatus === 'withdrawn',
      isRecalculating: await isRecalculating(db, NO_PLAYER, eventTypeId),
    }),
    warnings: switchWarnings(found.switchedOffCriterion),
  };
  return { summary, snapshotValues: found.snapshotValues };
}

/**
 * A type's general trend in one view, the default one unless another is named, or null
 * when the type has none (SEN-28 to SEN-30, SEN-26, SEN-38, SEN-46, CL-SEN-13, CL-TAX-07):
 * its values, its notices, its warning of a switched-off criterion, its cases on an
 * earlier sheet version, the cases without which its fragile verdict changes, and the
 * last change of a calculation parameter.
 */
export async function getTrend(
  db: Reader,
  { eventTypeId, view = DEFAULT_VIEW }: Readonly<{ eventTypeId: string; view?: ProfileView }>,
): Promise<TrendDetail | null> {
  const found = await trendOf(db, eventTypeId, view);
  if (found === null) {
    return null;
  }
  return {
    ...found.summary,
    casesWithoutWhichVerdictChanges: await casesWithoutWhichVerdictChanges(
      db,
      { playerId: null, eventTypeId },
      { values: found.summary.values, snapshotValues: found.snapshotValues },
    ),
    lastCalculationChange: await lastCalculationChange(db),
  };
}

/** The warnings of a profile: the switched-off criterion, all excluded for unusual stakes, and the calendar-derived ones. */
function profileWarnings(
  values: CalculationValues,
  facts: CalendarFacts & Readonly<{ switchedOffCriterion: SwitchableCriterion | null }>,
): readonly ProfileWarning[] {
  const unusualStakes: ProfileWarning[] = isAllExcludedForUnusualStakes(
    values,
    facts.switchedOffCriterion,
  )
    ? [{ kind: 'all_excluded_for_unusual_stakes' }]
    : [];
  return [
    ...switchWarnings(facts.switchedOffCriterion),
    ...unusualStakes,
    ...calendarWarnings(facts),
  ];
}

/** A player's profile row with the facts its notices and warnings read, or undefined. */
async function profileRowOf(db: Reader, key: Required<ProfileKey>) {
  const [found] = await db
    .select({
      profile: sensitivityProfiles,
      snapshotValues: parameterSnapshots.values,
      typeStatus: eventTypes.status,
      calendarDerivation: eventTypes.calendarDerivation,
      switchedOffCriterion: eventTypes.switchedOffCriterion,
      playerStatus: followedPlayers.status,
      birthdayMonth: followedPlayers.birthdayMonth,
      firstNbaSeason: games.season,
    })
    .from(sensitivityProfiles)
    .innerJoin(
      parameterSnapshots,
      eq(parameterSnapshots.id, sensitivityProfiles.parameterSnapshotId),
    )
    .innerJoin(eventTypes, eq(eventTypes.id, sensitivityProfiles.eventTypeId))
    .innerJoin(followedPlayers, eq(followedPlayers.id, sensitivityProfiles.playerId))
    .leftJoin(playerIndicators, eq(playerIndicators.playerId, sensitivityProfiles.playerId))
    .leftJoin(games, eq(games.id, playerIndicators.firstNbaGameId))
    .where(
      and(
        eq(sensitivityProfiles.playerId, key.playerId),
        eq(sensitivityProfiles.eventTypeId, key.eventTypeId),
        eq(sensitivityProfiles.view, key.view),
      ),
    );
  return found;
}

/**
 * A player's profile of a type in one view, the default one unless another is named, or
 * null when he has none (SEN-19 to SEN-27, SEN-31, SEN-33, SEN-36, SEN-38, SEN-46,
 * IHM-24, ADR 0016, CL-SEN-13, CL-STA-24, CL-JOU-16, CL-JOU-18, CL-TAX-07): its values;
 * its notices — below threshold, archived when the player or the type is withdrawn,
 * recalculating, awaiting statistics —; its warnings; its cases on an earlier sheet
 * version; the cases without which its fragile verdict changes; the type's trend in the
 * same view; and the last change of a calculation parameter.
 */
export async function getProfile(db: Reader, key: ProfileKey): Promise<ProfileDetail | null> {
  const { playerId, eventTypeId, view = DEFAULT_VIEW } = key;
  const found = await profileRowOf(db, { playerId, eventTypeId, view });
  if (found === undefined) {
    return null;
  }
  const values = calculationValues(found.profile);
  const subject = { playerId, eventTypeId };
  const trend = await trendOf(db, eventTypeId, view);
  return {
    id: found.profile.id,
    ...subject,
    values,
    earlierVersionCaseCount: await earlierVersionCaseCount(db, { ...subject, view }),
    casesWithoutWhichVerdictChanges: await casesWithoutWhichVerdictChanges(db, subject, {
      values,
      snapshotValues: found.snapshotValues,
    }),
    notices: noticesOf(values, {
      isArchived: found.typeStatus === 'withdrawn' || found.playerStatus === 'withdrawn',
      isRecalculating: await isProfileRecalculating(db, subject),
    }),
    warnings: profileWarnings(values, {
      ...found,
      firstCoveredSeason: found.calendarDerivation === null ? null : await firstCoveredSeason(db),
    }),
    trend: trend?.summary ?? null,
    lastCalculationChange: await lastCalculationChange(db),
  };
}
