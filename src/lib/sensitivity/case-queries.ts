// The reads of the cases for the screens (module map, section 2.4): a profile's or a
// trend's cases grouped by status, an event's case and the review flags of the to-do
// list. A case's detail is in case-detail.ts.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  boxScores,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  events,
  followedPlayers,
  games,
  teamSeasons,
} from '@/lib/db';
import { toEpochMs, toIsoDate } from '@/lib/time';

import type { CaseStatusReason, DoubtfulCaseCriterion } from './calculation-values';
import type { CaseReviewFlagRow, CaseRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { CaseOrigin } from '@/lib/stats-engine';
import type { EpochMs, IsoDate } from '@/lib/time';
import type { SQL } from 'drizzle-orm';

type Reader = Database | Transaction;

/** A case's status (SEN-07). */
export type CaseStatus = CaseRow['status'];

/** One event of a case: its origin, its date or instant, and its short description (IHM-24, SEN-40). */
export type CaseEvent = Readonly<{
  id: number;
  origin: (typeof events.$inferSelect)['origin'];
  referenceDateOn: IsoDate | null;
  referenceAt: EpochMs | null;
  description: string;
}>;

/** The game at which a case is measured: its day, its start, whether its time is to be determined, its season and its opponent under its name that season (STA-26, STA-31, JOU-08). */
export type MeasuredGame = Readonly<{
  id: number;
  gameDay: IsoDate;
  scheduledStartAt: EpochMs;
  isStartTimeTbd: boolean;
  season: string;
  opponent: Readonly<{ location: string; name: string; abbreviation: string }> | null;
}>;

/**
 * A case as the case list shows it (SEN-07, SEN-40, IHM-24): its status with its reason,
 * or its criteria when excluded; its origin; its events; its reference instant, none for
 * a type known in advance, whose measured game is searched from its date (CL-SEN-02); its
 * measured game; its minutes; its performance index; the baseline used; and its gap.
 */
export type CaseLine = Readonly<{
  id: number;
  playerId: string;
  eventTypeId: string;
  origin: CaseOrigin;
  status: CaseStatus;
  statusReason: CaseStatusReason | null;
  criteria: readonly DoubtfulCaseCriterion[];
  events: readonly CaseEvent[];
  referenceInstantAt: EpochMs | null;
  referenceInstantOrigin: CaseRow['referenceInstantOrigin'];
  measuredGame: MeasuredGame | null;
  minutes: number | null;
  performanceIndex: number | null;
  baseline: Readonly<{
    season: string | null;
    phase: CaseRow['baselinePhase'];
    gameCount: number | null;
    mean: number | null;
    standardDeviation: number | null;
    status: CaseRow['baselineStatus'];
    isPartial: boolean | null;
  }>;
  normalizedGap: number | null;
  gapStatus: CaseRow['gapStatus'];
}>;

/** A profile's or a trend's cases by status, in the groups of IHM-24: valid, excluded, not measurable, awaiting their game. */
export type CaseGroups = Readonly<{
  measured: readonly CaseLine[];
  excluded: readonly CaseLine[];
  notMeasurable: readonly CaseLine[];
  awaitingGame: readonly CaseLine[];
}>;

/** An instant of a timestamp column, or none. */
const instantOrNull = (at: Date | null): EpochMs | null =>
  at === null ? null : toEpochMs(at.getTime());

// The opponent of the player in the measured game: the other team than his own line's.
const OPPONENT_TEAM = sql`CASE ${boxScores.teamId} WHEN ${games.homeTeamId} THEN ${games.awayTeamId} WHEN ${games.awayTeamId} THEN ${games.homeTeamId} END`;

/** The cases that `where` keeps, with their measured game and its opponent, by game start, then reference instant, then id. */
async function caseRowsWhere(db: Reader, where: SQL | undefined) {
  return db
    .select({
      case: cases,
      game: games,
      opponent: {
        location: teamSeasons.location,
        name: teamSeasons.name,
        abbreviation: teamSeasons.abbreviation,
      },
    })
    .from(cases)
    .leftJoin(games, eq(games.id, cases.measuredGameId))
    .leftJoin(
      boxScores,
      and(eq(boxScores.gameId, cases.measuredGameId), eq(boxScores.playerId, cases.playerId)),
    )
    .leftJoin(
      teamSeasons,
      and(eq(teamSeasons.season, games.season), eq(teamSeasons.teamId, OPPONENT_TEAM)),
    )
    .where(where)
    .orderBy(
      sql`coalesce(${games.scheduledStartAt}, ${cases.referenceInstantAt}) NULLS LAST`,
      asc(cases.id),
    );
}

type CaseRowWithGame = Awaited<ReturnType<typeof caseRowsWhere>>[number];

/** The measured game of a row, with its opponent when his line names his team. */
function measuredGameOf({ game, opponent }: CaseRowWithGame): MeasuredGame | null {
  return game === null
    ? null
    : {
        id: game.id,
        gameDay: toIsoDate(game.gameDayOn),
        scheduledStartAt: toEpochMs(game.scheduledStartAt.getTime()),
        isStartTimeTbd: game.isStartTimeTbd,
        season: game.season,
        opponent,
      };
}

/** An event row as a case shows it: its origin, its date or instant, its short description (IHM-24). */
export function caseEventOf(event: typeof events.$inferSelect): CaseEvent {
  return {
    id: event.id,
    origin: event.origin,
    referenceDateOn: event.referenceDateOn === null ? null : toIsoDate(event.referenceDateOn),
    referenceAt: instantOrNull(event.referenceAt),
    description: event.description,
  };
}

/** A case row as the list shows it, with its events and its criteria. */
function caseLineOf(
  row: CaseRowWithGame,
  related: Readonly<{ events: readonly CaseEvent[]; criteria: readonly DoubtfulCaseCriterion[] }>,
): CaseLine {
  const item = row.case;
  return {
    id: item.id,
    playerId: item.playerId,
    eventTypeId: item.eventTypeId,
    origin: item.origin,
    status: item.status,
    statusReason: item.statusReason,
    ...related,
    referenceInstantAt: instantOrNull(item.referenceInstantAt),
    referenceInstantOrigin: item.referenceInstantOrigin,
    measuredGame: measuredGameOf(row),
    minutes: item.measuredMinutes,
    performanceIndex: item.performanceIndex,
    baseline: {
      season: item.baselineSeason,
      phase: item.baselinePhase,
      gameCount: item.baselineGameCount,
      mean: item.baselineMean,
      standardDeviation: item.baselineStandardDeviation,
      status: item.baselineStatus,
      isPartial: item.baselineIsPartial,
    },
    normalizedGap: item.normalizedGap,
    gapStatus: item.gapStatus,
  };
}

/** The items of `items` that belong to the case `id`. */
function ofCase<T extends Readonly<{ caseId: number | null }>>(
  items: readonly T[],
  id: number,
): T[] {
  return items.filter((item) => item.caseId === id);
}

/** A stored case and its line. */
export type StoredCaseLine = Readonly<{ stored: CaseRow; line: CaseLine }>;

/**
 * The cases that `where` keeps, each stored row with its line as the case list shows it
 * (SEN-07, SEN-40, IHM-24), in three reads: the cases with their measured game and its
 * opponent, their events, their criteria.
 */
export async function casesWhere(
  db: Reader,
  where: SQL | undefined,
): Promise<readonly StoredCaseLine[]> {
  const rows = await caseRowsWhere(db, where);
  const ids = rows.map((row) => row.case.id);
  const caseEvents = await db
    .select()
    .from(events)
    .where(inArray(events.caseId, ids))
    .orderBy(asc(events.id));
  const criteria = await db
    .select({ caseId: caseTriggeredCriteria.caseId, criterion: caseTriggeredCriteria.criterion })
    .from(caseTriggeredCriteria)
    .where(inArray(caseTriggeredCriteria.caseId, ids))
    .orderBy(asc(caseTriggeredCriteria.id));
  return rows.map((row) => ({
    stored: row.case,
    line: caseLineOf(row, {
      events: ofCase(caseEvents, row.case.id).map((event) => caseEventOf(event)),
      criteria: [...new Set(ofCase(criteria, row.case.id).map(({ criterion }) => criterion))],
    }),
  }));
}

/**
 * The cases of a player's profile of a type, or of the type's trend when no player is
 * named, every player's, grouped by status — valid, excluded, not measurable, awaiting
 * their game — each with its reason or criteria, its events and its measurement, of one
 * origin only when it is given (SEN-07, SEN-21, SEN-40, IHM-24).
 */
export async function listCases(
  db: Reader,
  subject: Readonly<{ playerId?: string; eventTypeId: string }>,
  filter: Readonly<{ origin?: CaseOrigin }> = {},
): Promise<CaseGroups> {
  const found = await casesWhere(
    db,
    and(
      eq(cases.eventTypeId, subject.eventTypeId),
      subject.playerId === undefined ? undefined : eq(cases.playerId, subject.playerId),
      filter.origin === undefined ? undefined : eq(cases.origin, filter.origin),
    ),
  );
  const lines = found.map(({ line }) => line);
  const inStatus = (status: CaseStatus) => lines.filter((line) => line.status === status);
  return {
    measured: inStatus('measured'),
    excluded: inStatus('excluded'),
    notMeasurable: inStatus('not_measurable'),
    awaitingGame: inStatus('awaiting_game'),
  };
}

/** The case that holds an event, or null when it is in none (SEN-05, IHM-67). */
export async function caseOfEvent(db: Reader, eventId: number): Promise<CaseLine | null> {
  const holding = db.select({ caseId: events.caseId }).from(events).where(eq(events.id, eventId));
  const [found] = await casesWhere(db, inArray(cases.id, holding));
  return found?.line ?? null;
}

/** A review flag that the owner has not acknowledged yet, as the to-do list shows it (SEN-16, IHM-20). */
export type ReviewFlagItem = Readonly<{
  id: number;
  caseId: number;
  playerId: string;
  playerName: string;
  eventTypeId: string;
  flag: CaseReviewFlagRow['flag'];
  measuredGameId: number;
  gameDay: IsoDate;
  raisedAt: EpochMs;
}>;

/**
 * The review flags not acknowledged yet, oldest first, each with its case, its player
 * and the day of the game it was raised on, for the to-do list (SEN-16, SEN-17, IHM-20,
 * CL-SEN-11): an acknowledged flag stays on its case and leaves the list.
 */
export async function reviewFlags(db: Reader): Promise<readonly ReviewFlagItem[]> {
  const rows = await db
    .select({
      flag: caseReviewFlags,
      playerId: cases.playerId,
      playerName: followedPlayers.displayName,
      eventTypeId: cases.eventTypeId,
      gameDayOn: games.gameDayOn,
    })
    .from(caseReviewFlags)
    .innerJoin(cases, eq(cases.id, caseReviewFlags.caseId))
    .innerJoin(followedPlayers, eq(followedPlayers.id, cases.playerId))
    .innerJoin(games, eq(games.id, caseReviewFlags.measuredGameId))
    .where(isNull(caseReviewFlags.acknowledgedAt))
    .orderBy(asc(caseReviewFlags.raisedAt), asc(caseReviewFlags.id));
  return rows.map(({ flag, gameDayOn, ...of }) => ({
    id: flag.id,
    caseId: flag.caseId,
    ...of,
    flag: flag.flag,
    measuredGameId: flag.measuredGameId,
    gameDay: toIsoDate(gameDayOn),
    raisedAt: toEpochMs(flag.raisedAt.getTime()),
  }));
}
