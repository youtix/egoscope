// The writer of a player's evaluated cases (events-and-cases.md sections 1.7 to 1.11 and
// 2.5): each case of the evaluation kept, moved or created by the grouping rule, with its
// criteria, review flags and history, its events linked through `events.recordCaseLinks`,
// and the cases a regrouping empties deleted after the regrouping reactions (module map,
// section 1.10). Internal to the module: the recalculation passes it the engine's output.
import 'server-only';

import { and, asc, eq, inArray, notExists, sql, TransactionRollbackError } from 'drizzle-orm';

import { caseReviewFlags, cases, caseTriggeredCriteria, events, games } from '@/lib/db';
import { recordCaseLinks } from '@/lib/events';
import { ok } from '@/lib/result';

import { present, writeCase } from './case-rows';

import type { RecalculationCause } from './recalculate';
import type { CaseRow, RegroupingReactions } from './types';
import type { Transaction } from '@/lib/db';
import type { CaseLink } from '@/lib/events';
import type { Err, Result } from '@/lib/result';
import type { CaseId, EvaluatedCase, PlayerEventId, Precedence } from '@/lib/stats-engine';

/**
 * What a recalculation writes for one player: his cases as the engine evaluated them, the
 * precedence it derived for each of his historical events (IMP-18, CL-IMP-17), and the
 * cause of its job, which each history entry carries (CL-SEN-17).
 */
export type PlayerCaseResults = Readonly<{
  playerId: string;
  cases: readonly EvaluatedCase[];
  precedences: ReadonlyMap<PlayerEventId, Precedence>;
  cause: RecalculationCause;
}>;

/** An evaluated case of the player, its earliest-recorded event, and the stored case it keeps, null for a new one. */
type Target = Readonly<{ evaluated: EvaluatedCase; earliest: StoredEvent; kept: CaseRow | null }>;

/** A written case: what it was written from, and its id. */
type Written = Readonly<{ target: Target; caseId: CaseId }>;

/**
 * Reads what the write compares and regroups: the player's cases with their criteria and
 * flags, and the events of the evaluation in the order they were recorded, each tracked
 * when detected, or calendar-derived before its game's scheduled start (SUI-05, SUI-07,
 * CL-VUE-13); the database compares instants finer than a JavaScript date, and a
 * calendar-derived event always has its game (`events_calendar_check`).
 */
async function readState(tx: Transaction, results: PlayerCaseResults) {
  const rows = await tx.select().from(cases).where(eq(cases.playerId, results.playerId));
  const caseIds = rows.map(({ id }) => id);
  return {
    cases: rows,
    criteria: await tx
      .select()
      .from(caseTriggeredCriteria)
      .where(inArray(caseTriggeredCriteria.caseId, caseIds))
      .orderBy(asc(caseTriggeredCriteria.id)),
    flags: await tx.select().from(caseReviewFlags).where(inArray(caseReviewFlags.caseId, caseIds)),
    events: await tx
      .select({
        id: events.id,
        playerId: events.playerId,
        caseId: events.caseId,
        isTracked: sql<boolean>`${events.origin} = 'detected' OR (${events.origin} = 'calendar' AND ${events.createdAt} < ${games.scheduledStartAt})`,
      })
      .from(events)
      .leftJoin(games, eq(games.id, events.derivedGameId))
      .where(
        inArray(
          events.id,
          results.cases.flatMap(({ eventIds }) => eventIds),
        ),
      )
      .orderBy(asc(events.createdAt), asc(events.id)),
  };
}

/** What the player's stored cases hold before the write, his events in the order they were recorded. */
type StoredState = Awaited<ReturnType<typeof readState>>;

/** An event of the evaluation as it is stored: its player, its case, and whether it would make its own case tracked. */
type StoredEvent = StoredState['events'][number];

/** The target of `evaluated`, with the stored case of its type that already has its measured game. */
function targetOf(evaluated: EvaluatedCase, state: StoredState) {
  const { eventIds, eventTypeId, measuredGameId } = evaluated;
  const earliest = state.events.find(({ id }) => eventIds.includes(id));
  const onGame = state.cases.find(
    (row) => row.eventTypeId === eventTypeId && row.measuredGameId === measuredGameId,
  );
  return {
    evaluated,
    earliest: present(earliest, `stored event of the case of event ${String(eventIds[0])}`),
    kept: measuredGameId === null ? null : (onGame ?? null),
  };
}

/**
 * The stored case each evaluated case keeps (events-and-cases.md section 2.5, CL-VUE-03):
 * the one of its type that already has its measured game; else, unless another case kept
 * it first, in the order of their earliest-recorded events, the case of its
 * earliest-recorded event; else none, and a new case.
 */
function targetsOf(results: PlayerCaseResults, state: StoredState): readonly Target[] {
  const targets = results.cases.map((evaluated) => targetOf(evaluated, state));
  const claimed = new Set(targets.flatMap(({ kept }) => (kept === null ? [] : kept.id)));
  const rank = (target: Target) => state.events.indexOf(target.earliest);
  const byEarliest = targets.toSorted((one, other) => rank(one) - rank(other));
  for (const target of byEarliest) {
    const candidate = state.cases.find(({ id }) => id === target.earliest.caseId);
    if (candidate === undefined || target.kept !== null || claimed.has(candidate.id)) {
      continue;
    }
    claimed.add(candidate.id);
    target.kept = candidate;
  }
  return targets;
}

/** The link of each event of the evaluation to its case and, when historical, its precedence (CL-IMP-17). */
function linksOf(written: readonly Written[], results: PlayerCaseResults): readonly CaseLink[] {
  return written.flatMap(({ target, caseId }) =>
    target.evaluated.eventIds.map((eventId) => {
      const precedence = results.precedences.get(eventId);
      return precedence === undefined ? { eventId, caseId } : { eventId, caseId, precedence };
    }),
  );
}

/**
 * Deletes the player's cases left without an event, each with its child rows (CL-VUE-03):
 * before a case that the write emptied goes, the reactions run, in list order, with the
 * case that its earliest-recorded event joined, while its row is as it was; the first
 * failure stops the write (module map, section 1.10, CL-SUI-16).
 */
async function deleteEmptied<E>(
  tx: Transaction,
  context: Readonly<{
    results: PlayerCaseResults;
    state: StoredState;
    written: readonly Written[];
  }>,
  reactions: readonly RegroupingReactions<E>[],
): Promise<Result<undefined, E>> {
  const holdsNoEvent = notExists(
    tx.select({ id: events.id }).from(events).where(eq(events.caseId, cases.id)),
  );
  const eventless = and(eq(cases.playerId, context.results.playerId), holdsNoEvent);
  const emptied = await tx.select({ id: cases.id }).from(cases).where(eventless);
  const regroupings = emptied.flatMap(({ id: emptiedCaseId }) => {
    const moved = context.state.events.find(({ caseId }) => caseId === emptiedCaseId);
    const into = context.written.find(
      ({ target }) => moved !== undefined && target.evaluated.eventIds.includes(moved.id),
    );
    return into === undefined ? [] : { emptiedCaseId, survivingCaseId: into.caseId };
  });
  for (const regrouping of regroupings) {
    for (const reaction of reactions) {
      const reacted = await reaction(tx, regrouping);
      if (!reacted.ok) {
        return reacted;
      }
    }
  }
  await tx.delete(cases).where(eventless);
  return ok(undefined);
}

/** The write, in the savepoint `tx`. */
async function write<E>(
  tx: Transaction,
  results: PlayerCaseResults,
  reactions: readonly RegroupingReactions<E>[],
): Promise<Result<readonly CaseId[], E>> {
  const state = await readState(tx, results);
  const rows = { criteria: state.criteria, flags: state.flags, cause: results.cause };
  const written: Written[] = [];
  for (const target of targetsOf(results, state)) {
    written.push({ target, caseId: await writeCase(tx, target, rows) });
  }
  await recordCaseLinks(tx, linksOf(written, results));
  const deleted = await deleteEmptied(tx, { results, state, written }, reactions);
  return deleted.ok ? ok(written.map(({ caseId }) => caseId)) : deleted;
}

/**
 * Writes the evaluated cases of one player in the caller's transaction `tx`, and gives
 * their ids in the order of `results.cases` (SEN-05 to SEN-17, SEN-37, CL-VUE-03,
 * CL-SEN-05, CL-SEN-17): each case keeps the stored case that already has its measured
 * game, else that of its earliest-recorded event, else is a new case with that event's
 * origin and creation instant, tracked when the event is detected or calendar-derived
 * before its game's scheduled start (CL-VUE-13, SUI-04), and no kept case's origin or
 * creation instant changes; its criteria are rewritten whole, its review flags keep their
 * acknowledgment while their game is unchanged, and a history entry with the job's cause
 * records each change of its status, reason, measured game or gap. Each event's case and,
 * for a historical one, its precedence go through `events.recordCaseLinks` (SEN-05,
 * IMP-18, CL-IMP-17). The cases left without an event are then deleted with their child
 * rows, after the `reactions` for those this write emptied (module map, section 1.10,
 * CL-SUI-16); a failed reaction is the answer, and every write of the call, the
 * reactions' included, is rolled back. Writing the same results again writes nothing.
 */
export async function writePlayerCases<E>(
  tx: Transaction,
  results: PlayerCaseResults,
  reactions: readonly RegroupingReactions<E>[],
): Promise<Result<readonly CaseId[], E>> {
  let failure: Err<E> | undefined;
  try {
    return await tx.transaction(async (savepoint) => {
      const written = await write(savepoint, results, reactions);
      if (!written.ok) {
        failure = written;
        savepoint.rollback();
      }
      return written;
    });
  } catch (error) {
    // The driver signals the rollback asked above with this error, and the failure is the answer.
    if (failure !== undefined && error instanceof TransactionRollbackError) {
      return failure;
    }
    throw error;
  }
}
