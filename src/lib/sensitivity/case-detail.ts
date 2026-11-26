// The read of one case's detail (module map, section 2.4; IHM-25): its events with their
// sources or derived game and their context indications, the calculation of its gap, its
// criteria with their values, its review flags, manual decisions and history.
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  events,
  eventSources,
  games,
} from '@/lib/db';
import { toEpochMs, toIsoDate } from '@/lib/time';

import { caseEventOf, casesWhere } from './case-queries';

import type { CaseEvent, CaseLine } from './case-queries';
import type {
  CaseHistoryEntryRow,
  CaseManualDecisionRow,
  CaseReviewFlagRow,
  CaseTriggeredCriterionRow,
} from './types';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs, IsoDate } from '@/lib/time';

type Reader = Database | Transaction;
type EventRow = typeof events.$inferSelect;

/** A source of an event with its link (VUE-04, IHM-25). */
export type CaseEventSource = Readonly<{
  url: string;
  outlet: string | null;
  title: string | null;
  publicationDateOn: IsoDate;
  linkStatus: (typeof eventSources.$inferSelect)['linkStatus'];
}>;

/**
 * An event of a case's detail (SEN-18, IHM-25, H-09, CL-VUE-15): its sources with their
 * links, or for a calendar-derived event the game it is derived from, which stands for
 * them; and its context indications, each with its origin.
 */
export type CaseEventDetail = CaseEvent &
  Readonly<{
    sources: readonly CaseEventSource[];
    derivedGame: Readonly<{ id: number; gameDay: IsoDate }> | null;
    injuryReturn: EventRow['injuryReturn'];
    injuryReturnOrigin: EventRow['injuryReturnOrigin'];
    gameStakes: EventRow['gameStakes'];
    gameStakesOrigin: EventRow['gameStakesOrigin'];
  }>;

/** A criterion retained on a case, `calculated` or `flagged` for the two that have a condition, with the values that triggered it (SEN-11 to SEN-18). */
export type CaseCriterion = Readonly<{
  criterion: CaseTriggeredCriterionRow['criterion'];
  condition: CaseTriggeredCriterionRow['condition'];
  triggeringValues: Readonly<Record<string, string | number | boolean | null>>;
}>;

/** A review flag on a case, raised on a game, acknowledged or not (SEN-16, SEN-17). */
export type CaseFlag = Readonly<{
  flag: CaseReviewFlagRow['flag'];
  measuredGameId: number;
  raisedAt: EpochMs;
  acknowledgedAt: EpochMs | null;
}>;

/** A manual decision on a case, with its closed-list reason and comment, bound to its game (SEN-17, CL-SEN-12). */
export type CaseDecisionItem = Readonly<{
  decidedAt: EpochMs;
  kind: CaseManualDecisionRow['kind'];
  exclusionReason: CaseManualDecisionRow['exclusionReason'];
  reinstatementReason: CaseManualDecisionRow['reinstatementReason'];
  comment: string | null;
  previousStatus: CaseManualDecisionRow['previousStatus'];
  measuredGameId: number;
}>;

/** A change of a case's status, measured game or gap, with its cause (SEN-07, SEN-08, SEN-37). */
export type CaseHistoryItem = Readonly<{
  recordedAt: EpochMs;
  status: CaseHistoryEntryRow['status'];
  statusReason: CaseHistoryEntryRow['statusReason'];
  measuredGameId: number | null;
  normalizedGap: number | null;
  gapStatus: CaseHistoryEntryRow['gapStatus'];
  cause: CaseHistoryEntryRow['cause'];
}>;

/**
 * A case's detail (SEN-18, SEN-40, IHM-25, STA-12): its line, with its events in detail;
 * the three numbers of its gap (the index, and the mean and standard deviation of the
 * baseline, in the line) with the measured game's Game Score and the rounded-minutes
 * mention; the playing-time threshold of its season and the team games missed before;
 * the notices that the opponent's level or the stakes could not be evaluated; its
 * criteria with their values; its review flags; its manual decisions; its history.
 */
export type CaseDetail = Omit<CaseLine, 'events' | 'criteria'> &
  Readonly<{
    events: readonly CaseEventDetail[];
    measuredGameScore: number | null;
    hasRoundedMinutes: boolean | null;
    playingTimeThresholdMinutes: number | null;
    teamGamesMissedBefore: number | null;
    opponentStrengthNotEvaluable: boolean;
    stakesNotEvaluable: boolean;
    criteria: readonly CaseCriterion[];
    reviewFlags: readonly CaseFlag[];
    decisions: readonly CaseDecisionItem[];
    history: readonly CaseHistoryItem[];
  }>;

const TRIGGERING_VALUES = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** The instant of a timestamp column. */
const at = (value: Date): EpochMs => toEpochMs(value.getTime());

/** The events of a case in detail, by id: their sources by position, and their derived game. */
async function eventDetails(db: Reader, caseId: number): Promise<CaseEventDetail[]> {
  const rows = await db
    .select({ event: events, derived: { id: games.id, gameDay: games.gameDayOn } })
    .from(events)
    .leftJoin(games, eq(games.id, events.derivedGameId))
    .where(eq(events.caseId, caseId))
    .orderBy(asc(events.id));
  const sources = await db
    .select()
    .from(eventSources)
    .innerJoin(events, eq(events.id, eventSources.playerEventId))
    .where(eq(events.caseId, caseId))
    .orderBy(asc(eventSources.position));
  return rows.map(({ event, derived }) => ({
    ...caseEventOf(event),
    sources: sources
      .filter((source) => source.event_sources.playerEventId === event.id)
      .map(({ event_sources: source }) => ({
        url: source.url,
        outlet: source.outlet,
        title: source.title,
        publicationDateOn: toIsoDate(source.publicationDateOn),
        linkStatus: source.linkStatus,
      })),
    derivedGame: derived === null ? null : { id: derived.id, gameDay: toIsoDate(derived.gameDay) },
    injuryReturn: event.injuryReturn,
    injuryReturnOrigin: event.injuryReturnOrigin,
    gameStakes: event.gameStakes,
    gameStakesOrigin: event.gameStakesOrigin,
  }));
}

/** The criteria of a case with their values, its flags, decisions and history, each oldest first. */
async function caseRecords(db: Reader, caseId: number) {
  const criteria = await db
    .select()
    .from(caseTriggeredCriteria)
    .where(eq(caseTriggeredCriteria.caseId, caseId))
    .orderBy(asc(caseTriggeredCriteria.id));
  const flags = await db
    .select()
    .from(caseReviewFlags)
    .where(eq(caseReviewFlags.caseId, caseId))
    .orderBy(asc(caseReviewFlags.raisedAt), asc(caseReviewFlags.id));
  const decisions = await db
    .select()
    .from(caseManualDecisions)
    .where(eq(caseManualDecisions.caseId, caseId))
    .orderBy(asc(caseManualDecisions.decidedAt), asc(caseManualDecisions.id));
  const history = await db
    .select()
    .from(caseHistoryEntries)
    .where(eq(caseHistoryEntries.caseId, caseId))
    .orderBy(asc(caseHistoryEntries.recordedAt), asc(caseHistoryEntries.id));
  return {
    criteria: criteria.map(({ criterion, condition, triggeringValues }) => ({
      criterion,
      condition,
      triggeringValues: TRIGGERING_VALUES.parse(triggeringValues),
    })),
    reviewFlags: flags.map(({ flag, measuredGameId, raisedAt, acknowledgedAt }) => ({
      flag,
      measuredGameId,
      raisedAt: at(raisedAt),
      acknowledgedAt: acknowledgedAt === null ? null : at(acknowledgedAt),
    })),
    decisions: decisions.map((decision) => ({
      decidedAt: at(decision.decidedAt),
      kind: decision.kind,
      exclusionReason: decision.exclusionReason,
      reinstatementReason: decision.reinstatementReason,
      comment: decision.comment,
      previousStatus: decision.previousStatus,
      measuredGameId: decision.measuredGameId,
    })),
    history: history.map((entry) => ({
      recordedAt: at(entry.recordedAt),
      status: entry.status,
      statusReason: entry.statusReason,
      measuredGameId: entry.measuredGameId,
      normalizedGap: entry.normalizedGap,
      gapStatus: entry.gapStatus,
      cause: entry.cause,
    })),
  };
}

/**
 * One case's detail, or null when there is none (SEN-07, SEN-11 to SEN-18, SEN-40,
 * IHM-25, CL-VUE-15): what its line shows, its events with their sources or derived game
 * and their context indications with their origin, the calculation of its gap, its
 * minutes with the rounded-minutes mention, its criteria with their triggering values
 * and condition (the `calculated` origin of an indication), its review flags, its manual
 * decisions and the history of its status, game and gap.
 */
export async function getCase(db: Reader, caseId: number): Promise<CaseDetail | null> {
  const [found] = await casesWhere(db, eq(cases.id, caseId));
  if (found === undefined) {
    return null;
  }
  const { stored, line } = found;
  return {
    ...line,
    events: await eventDetails(db, caseId),
    measuredGameScore: stored.measuredGameScore,
    hasRoundedMinutes: stored.hasRoundedMinutes,
    playingTimeThresholdMinutes: stored.playingTimeThresholdMinutes,
    teamGamesMissedBefore: stored.teamGamesMissedBefore,
    opponentStrengthNotEvaluable: stored.opponentStrengthNotEvaluable,
    stakesNotEvaluable: stored.stakesNotEvaluable,
    ...(await caseRecords(db, caseId)),
  };
}
