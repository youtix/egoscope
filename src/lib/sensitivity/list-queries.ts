// The reads of the profile list, the verdict history, the historical-only values in force
// at an instant and the changes since an instant (module map, section 2.4).
import { and, asc, eq, gt, lte } from 'drizzle-orm';

import {
  cases,
  eventTypes,
  followedPlayers,
  generalTrends,
  profileValueVersions,
  sensitivityProfiles,
  verdictHistoryEntries,
} from '@/lib/db';
import { lastCalculationChange } from '@/lib/params';
import { expectedFalseSignals } from '@/lib/stats-engine';
import { toEpochMs } from '@/lib/time';

import { calculationValues, verdictOf } from './calculation-values';
import { paramsInForce } from './engine-params';

import type { CalculationValues } from './calculation-values';
import type { VerdictHistoryEntryRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { CalculationChange } from '@/lib/params';
import type {
  ExpectedFalseSignals,
  ProfileConfidence,
  ProfileView,
  Verdict,
  VerdictLevel,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

type Reader = Database | Transaction;

/** The filter of the profile list: a verdict level, a player, a type, each optional (IHM-49). */
export type ProfileFilter = Readonly<{
  verdict?: VerdictLevel;
  playerId?: string;
  eventTypeId?: string;
}>;

/** One line of the profile list: a pair's default-view profile, its player and type named, archived when either is withdrawn (SEN-19). */
export type ProfileLine = Readonly<{
  id: number;
  playerId: string;
  playerName: string;
  eventTypeId: string;
  typeName: string;
  values: CalculationValues;
  isArchived: boolean;
}>;

/**
 * The profile list (IHM-49, SEN-41, SEN-37, CL-SEN-20): the active filter, the total of
 * default-view profiles, the profiles that the filter keeps, the evaluated pairs and the
 * verdicts chance alone would produce among them, and the last change of a calculation
 * parameter.
 */
export type ProfileListing = Readonly<{
  filter: ProfileFilter;
  total: number;
  profiles: readonly ProfileLine[];
  expectedFalseSignals: ExpectedFalseSignals;
  lastCalculationChange: CalculationChange | null;
}>;

/** Whether `line` passes every part of `filter` that is set. */
function isKept(line: ProfileLine, filter: ProfileFilter): boolean {
  return (
    (filter.verdict === undefined || line.values.verdict.level === filter.verdict) &&
    (filter.playerId === undefined || line.playerId === filter.playerId) &&
    (filter.eventTypeId === undefined || line.eventTypeId === filter.eventTypeId)
  );
}

/**
 * The default-view profiles, by player name then type name, that `filter` keeps, with the
 * active filter and the total of profiles, so that no screen shows only the favorable ones
 * (IHM-49); the evaluated pairs, every pair, archived ones included, whose profile reaches
 * the valid-case threshold in force, and the verdicts chance alone would produce among
 * them under the signal-to-noise thresholds in force (SEN-41, CL-SEN-20, ADR 0021); and the
 * last change of a calculation parameter (SEN-37).
 */
export async function listProfiles(
  db: Reader,
  filter: ProfileFilter = {},
): Promise<ProfileListing> {
  const rows = await db
    .select({
      profile: sensitivityProfiles,
      playerName: followedPlayers.displayName,
      playerStatus: followedPlayers.status,
      typeName: eventTypes.name,
      typeStatus: eventTypes.status,
    })
    .from(sensitivityProfiles)
    .innerJoin(followedPlayers, eq(followedPlayers.id, sensitivityProfiles.playerId))
    .innerJoin(eventTypes, eq(eventTypes.id, sensitivityProfiles.eventTypeId))
    .where(eq(sensitivityProfiles.view, 'all_cases'))
    .orderBy(asc(followedPlayers.displayName), asc(eventTypes.name), asc(sensitivityProfiles.id));
  const lines = rows.map(({ profile, playerName, playerStatus, typeName, typeStatus }) => ({
    id: profile.id,
    playerId: profile.playerId,
    playerName,
    eventTypeId: profile.eventTypeId,
    typeName,
    values: calculationValues(profile),
    isArchived: playerStatus === 'withdrawn' || typeStatus === 'withdrawn',
  }));
  const params = await paramsInForce(db);
  const evaluated = lines.filter(
    ({ values }) => values.tally.validCount >= params.sensitivity.minValidCases,
  );
  return {
    filter,
    total: lines.length,
    profiles: lines.filter((line) => isKept(line, filter)),
    expectedFalseSignals: expectedFalseSignals(evaluated.length, params),
    lastCalculationChange: await lastCalculationChange(db),
  };
}

/** A verdict and a profile confidence, before or after a change (SEN-37). */
export type VerdictAndConfidence = Readonly<{
  verdict: Verdict;
  profileConfidence: ProfileConfidence;
}>;

/** One change of a default-view profile's or trend's verdict or confidence, with its cause (SEN-37, CL-SEN-17). */
export type VerdictChangeEntry = Readonly<{
  changedAt: EpochMs;
  from: VerdictAndConfidence;
  to: VerdictAndConfidence;
  cause: VerdictHistoryEntryRow['cause'];
}>;

/** A profile, or a trend, by its identifier. */
export type HistorySubject = Readonly<{ profileId: number }> | Readonly<{ trendId: number }>;

/**
 * The verdict history of a default-view profile or trend, oldest change first (SEN-37,
 * CL-SEN-18, CL-SEN-19, CL-SEN-20): each change of verdict level, direction or profile
 * confidence with its cause.
 */
export async function verdictHistory(
  db: Reader,
  subject: HistorySubject,
): Promise<readonly VerdictChangeEntry[]> {
  const rows = await db
    .select()
    .from(verdictHistoryEntries)
    .where(
      'profileId' in subject
        ? eq(verdictHistoryEntries.sensitivityProfileId, subject.profileId)
        : eq(verdictHistoryEntries.generalTrendId, subject.trendId),
    )
    .orderBy(asc(verdictHistoryEntries.changedAt), asc(verdictHistoryEntries.id));
  return rows.map((row) => ({
    changedAt: toEpochMs(row.changedAt.getTime()),
    from: {
      verdict: verdictOf(row.oldVerdictLevel, row.oldVerdictDirection),
      profileConfidence: row.oldProfileConfidence,
    },
    to: {
      verdict: verdictOf(row.newVerdictLevel, row.newVerdictDirection),
      profileConfidence: row.newProfileConfidence,
    },
    cause: row.cause,
  }));
}

/** The values of a historical-only profile or trend from an instant on (SUI-08, SUI-09). */
export type ProfileValueVersion = Readonly<{
  effectiveAt: EpochMs;
  validCount: number;
  meanGap: number | null;
  verdict: Verdict;
  profileConfidence: ProfileConfidence;
}>;

/**
 * The versions of the historical-only values of a player's profile of a type, or of the
 * type's trend when no player is named, effective at `instant` or before, oldest first:
 * the last is the one in force at that instant, none before the first (SUI-08, SUI-09,
 * CL-SEN-19, CL-SUI-03), which Lot 2 tracking reads to build its forecasts.
 */
export async function profileValueVersionsUntil(
  db: Reader,
  subject: Readonly<{ playerId?: string; eventTypeId: string }>,
  instant: EpochMs,
): Promise<readonly ProfileValueVersion[]> {
  const historical = 'historical_only' satisfies ProfileView;
  const until = lte(profileValueVersions.effectiveAt, new Date(instant));
  const ofSubject =
    subject.playerId === undefined
      ? and(eq(generalTrends.eventTypeId, subject.eventTypeId), eq(generalTrends.view, historical))
      : and(
          eq(sensitivityProfiles.playerId, subject.playerId),
          eq(sensitivityProfiles.eventTypeId, subject.eventTypeId),
          eq(sensitivityProfiles.view, historical),
        );
  const rows = await db
    .select({ version: profileValueVersions })
    .from(profileValueVersions)
    .leftJoin(
      sensitivityProfiles,
      eq(sensitivityProfiles.id, profileValueVersions.sensitivityProfileId),
    )
    .leftJoin(generalTrends, eq(generalTrends.id, profileValueVersions.generalTrendId))
    .where(and(until, ofSubject))
    .orderBy(asc(profileValueVersions.effectiveAt), asc(profileValueVersions.id));
  return rows.map(({ version }) => ({
    effectiveAt: toEpochMs(version.effectiveAt.getTime()),
    validCount: version.validCount,
    meanGap: version.meanGap,
    verdict: verdictOf(version.verdictLevel, version.verdictDirection),
    profileConfidence: version.profileConfidence,
  }));
}

/** A case or a profile that a recalculation wrote, by identifier, with its player and type. */
export type ChangedItem = Readonly<{ id: number; playerId: string; eventTypeId: string }>;

/** The cases and the profiles, of every view, computed after an instant. */
export type ChangedSince = Readonly<{
  cases: readonly ChangedItem[];
  profiles: readonly (ChangedItem & Readonly<{ view: ProfileView }>)[];
}>;

/**
 * The cases and the profiles that a recalculation wrote after `instant`, by identifier
 * (SEN-34, SEN-36, CL-SEN-16): every case and profile is written whole with its
 * calculation instant, so those computed later are those that changed since.
 */
export async function changedSince(db: Reader, instant: EpochMs): Promise<ChangedSince> {
  const after = new Date(instant);
  const changedCases = await db
    .select({ id: cases.id, playerId: cases.playerId, eventTypeId: cases.eventTypeId })
    .from(cases)
    .where(gt(cases.computedAt, after))
    .orderBy(asc(cases.id));
  const profiles = await db
    .select({
      id: sensitivityProfiles.id,
      playerId: sensitivityProfiles.playerId,
      eventTypeId: sensitivityProfiles.eventTypeId,
      view: sensitivityProfiles.view,
    })
    .from(sensitivityProfiles)
    .where(gt(sensitivityProfiles.computedAt, after))
    .orderBy(asc(sensitivityProfiles.id));
  return { cases: changedCases, profiles };
}
