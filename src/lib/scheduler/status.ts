// What the status screen shows of the scheduled tasks and of the trigger (TRV-26, TRV-32,
// TRV-46): the tasks from the database, the trigger from the tick records alone.
import { getParams } from '@/lib/params';
import { lastTicks } from '@/lib/wake-plan';

import { nextOccurrence, sinceOf, TIME_ZONE_KEY } from './due';
import { MINUTE_MS } from './limits';
import { epochOf, isRunning, loadStates } from './runs';

import type { Registry, TaskRunResult, TaskRunTrigger } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { TaskKey } from '@/lib/wake-plan';

/** One task on the status screen: its last run, whether it runs, a requested run, its next run. */
export type TaskLine = Readonly<{
  task: TaskKey;
  lastRun: Readonly<{
    trigger: TaskRunTrigger;
    startedAt: EpochMs;
    finishedAt: EpochMs | null;
    result: TaskRunResult | null;
  }> | null;
  isRunning: boolean;
  /** When an on-demand run was asked that waits for the running one to end (CL-COL-20). */
  requestedAt: EpochMs | null;
  /** The next scheduled run, which an on-demand run never moves (TRV-33). */
  nextRunAt: EpochMs | null;
}>;

/**
 * Each task of `registry` at `at`, as the status screen lists it (TRV-26, TRV-32, TRV-46):
 * its last run with its trigger and result, none while it runs, whether a run runs,
 * a requested run that waits, and its next scheduled run.
 */
export async function taskOverview(
  db: Database,
  registry: Registry,
  at: EpochMs,
): Promise<readonly TaskLine[]> {
  const params = await getParams(db);
  const stateOf = await loadStates(db);
  const context = { db, at, params, timeZone: params.get(TIME_ZONE_KEY), stateOf };
  return Promise.all(
    registry.map(async (task): Promise<TaskLine> => {
      const state = stateOf(task.key);
      const { latest, requested } = state;
      const startedAt = latest?.startedAt ?? null;
      const next = await nextOccurrence(task, sinceOf(state), context);
      return {
        task: task.key,
        lastRun:
          latest === null || startedAt === null
            ? null
            : {
                trigger: latest.trigger,
                startedAt: epochOf(startedAt),
                finishedAt: latest.finishedAt === null ? null : epochOf(latest.finishedAt),
                result: latest.result,
              },
        isRunning: isRunning(latest),
        requestedAt: requested === null ? null : epochOf(requested.dueAt),
        nextRunAt: next?.dueAt ?? null,
      };
    }),
  );
}

/** The trigger's status, its callers' last calls and the cache's status (TRV-46). */
export type TriggerStatuses = Readonly<{
  /** Degraded once no tick came for twice the expected interval; unknown while the cache fails. */
  trigger: 'normal' | 'degraded' | null;
  lastAcceptedAt: EpochMs | null;
  callers: readonly Readonly<{ caller: string; lastCallAt: EpochMs }>[];
  runtimeCache: 'normal' | 'degraded';
}>;

/**
 * The status of the trigger service at `at`, from the tick records alone and without the
 * database (TRV-32, TRV-46; module map §4): degraded when the last accepted tick, whoever
 * sent it, is older than twice `scheduler.expectedTickIntervalMinutes`, or when no tick
 * ever came; each caller's last call, latest first, for diagnosis; and the runtime cache,
 * degraded while it fails. No caller is expected by name.
 */
export async function triggerStatuses(
  at: EpochMs,
  expectedTickIntervalMinutes: number,
): Promise<TriggerStatuses> {
  const reading = await lastTicks();
  if (!reading.ok) {
    return { trigger: null, lastAcceptedAt: null, callers: [], runtimeCache: 'degraded' };
  }
  const { ticks } = reading;
  const silentAfter = 2 * expectedTickIntervalMinutes * MINUTE_MS;
  const isSilent = ticks === null || at - ticks.lastAcceptedAt > silentAfter;
  const callers = Object.entries(ticks?.callers ?? {})
    .map(([caller, lastCallAt]) => ({ caller, lastCallAt }))
    .toSorted((left, right) => right.lastCallAt - left.lastCallAt);
  return {
    trigger: isSilent ? 'degraded' : 'normal',
    lastAcceptedAt: ticks?.lastAcceptedAt ?? null,
    callers,
    runtimeCache: 'normal',
  };
}
