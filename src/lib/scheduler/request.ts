import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { after } from 'next/server';

import { taskRuns } from '@/lib/db';
import { now } from '@/lib/time';
import { wakeAt } from '@/lib/wake-plan';

import { execute } from './execute';

import type { Registry } from './types';
import type { Database } from '@/lib/db';
import type { TaskKey } from '@/lib/wake-plan';

/** An on-demand run asked: deferred while a run of its task runs, or refused for a task not active. */
export type RunRequest =
  | Readonly<{ ok: true; deferred: boolean }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'inactive_task' }> }>;

/**
 * Asks for an on-demand run of `task` (TRV-33, TRV-28, CL-COL-20): the run is recorded as
 * requested, at most one per task, and keeps the next scheduled run; the wake plan is
 * pulled to now, and a pass starts it after the response. While a run of the task runs,
 * one waiting in its ready guard included, the requested run waits and starts when that
 * run ends, which `deferred` tells the screen; it never waits for the source (CL-TRV-23).
 */
export async function requestRun(
  db: Database,
  registry: Registry,
  task: TaskKey,
): Promise<RunRequest> {
  if (registry.every((scheduled) => scheduled.key !== task)) {
    return { ok: false, error: { kind: 'inactive_task' } };
  }
  const at = now();
  await db
    .insert(taskRuns)
    .values({ taskKey: task, trigger: 'on_demand', dueAt: new Date(at) })
    .onConflictDoNothing();
  const running = await db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(eq(taskRuns.taskKey, task), isNotNull(taskRuns.startedAt), isNull(taskRuns.result)));
  await wakeAt(at, task);
  after(async () => {
    await execute(db, registry);
  });
  return { ok: true, deferred: running.length > 0 };
}
