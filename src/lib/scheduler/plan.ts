// The wake plan's computation (module map §1.9): every task's next due instant, from the
// database, at the end of each pass.
import { getParams } from '@/lib/params';

import { scheduledDue, TIME_ZONE_KEY } from './due';
import { checkGuard } from './guard';
import { epochOf, isRunning, isWaiting, loadStates } from './runs';

import type { DueContext } from './due';
import type { RunRow } from './runs';
import type { ReadyGuard, Registry, ScheduledTask } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { PlanContent, WakeEntry, WakeProbe } from '@/lib/wake-plan';

type TaskPlan = Readonly<{ entry: WakeEntry | null; probe: WakeProbe | null }>;

/**
 * What the plan holds for a run that waits in `guard`: due at once once the guard lets it
 * go, or when its check throws, so that the next pass asks it again and fails the run if it
 * throws then, otherwise at its cut-off, with the probe that a tick makes meanwhile (CL-TRV-23).
 */
async function waitOf(guard: ReadyGuard, run: RunRow, context: DueContext): Promise<TaskPlan> {
  const task = run.taskKey;
  const checked = await checkGuard(context.db, { guard, run }, context.at);
  if (checked === null || checked.ready) {
    return { entry: { task, dueAt: context.at }, probe: null };
  }
  const cutoff = guard.cutoff(epochOf(run.dueAt), context.params, context.timeZone);
  return { entry: { task, dueAt: cutoff }, probe: checked.probe };
}

/**
 * What the plan holds for `task`: a run that waits in its ready guard is due when the
 * guard lets it go, at the latest at its cut-off, and the plan holds the probe that a tick
 * makes meanwhile (CL-TRV-23); a run to resume, an interrupted one included, and an
 * on-demand run that waits while none runs, are due at once (TRV-30); otherwise the task
 * is due at its next scheduled run, if any, its catch-up run due at once (CL-TRV-08).
 */
async function planOf(task: ScheduledTask, context: DueContext): Promise<TaskPlan> {
  const state = context.stateOf(task.key);
  const { latest } = state;
  const { at } = context;
  const due = (dueAt: EpochMs | null): TaskPlan => ({
    entry: dueAt === null ? null : { task: task.key, dueAt },
    probe: null,
  });
  if (isRunning(latest)) {
    return task.readyGuard !== undefined && isWaiting(task, latest)
      ? waitOf(task.readyGuard, latest, context)
      : due(at);
  }
  if (latest?.result === 'interrupted' || state.requested !== null) {
    return due(at);
  }
  const next = await scheduledDue(task, state, context);
  return due(next === null ? null : next.dueAt);
}

/**
 * Computes the wake plan at `at` from the database (module map §1.6 step 7, §1.9; TRV-25,
 * TRV-27): each task's next due instant for its four kinds of schedule — local times each
 * day or on a weekday in the owner's zone, one instant per configured time whatever the
 * clock change, after a parent's success, or the instant its owner computes —, at once
 * for a run to resume or a requested one, and the probes of the runs that wait in their
 * ready guard. The plan's earliest due instant is the earliest of them.
 */
export async function computeWakePlan(
  db: Database,
  registry: Registry,
  at: EpochMs,
): Promise<PlanContent> {
  const params = await getParams(db);
  const stateOf = await loadStates(db);
  const context: DueContext = { db, at, params, timeZone: params.get(TIME_ZONE_KEY), stateOf };
  const entries: WakeEntry[] = [];
  const probes: WakeProbe[] = [];
  for (const task of registry) {
    const { entry, probe } = await planOf(task, context);
    entries.push(...(entry === null ? [] : [entry]));
    probes.push(...(probe === null ? [] : [probe]));
  }
  return { computedAt: at, entries, probes };
}
