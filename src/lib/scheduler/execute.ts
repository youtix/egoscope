// The database pass (module map §1.6 steps 5 to 7): under the pass lease, the counters
// flushed, the activity recorded, the due tasks run in leased, resumable chunks, the run
// check, then the wake plan rewritten.
import { randomUUID } from 'node:crypto';

import { logger } from '@/lib/log';
import { getParams } from '@/lib/params';
import { recordDatabaseActivity } from '@/lib/quotas';
import { now, toEpochMs } from '@/lib/time';
import { duringPass, writePlan } from '@/lib/wake-plan';

import { notePlanWritten } from './decide';
import { TIME_ZONE_KEY } from './due';
import { flushCounters } from './flush';
import { releaseLease, takeLease } from './lease';
import { PASS_BUDGET_MS, STALE_AFTER_MS } from './limits';
import { computeWakePlan } from './plan';
import { checkMissedRuns } from './run-check';
import { finishRun, interrupt, isRunning, isWaiting, loadStates, markProgress } from './runs';
import { nextRun } from './turn';

import type { LeaseHeld } from './lease';
import type { RunRow, TaskState } from './runs';
import type { Pass } from './turn';
import type { ChunkOutcome, Registry, ScheduledTask, TaskContext } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { TaskKey } from '@/lib/wake-plan';

/** What a call of `execute` did: a pass, or nothing while another pass holds the lease. */
export type PassOutcome =
  Readonly<{ ok: true; passId: string }> | Readonly<{ ok: false; error: LeaseHeld }>;

type States = (task: TaskKey) => TaskState;

/** Whether a run that runs has had no progress mark, nor start, for twice the function limit. */
const isStale = (run: RunRow & Readonly<{ startedAt: Date }>, at: EpochMs) =>
  at - (run.progressAt ?? run.startedAt).getTime() >= STALE_AFTER_MS;

/**
 * Closes as interrupted each run without a progress mark, or a start, for twice the
 * function limit, except a run that waits in its ready guard (CL-TRV-07).
 */
async function closeStaleRuns(db: Database, registry: Registry, at: EpochMs): Promise<void> {
  const stateOf = await loadStates(db);
  for (const task of registry) {
    const { latest } = stateOf(task.key);
    if (isRunning(latest) && !isWaiting(task, latest) && isStale(latest, at)) {
      await interrupt(db, latest, at);
    }
  }
}

/** One chunk of `task`; a handler that throws, a bug, fails its run. */
async function chunk(task: ScheduledTask, context: TaskContext): Promise<ChunkOutcome> {
  try {
    return await task.run(context);
  } catch (error) {
    logger.error('A task handler threw: its run is recorded as failed.', {
      task: task.key,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'done', result: 'failed' };
  }
}

/**
 * Works `run` chunk by chunk from its cursor, each portion's progress and cursor written,
 * until it ends or the pass's budget is spent, when it stays running and the next pass
 * resumes it from its cursor (TRV-30). Says how it stopped.
 */
async function work(pass: Pass, task: ScheduledTask, run: RunRow): Promise<ChunkOutcome['kind']> {
  let { cursor } = run;
  while (now() < pass.endsAt) {
    const outcome = await chunk(task, {
      db: pass.db,
      now: now(),
      budget: { endsAt: pass.endsAt },
      passId: run.passId ?? pass.id,
      cursor,
      trigger: run.trigger,
      runId: run.id,
    });
    if (outcome.kind === 'done') {
      await finishRun(pass.db, run, { result: outcome.result, at: now() });
      return 'done';
    }
    cursor = outcome.cursor;
    await markProgress(pass.db, { id: run.id, cursor }, now());
  }
  return 'more';
}

/** Runs the due runs of `task` one after the other while the budget lasts; returns the states then. */
async function runTask(pass: Pass, task: ScheduledTask, states: States): Promise<States> {
  let stateOf = states;
  while (now() < pass.endsAt) {
    const context = {
      db: pass.db,
      at: now(),
      params: pass.params,
      timeZone: pass.timeZone,
      stateOf,
    };
    const run = await nextRun({ pass, task, state: stateOf(task.key), context });
    if (run === null) {
      return stateOf;
    }
    const stop = await work(pass, task, run);
    stateOf = await loadStates(pass.db);
    if (stop === 'more') {
      return stateOf;
    }
  }
  return stateOf;
}

/** Runs the due work of `tasks`, in registry order, while the budget lasts (TRV-30). */
async function runTasks(pass: Pass, tasks: Registry): Promise<void> {
  let stateOf = await loadStates(pass.db);
  for (const task of tasks) {
    stateOf = await runTask(pass, task, stateOf);
  }
}

/** The pass itself, under the lease: stale runs, the run check, the due tasks, the run check, the plan. */
async function runPass(pass: Pass, registry: Registry): Promise<void> {
  const { db, id } = pass;
  await closeStaleRuns(db, registry, now());
  await checkMissedRuns(db, registry, { at: now(), passId: id });
  await runTasks(pass, registry);
  const caughtUp = await checkMissedRuns(db, registry, { at: now(), passId: id });
  if (caughtUp.length > 0) {
    await runTasks(
      pass,
      registry.filter((task) => caughtUp.includes(task.key)),
    );
  }
  const plan = await computeWakePlan(db, registry, now());
  const written = await writePlan(plan);
  if (written.ok) {
    notePlanWritten(plan.computedAt);
  }
}

/**
 * Runs one database pass (module map §1.6 steps 5 to 7; TRV-25 to TRV-31): it takes the
 * single `scheduler_lease` row, which every pass takes, so that no two passes and no two
 * runs of a task overlap, and gives up while another pass holds it; it uses no session
 * lock or setting, so it works through the pooled connection. Under the lease, and as a
 * pass in which `wakeAt` writes nothing: the counters flushed into the journal and
 * `quotas`, the pass's database activity recorded, stale runs closed as interrupted, the
 * run check, the due tasks of `registry` run in its order in chunks within a budget taken
 * from the function limit, each run recorded with its trigger, pass, progress, cursor and
 * result, the run check again, and the wake plan computed and written in full.
 */
export async function execute(db: Database, registry: Registry): Promise<PassOutcome> {
  const startedAt = now();
  const id = randomUUID();
  const lease = await takeLease(db, id, startedAt);
  if (!lease.ok) {
    return lease;
  }
  try {
    await duringPass(async () => {
      await flushCounters(db);
      await recordDatabaseActivity(db);
      const params = await getParams(db);
      const endsAt = toEpochMs(startedAt + PASS_BUDGET_MS);
      const timeZone = params.get(TIME_ZONE_KEY);
      await runPass({ db, id, endsAt, params, timeZone, started: new Set() }, registry);
    });
  } finally {
    await releaseLease(db, id);
  }
  return { ok: true, passId: id };
}
